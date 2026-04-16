from __future__ import annotations

from syncdock.config_service import RepositoryConfig, SettingsConfig
from syncdock.sync_engine import SyncResult, force_sync_single_repository, sync_all_repositories


def test_sync_all_repositories_reports_progress_for_each_enabled_repository(monkeypatch) -> None:
    repositories = [
        RepositoryConfig(name="仓库A", path="A", enabled=True),
        RepositoryConfig(name="仓库B", path="B", enabled=False),
        RepositoryConfig(name="仓库C", path="C", enabled=True),
    ]
    settings = SettingsConfig(
        concurrent_limit=2,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )
    progress_names: list[str] = []

    def fake_sync(repository, settings, *, checker, git_runner):
        return SyncResult(repository.name, "UP_TO_DATE", "已经是最新")

    monkeypatch.setattr("syncdock.sync_engine.sync_single_repository", fake_sync)

    results = sync_all_repositories(
        repositories,
        settings,
        checker=object(),
        git_runner=object(),
        progress_callback=lambda result: progress_names.append(result.name),
    )

    assert [item.name for item in results] == ["仓库A", "仓库C"]
    assert sorted(progress_names) == ["仓库A", "仓库C"]


def test_force_sync_single_repository_ignores_workspace_change_checks() -> None:
    repository = RepositoryConfig(name="仓库A", path="A", enabled=True)
    settings = SettingsConfig(
        concurrent_limit=2,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=True,
        log_retention_days=30,
    )
    commands: list[list[str]] = []

    class Checker:
        def inspect(
            self,
            repository,
            settings,
            *,
            ignore_uncommitted_changes: bool = False,
            ignore_untracked_files: bool = False,
        ):
            if not ignore_uncommitted_changes or not ignore_untracked_files:
                return {"kind": "skipped", "message": "已跳过，有本地改动", "needs_pull": False}
            return {"kind": "ready", "message": "需要同步", "needs_pull": True}

    class GitRunner:
        def run(self, cwd: str, args: list[str], timeout_seconds: int):
            commands.append(args)
            return True, "ok"

    result = force_sync_single_repository(repository, settings, checker=Checker(), git_runner=GitRunner())

    assert result == SyncResult("仓库A", "UPDATED", "已强制同步到远端最新状态")
    assert commands == [
        ["fetch", "--all", "--prune"],
        ["reset", "--hard", "@{upstream}"],
        ["clean", "-fd"],
    ]
