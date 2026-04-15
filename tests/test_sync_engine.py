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
