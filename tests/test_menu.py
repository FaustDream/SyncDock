from __future__ import annotations

from syncdock.config_service import RepositoryConfig, RuntimeConfig, SettingsConfig
from syncdock.menu import _collect_status_rows, _sync_repositories_with_progress
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


def test_collect_status_rows_advances_progress_for_enabled_repositories() -> None:
    created: list[FakeProgress] = []
    runtime = build_runtime()

    class Checker:
        def inspect(self, repository, settings):
            return {"message": f"{repository.name}状态"}

    rows = _collect_status_rows(runtime, Checker(), progress_factory=build_progress_factory(created))

    assert rows == [("仓库A", "仓库A状态"), ("仓库C", "仓库C状态")]
    assert created[0].title == "查询仓库状态"
    assert created[0].total == 2
    assert "仓库A" in created[0].details[0]
    assert "仓库C" in created[0].details[1]


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
