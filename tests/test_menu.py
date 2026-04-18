from __future__ import annotations

from pathlib import Path

from syncdock.config_service import RepositoryConfig, RuntimeConfig, SettingsConfig
from syncdock.menu import (
    _collect_repositories_needing_sync,
    _collect_retry_repositories,
    _collect_status_rows,
    _select_enabled_repositories,
    _sync_repositories_with_progress,
    render_main_menu,
    run_menu,
)
from syncdock.sync_engine import SyncResult


class FakeProgress:
    def __init__(self, title: str, total: int) -> None:
        self.title = title
        self.total = total
        self.details: list[str] = []

    def advance(self, detail: str = "") -> None:
        self.details.append(detail)


def build_runtime() -> RuntimeConfig:
    return RuntimeConfig(
        repositories=[
            RepositoryConfig(name="仓库A", path="A", enabled=True),
            RepositoryConfig(name="仓库B", path="B", enabled=False),
            RepositoryConfig(name="仓库C", path="C", enabled=True),
        ],
        settings=SettingsConfig(
            concurrent_limit=3,
            command_timeout_seconds=120,
            skip_uncommitted_changes=True,
            skip_untracked_files=False,
            log_retention_days=30,
        ),
    )


def build_progress_factory(created: list[FakeProgress]):
    def factory(title: str, total: int) -> FakeProgress:
        progress = FakeProgress(title, total)
        created.append(progress)
        return progress

    return factory


def build_settings() -> SettingsConfig:
    return SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )


def test_collect_status_rows_advances_progress_for_enabled_repositories() -> None:
    created: list[FakeProgress] = []
    runtime = build_runtime()
    refresh_flags: list[bool] = []

    class Checker:
        def inspect(self, repository, settings, *, refresh_remote: bool = False):
            refresh_flags.append(refresh_remote)
            return {
                "message": f"{repository.name}状态",
                "branch_name": "main",
                "upstream_name": "origin/main",
                "ahead_count": 0,
                "behind_count": 1,
            }

    rows = _collect_status_rows(runtime, Checker(), progress_factory=build_progress_factory(created))

    assert "仓库A状态" in rows[0][1]
    assert "分支 main -> origin/main" in rows[0][1]
    assert refresh_flags == [True, True]
    assert created[0].title == "查询仓库状态"
    assert created[0].total == 2
    assert "仓库A" in created[0].details[0]
    assert "仓库C" in created[0].details[1]


def test_select_enabled_repositories_sorts_self_repositories_first(capsys) -> None:
    runtime = RuntimeConfig(
        repositories=[
            RepositoryConfig(name="zeta", path="Z", enabled=True, author_type=False),
            RepositoryConfig(name="beta", path="B", enabled=True, author_type=True),
            RepositoryConfig(name="alpha", path="A", enabled=True, author_type=True),
            RepositoryConfig(name="aardvark", path="AA", enabled=True, author_type=False),
        ],
        settings=build_settings(),
    )

    repositories = _select_enabled_repositories(runtime)

    output = capsys.readouterr().out
    assert [item.name for item in repositories] == ["alpha", "beta", "aardvark", "zeta"]
    assert output.index("alpha") < output.index("beta") < output.index("aardvark") < output.index("zeta")


def test_collect_status_rows_sorts_self_repositories_first() -> None:
    runtime = RuntimeConfig(
        repositories=[
            RepositoryConfig(name="zeta", path="Z", enabled=True, author_type=False),
            RepositoryConfig(name="beta", path="B", enabled=True, author_type=True),
            RepositoryConfig(name="alpha", path="A", enabled=True, author_type=True),
            RepositoryConfig(name="aardvark", path="AA", enabled=True, author_type=False),
        ],
        settings=build_settings(),
    )

    class Checker:
        def inspect(self, repository, settings, *, refresh_remote: bool = False):
            return {
                "message": "已经是最新",
                "branch_name": "main",
                "upstream_name": "origin/main",
                "ahead_count": 0,
                "behind_count": 0,
            }

    rows = _collect_status_rows(runtime, Checker(), progress_factory=build_progress_factory([]))

    assert [name for name, _ in rows] == ["alpha", "beta", "aardvark", "zeta"]


def test_collect_repositories_needing_sync_returns_only_outdated_or_problematic_items() -> None:
    runtime = build_runtime()

    class Checker:
        def inspect(
            self,
            repository,
            settings,
            *,
            refresh_remote: bool = False,
            ignore_uncommitted_changes: bool = False,
            ignore_untracked_files: bool = False,
            ignore_divergence: bool = False,
        ):
            if repository.name == "仓库A":
                return {"kind": "ready", "message": "需要同步", "needs_pull": True, "status_code": "needs_sync"}
            return {"kind": "ready", "message": "已经是最新", "needs_pull": False, "status_code": "up_to_date"}

    repositories, issue_results = _collect_repositories_needing_sync(runtime, Checker())

    assert [item.name for item in repositories] == ["仓库A"]
    assert issue_results == []


def test_collect_retry_repositories_skips_missing_or_disabled_items() -> None:
    runtime = build_runtime()

    repositories, issue_results = _collect_retry_repositories(runtime, ["仓库A", "仓库B", "仓库X"])

    assert [item.name for item in repositories] == ["仓库A"]
    assert issue_results == [
        SyncResult("仓库B", "SKIPPED", "已跳过，仓库未启用"),
        SyncResult("仓库X", "INVALID", "仓库无效，当前配置中不存在"),
    ]


def test_sync_repositories_with_progress_advances_for_each_repository(monkeypatch) -> None:
    created: list[FakeProgress] = []
    runtime = build_runtime()
    selected = [runtime.repositories[0], runtime.repositories[2]]
    called: list[str] = []

    def fake_sync(repository, settings, *, checker, git_runner):
        called.append(repository.name)
        return SyncResult(repository.name, "UP_TO_DATE", "已经是最新")

    monkeypatch.setattr("syncdock.menu.sync_single_repository", fake_sync)

    results = _sync_repositories_with_progress(
        selected,
        runtime.settings,
        checker=object(),
        git_runner=object(),
        force=False,
        progress_factory=build_progress_factory(created),
    )

    assert called == ["仓库A", "仓库C"]
    assert [item.name for item in results] == ["仓库A", "仓库C"]
    assert created[0].title == "同步进度"
    assert created[0].total == 2
    assert "仓库A" in created[0].details[0]
    assert "仓库C" in created[0].details[1]


def test_run_menu_keeps_running_when_force_sync_raises(monkeypatch, capsys) -> None:
    runtime = build_runtime()
    inputs = iter(["9", "0"])

    def fake_input(prompt: str) -> str:
        return next(inputs)

    def fake_sync_selected(runtime, checker, git_runner, log_dir, *, force: bool, progress_factory=None) -> None:
        assert force is True
        raise RuntimeError("模拟强制同步异常")

    monkeypatch.setattr("builtins.input", fake_input)
    monkeypatch.setattr("syncdock.menu._sync_selected", fake_sync_selected)

    result = run_menu(runtime, silent=False, checker=object(), git_runner=object())

    output = capsys.readouterr().out
    assert result == 0
    assert "操作执行失败：模拟强制同步异常" in output


def test_render_main_menu_shows_single_recent_failure_entry() -> None:
    menu = render_main_menu()

    assert "5. 仅同步需要同步的仓库" in menu
    assert "6. 重试最近失败仓库" in menu
    assert "7. 查看最近 N 次日志" in menu
    assert "9. 强制同步指定仓库（可多选）" in menu


def test_run_menu_shows_recent_failure_reason(monkeypatch, capsys) -> None:
    runtime = build_runtime()
    inputs = iter(["4", "0"])

    def fake_input(prompt: str) -> str:
        return next(inputs)

    monkeypatch.setattr("builtins.input", fake_input)
    monkeypatch.setattr(
        "syncdock.menu.read_latest_log",
        lambda log_dir: "最近日志：sync.log\n\n仓库B: 网络连接异常",
    )

    result = run_menu(runtime, silent=False, checker=object(), git_runner=object(), log_dir=Path("logs"))

    output = capsys.readouterr().out
    assert result == 0
    assert "仓库B: 网络连接异常" in output


def test_run_menu_shows_recent_logs(monkeypatch, capsys) -> None:
    runtime = build_runtime()
    inputs = iter(["7", "2", "0"])

    def fake_input(prompt: str) -> str:
        return next(inputs)

    monkeypatch.setattr("builtins.input", fake_input)
    monkeypatch.setattr(
        "syncdock.menu.read_recent_logs",
        lambda log_dir, limit: "最近 2 次日志\n\n1. sync-a.log\n仓库A: 网络连接异常；建议：检查网络",
    )

    result = run_menu(runtime, silent=False, checker=object(), git_runner=object(), log_dir=Path("logs"))

    output = capsys.readouterr().out
    assert result == 0
    assert "最近 2 次日志" in output


def test_run_menu_retries_recent_failed_repositories(monkeypatch, capsys) -> None:
    runtime = build_runtime()
    inputs = iter(["6", "0"])
    retried: list[str] = []

    def fake_input(prompt: str) -> str:
        return next(inputs)

    monkeypatch.setattr("builtins.input", fake_input)
    monkeypatch.setattr("syncdock.menu.list_latest_failed_repositories", lambda log_dir: [("仓库A", "网络连接异常")])
    monkeypatch.setattr(
        "syncdock.menu._sync_repositories_with_progress",
        lambda repositories, settings, *, checker, git_runner, mode, progress_factory=None: retried.extend(
            item.name for item in repositories
        ) or [SyncResult("仓库A", "UPDATED", "已拉取远端最新代码")],
    )

    result = run_menu(runtime, silent=False, checker=object(), git_runner=object(), log_dir=Path("logs"))

    output = capsys.readouterr().out
    assert result == 0
    assert retried == ["仓库A"]
    assert "仓库A: 已拉取远端最新代码" in output
