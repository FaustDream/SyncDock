from __future__ import annotations

from pathlib import Path

from syncdock.config_service import RepositoryConfig, SettingsConfig
from syncdock.repo_checker import RepositoryChecker, format_status_detail


class FakeCompletedProcess:
    def __init__(self, stdout: str) -> None:
        self.stdout = stdout


def build_settings() -> SettingsConfig:
    return SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )


def test_inspect_refreshes_remote_state_before_comparing(monkeypatch, tmp_path) -> None:
    repository = RepositoryConfig(name="仓库A", path=str(tmp_path), enabled=True)
    checker = RepositoryChecker()
    remote_refreshed = False

    def fake_run_git(self, cwd: Path, *args: str):
        nonlocal remote_refreshed
        if args == ("rev-parse", "--is-inside-work-tree"):
            return FakeCompletedProcess("true\n")
        if args == ("branch", "--show-current"):
            return FakeCompletedProcess("main\n")
        if args == ("status", "--porcelain"):
            return FakeCompletedProcess("")
        if args == ("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"):
            return FakeCompletedProcess("origin/main\n")
        if args == ("rev-list", "--left-right", "--count", "HEAD...@{upstream}"):
            return FakeCompletedProcess("0 1\n" if remote_refreshed else "0 0\n")
        raise AssertionError(f"未预期的 Git 命令: {args}")

    monkeypatch.setattr(RepositoryChecker, "_run_git", fake_run_git)
    def fake_refresh_remote(self, cwd: Path, timeout_seconds: int):
        nonlocal remote_refreshed
        remote_refreshed = True
        return None

    monkeypatch.setattr(RepositoryChecker, "_refresh_remote", fake_refresh_remote)

    result = checker.inspect(repository, build_settings(), refresh_remote=True)

    assert result["kind"] == "ready"
    assert result["message"] == "需要同步"
    assert result["needs_pull"] is True
    assert result["behind_count"] == 1


def test_inspect_reports_remote_refresh_failure(monkeypatch, tmp_path) -> None:
    repository = RepositoryConfig(name="仓库A", path=str(tmp_path), enabled=True)
    checker = RepositoryChecker()

    def fake_run_git(self, cwd: Path, *args: str):
        if args == ("rev-parse", "--is-inside-work-tree"):
            return FakeCompletedProcess("true\n")
        if args == ("branch", "--show-current"):
            return FakeCompletedProcess("main\n")
        if args == ("status", "--porcelain"):
            return FakeCompletedProcess("")
        if args == ("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"):
            return FakeCompletedProcess("origin/main\n")
        raise AssertionError(f"未预期的 Git 命令: {args}")

    monkeypatch.setattr(RepositoryChecker, "_run_git", fake_run_git)
    monkeypatch.setattr(RepositoryChecker, "_refresh_remote", lambda self, cwd, timeout_seconds: "查询远端状态失败")

    result = checker.inspect(repository, build_settings(), refresh_remote=True)

    assert result["kind"] == "failed"
    assert result["message"] == "查询远端状态失败"
    assert result["needs_pull"] is False


def test_format_status_detail_includes_counts_policy_and_suggestion() -> None:
    repository = RepositoryConfig(name="仓库A", path="A", enabled=True, author_type=False)
    inspection = {
        "message": "需要强制同步",
        "branch_name": "main",
        "upstream_name": "origin/main",
        "ahead_count": 1,
        "behind_count": 2,
    }

    detail = format_status_detail(repository, inspection)

    assert "需要强制同步" in detail
    assert "分支 main -> origin/main" in detail
    assert "本地领先 1" in detail
    assert "远端领先 2" in detail
    assert "策略：强制同步" in detail
    assert "建议：" in detail
