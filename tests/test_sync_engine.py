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

    result = sync_single_repository(repository, settings, checker=FakeChecker(), git_runner=None)

    assert result.outcome == "UP_TO_DATE"
    assert result.message == "已经是最新"
