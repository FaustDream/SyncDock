"""测试 `run_repositories_concurrently`：保序、异常隔离、回调、并发上限、取消门禁。"""

from concurrent.futures import ThreadPoolExecutor
from functools import partial
import threading

import pytest

from syncdock.config_service import RepositoryConfig, SettingsConfig
import syncdock.sync_engine as sync_engine
from syncdock.sync_engine import SyncResult, run_repositories_concurrently


# ═══════════════════════════════════════════════════
# RED：先写失败测试
# ═══════════════════════════════════════════════════

def test_preserves_input_order(settings, sample_repos):
    """并发执行结束后，返回结果顺序必须与输入仓库顺序一致。"""
    def worker(repo: RepositoryConfig) -> SyncResult:
        # 故意让第二个仓库先完成，测试保序
        if repo.name == "beta":
            return SyncResult(repo.name, "UPDATED", "beta 先完成")
        if repo.name == "alpha":
            return SyncResult(repo.name, "UPDATED", "alpha 延迟完成")
        return SyncResult(repo.name, "UP_TO_DATE", "已经是最新")

    results = run_repositories_concurrently(sample_repos, settings, worker)

    assert len(results) == len(sample_repos)
    for result, repo in zip(results, sample_repos):
        assert result.name == repo.name, f"期望 {repo.name} 在位置 {repo.name}，实际 {result.name}"


def test_exception_isolation(settings, sample_repos):
    """单个仓库抛出异常不应影响其他仓库的结果。"""
    def worker(repo: RepositoryConfig) -> SyncResult:
        if repo.name == "beta":
            msg = Exception("模拟异常")
            raise msg
        return SyncResult(repo.name, "UP_TO_DATE", "正常完成")

    results = run_repositories_concurrently(sample_repos, settings, worker)

    assert len(results) == 4
    beta_result = next(r for r in results if r.name == "beta")
    assert beta_result.outcome == "FAILED", "异常仓库应返回 FAILED"
    alpha_result = next(r for r in results if r.name == "alpha")
    assert alpha_result.outcome == "UP_TO_DATE", "正常仓库不受影响"


def test_callback_invoked_per_result(settings, sample_repos):
    """每个仓库分片完成后回调应被调用一次，且总数等于仓库数。
    注意：回调按完成顺序调用，不保证与输入顺序一致。
    """
    def worker(repo: RepositoryConfig) -> SyncResult:
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    callbacks = []

    def progress_callback(result: SyncResult) -> None:
        callbacks.append(result.name)

    run_repositories_concurrently(sample_repos, settings, worker, progress_callback=progress_callback)

    assert len(callbacks) == 4
    assert set(callbacks) == {"alpha", "beta", "gamma", "delta"}


def test_cancelled_skips_remaining(settings, sample_repos):
    """当 is_cancelled 返回 True 时，未提交的分片应被跳过并以 SKIPPED 标记。"""
    processed = []

    def worker(repo: RepositoryConfig) -> SyncResult:
        processed.append(repo.name)
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    callbacks = []
    cancel_after = 2  # 处理完 2 个之后取消

    def cancelled_checker() -> bool:
        return len(processed) >= cancel_after

    def progress_callback(result: SyncResult) -> None:
        callbacks.append((result.name, result.outcome))

    results = run_repositories_concurrently(
        sample_repos, settings, worker,
        progress_callback=progress_callback,
        is_cancelled=cancelled_checker,
    )

    # 至少有一个仓库被标记为 SKIPPED
    skipped = [r for r in results if r.outcome == "SKIPPED"]
    assert len(skipped) > 0, "取消标记后应有仓库被跳过"

    # 被跳过的仓库消息应为 "已取消"
    for r in skipped:
        assert r.message == "已取消"


def test_cancelled_does_not_run_work_waiting_in_queue(settings, sample_repos):
    """取消发生后，尚未开始的仓库不能继续进入 Git worker。"""
    settings.concurrent_limit = 1
    started = threading.Event()
    release = threading.Event()
    processed: list[str] = []
    cancel_requested = False
    result_holder: dict[str, list[SyncResult]] = {}

    def worker(repo: RepositoryConfig) -> SyncResult:
        processed.append(repo.name)
        started.set()
        release.wait(timeout=2)
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    def cancelled_checker() -> bool:
        return cancel_requested

    def run_target() -> None:
        result_holder["results"] = run_repositories_concurrently(
            sample_repos,
            settings,
            worker,
            is_cancelled=cancelled_checker,
        )

    runner = threading.Thread(target=run_target)
    runner.start()
    assert started.wait(timeout=1), "第一个仓库分片应先开始执行"

    cancel_requested = True
    release.set()
    runner.join(timeout=2)

    assert not runner.is_alive(), "取消后并发执行器不应卡住"
    assert processed == ["alpha"]
    results = result_holder["results"]
    assert [item.outcome for item in results] == ["UP_TO_DATE", "SKIPPED", "SKIPPED", "SKIPPED"]
    assert [item.message for item in results[1:]] == ["已取消", "已取消", "已取消"]


def test_sync_all_repositories_passes_cancellation_to_executor(settings, sample_repos):
    """全部同步也必须传递取消门禁，避免 GUI all 模式取消后继续提交仓库分片。"""
    results = sync_engine.sync_all_repositories(
        sample_repos,
        settings,
        checker=object(),
        git_runner=object(),
        is_cancelled=lambda: True,
    )

    assert len(results) == len(sample_repos)
    assert all(item.outcome == "SKIPPED" for item in results)
    assert all(item.message == "已取消" for item in results)


def test_min_concurrent_one(settings, sample_repos):
    """concurrent_limit 为 0 或负数时，仍应至少使用 1 个工作线程。"""
    limited_settings = SettingsConfig(
        concurrent_limit=0,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
        proxy_port=28203,
    )

    def worker(repo: RepositoryConfig) -> SyncResult:
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    results = run_repositories_concurrently(sample_repos, limited_settings, worker)
    assert len(results) == 4


def test_concurrent_limit_clamped_to_hard_max(monkeypatch, settings, sample_repos):
    """用户配置过大时，实际线程池上限不能超过全局 Git 进程硬上限。"""
    observed = []

    class RecordingExecutor(ThreadPoolExecutor):
        """记录真实传给线程池的 max_workers，仍复用标准线程池行为。"""

        def __init__(self, max_workers=None, *args, **kwargs):
            observed.append(max_workers)
            super().__init__(max_workers=max_workers, *args, **kwargs)

    monkeypatch.setattr(sync_engine, "ThreadPoolExecutor", RecordingExecutor)
    settings.concurrent_limit = 16

    def worker(repo: RepositoryConfig) -> SyncResult:
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    run_repositories_concurrently(sample_repos, settings, worker)

    assert observed == [6]


def test_disabled_repos_not_excluded(settings, mixed_repos):
    """run_repositories_concurrently 不自动过滤禁用仓库，由调用方决定是否传入。"""
    def worker(repo: RepositoryConfig) -> SyncResult:
        return SyncResult(repo.name, "SKIPPED" if not repo.enabled else "UP_TO_DATE", "ok")

    results = run_repositories_concurrently(mixed_repos, settings, worker)
    names = {r.name for r in results}
    assert "bob" in names, "禁用仓库应仍被传入的用户决定如何处理"


def test_result_has_no_none(settings, sample_repos):
    """返回结果列表中不应混入 None。"""
    def worker(repo: RepositoryConfig) -> SyncResult:
        return SyncResult(repo.name, "UP_TO_DATE", "ok")

    results = run_repositories_concurrently(sample_repos, settings, worker)
    assert all(r is not None for r in results)


# ═══════════════════════════════════════════════════
# GREEN：verify RED → write minimal code → verify GREEN
# ═══════════════════════════════════════════════════
