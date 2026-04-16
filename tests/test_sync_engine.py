from __future__ import annotations

from syncdock.config_service import RepositoryConfig, SettingsConfig
from syncdock.sync_engine import SyncResult, sync_all_repositories


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
