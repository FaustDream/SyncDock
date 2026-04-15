from pathlib import Path
import subprocess

from syncdock.sync_engine import SyncResult, summarize_results


def test_summarize_results_counts_each_outcome_type():
    results = [
        SyncResult(name="a", outcome="UPDATED", message="已同步"),
        SyncResult(name="b", outcome="UP_TO_DATE", message="已经是最新"),
        SyncResult(name="c", outcome="SKIPPED", message="已跳过，有未提交修改"),
        SyncResult(name="d", outcome="FAILED", message="同步失败，网络连接异常"),
        SyncResult(name="e", outcome="INVALID", message="仓库无效，路径不存在"),
    ]

    summary = summarize_results(results)

    assert summary == {
        "total": 5,
        "updated": 1,
        "up_to_date": 1,
        "skipped": 1,
        "failed": 1,
        "invalid": 1,
    }


class FakeChecker:
    def inspect(self, repository, settings):
        return {
            "kind": "ready",
            "needs_pull": False,
        }


class FakeGitRunner:
    def run(self, cwd: str, args: list[str], timeout_seconds: int) -> tuple[bool, str]:
        return True, ""


class FailingGitRunner:
    def run(self, cwd: str, args: list[str], timeout_seconds: int) -> tuple[bool, str]:
        return False, "同步失败，网络连接异常"


def test_sync_single_repository_returns_up_to_date_when_pull_not_needed():
    from syncdock.config_service import RepositoryConfig, SettingsConfig
    from syncdock.sync_engine import sync_single_repository

    repository = RepositoryConfig(name="SyncDock", path="E:\\gitHub\\SyncDock", enabled=True)
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    result = sync_single_repository(
        repository,
        settings,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
    )

    assert result.outcome == "UP_TO_DATE"
    assert result.message == "已经是最新"


def test_sync_single_repository_returns_failed_when_fetch_fails():
    from syncdock.config_service import RepositoryConfig, SettingsConfig
    from syncdock.sync_engine import sync_single_repository

    class NeedsPullChecker:
        def inspect(self, repository, settings):
            return {
                "kind": "ready",
                "needs_pull": True,
            }

    repository = RepositoryConfig(name="SyncDock", path="E:\\gitHub\\SyncDock", enabled=True)
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    result = sync_single_repository(
        repository,
        settings,
        checker=NeedsPullChecker(),
        git_runner=FailingGitRunner(),
    )

    assert result.outcome == "FAILED"
    assert result.message == "同步失败，网络连接异常"


def test_sync_all_repositories_skips_disabled_items():
    from syncdock.config_service import RepositoryConfig, SettingsConfig
    from syncdock.sync_engine import sync_all_repositories

    repositories = [
        RepositoryConfig(name="EnabledRepo", path="E:\\gitHub\\EnabledRepo", enabled=True),
        RepositoryConfig(name="DisabledRepo", path="E:\\gitHub\\DisabledRepo", enabled=False),
    ]
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    results = sync_all_repositories(
        repositories,
        settings,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
    )

    assert len(results) == 1
    assert results[0].name == "EnabledRepo"


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _seed_remote(tmp_path: Path) -> tuple[Path, Path]:
    remote = tmp_path / "remote.git"
    work = tmp_path / "work"
    remote.mkdir()
    work.mkdir()

    _git(remote, "init", "--bare")
    _git(work, "init", "-b", "main")
    _git(work, "config", "user.name", "SyncDock Test")
    _git(work, "config", "user.email", "syncdock@example.com")
    (work / "README.md").write_text("v1\n", encoding="utf-8")
    _git(work, "add", "README.md")
    _git(work, "commit", "-m", "init")
    _git(work, "remote", "add", "origin", str(remote))
    _git(work, "push", "-u", "origin", "main")
    _git(remote, "symbolic-ref", "HEAD", "refs/heads/main")
    return remote, work


def test_sync_single_repository_updates_local_repo_from_remote(tmp_path: Path):
    from syncdock.config_service import RepositoryConfig, SettingsConfig
    from syncdock.repo_checker import RepositoryChecker
    from syncdock.sync_engine import GitCommandRunner, sync_single_repository

    remote, work = _seed_remote(tmp_path)
    local = tmp_path / "local"
    _git(tmp_path, "clone", str(remote), str(local))
    _git(local, "config", "user.name", "SyncDock Test")
    _git(local, "config", "user.email", "syncdock@example.com")

    (work / "README.md").write_text("v2\n", encoding="utf-8")
    _git(work, "add", "README.md")
    _git(work, "commit", "-m", "update")
    _git(work, "push", "origin", "main")

    repository = RepositoryConfig(name="LocalRepo", path=str(local), enabled=True)
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=30,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    result = sync_single_repository(
        repository,
        settings,
        checker=RepositoryChecker(),
        git_runner=GitCommandRunner(),
    )

    assert result.outcome == "UPDATED"
    assert result.message == "已拉取最新代码"
    assert (local / "README.md").read_text(encoding="utf-8") == "v2\n"


def test_git_command_runner_reports_timeout(monkeypatch):
    import subprocess as real_subprocess

    from syncdock.sync_engine import GitCommandRunner

    def _raise_timeout(*args, **kwargs):
        raise real_subprocess.TimeoutExpired(cmd=["git", "fetch"], timeout=30)

    monkeypatch.setattr("syncdock.sync_engine.subprocess.run", _raise_timeout)

    ok, message = GitCommandRunner().run("E:\\gitHub\\SyncDock", ["fetch", "--all", "--prune"], 30)

    assert ok is False
    assert message == "同步失败，Git 执行超时"


def test_git_command_runner_reports_permission_problem(monkeypatch):
    import subprocess as real_subprocess

    from syncdock.sync_engine import GitCommandRunner

    def _raise_called_process_error(*args, **kwargs):
        raise real_subprocess.CalledProcessError(
            returncode=1,
            cmd=["git", "fetch"],
            stderr="Permission denied",
        )

    monkeypatch.setattr("syncdock.sync_engine.subprocess.run", _raise_called_process_error)

    ok, message = GitCommandRunner().run("E:\\gitHub\\SyncDock", ["fetch", "--all", "--prune"], 30)

    assert ok is False
    assert message == "同步失败，没有权限访问仓库"


def test_git_command_runner_reports_divergent_branch_problem(monkeypatch):
    import subprocess as real_subprocess

    from syncdock.sync_engine import GitCommandRunner

    def _raise_called_process_error(*args, **kwargs):
        raise real_subprocess.CalledProcessError(
            returncode=1,
            cmd=["git", "pull"],
            stderr="fatal: Not possible to fast-forward, aborting.",
        )

    monkeypatch.setattr("syncdock.sync_engine.subprocess.run", _raise_called_process_error)

    ok, message = GitCommandRunner().run("E:\\gitHub\\SyncDock", ["pull", "--ff-only"], 30)

    assert ok is False
    assert message == "同步失败，需要手动处理分支差异"
