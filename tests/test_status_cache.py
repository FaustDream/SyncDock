"""测试 StatusCache：存储、读取、TTL、过期、裁剪、占位。"""

import time

import pytest

from syncdock.status_cache import StatusCache
from syncdock.config_service import RepositoryConfig
from syncdock.sync_engine import SyncResult


@pytest.fixture
def cache():
    """返回一个干净的状态缓存实例，TTL 设为 60 秒。"""
    return StatusCache(ttl_seconds=60)


@pytest.fixture
def fast_cache():
    """返回 TTL 极短的缓存，用于测试过期行为。"""
    return StatusCache(ttl_seconds=0.05)


def test_put_and_get(cache):
    """存入后应能通过 get 获取到原始行数据。"""
    row = {"name": "alpha", "status_code": "up_to_date", "status_label": "已经是最新"}
    cache.put("alpha", row, source="remote")
    entry = cache.get("alpha")
    assert entry is not None
    assert entry["row"]["status_code"] == "up_to_date"
    assert entry["source"] == "remote"


def test_get_nonexistent_returns_none(cache):
    """不存在的仓库应返回 None。"""
    assert cache.get("nonexistent") is None


def test_get_all_returns_sorted(cache):
    """get_all 应返回按名称排序的行列表。"""
    cache.put("beta", {"name": "beta", "status_code": "needs_sync"}, source="remote")
    cache.put("alpha", {"name": "alpha", "status_code": "up_to_date"}, source="remote")
    rows = cache.get_all()
    assert len(rows) == 2
    assert rows[0]["name"] == "alpha"
    assert rows[1]["name"] == "beta"


def test_snapshot_applies_metadata(cache):
    """snapshot 应为每行补齐 cached/stale/fetched_at/source 元数据。"""
    cache.put("alpha", {"name": "alpha", "status_code": "up_to_date"}, source="remote")
    rows = cache.snapshot(valid_repos=[RepositoryConfig(name="alpha", path="/tmp/a", enabled=True, author_type=True)])
    assert len(rows) == 1
    assert rows[0]["cached"] is True
    assert rows[0]["stale"] is False
    assert rows[0]["source"] == "remote"


def test_snapshot_placeholder_for_unknown(cache):
    """未缓存的仓库应在 snapshot 中返回占位状态。"""
    rows = cache.snapshot(valid_repos=[
        RepositoryConfig(name="alpha", path="/tmp/a", enabled=True, author_type=True),
        RepositoryConfig(name="beta", path="/tmp/b", enabled=True, author_type=True),
    ])
    alpha = next(r for r in rows if r["name"] == "alpha")
    assert alpha["cached"] is False
    assert alpha["stale"] is True
    assert alpha["source"] == "placeholder"


def test_ttl_expiry(fast_cache):
    """TTL 过期后的条目应在 snapshot 中标记为 stale。"""
    fast_cache.put("alpha", {"name": "alpha", "status_code": "up_to_date"}, source="remote")
    time.sleep(0.06)
    entry = fast_cache.get("alpha")
    assert entry is not None
    # 即使过期仍可获取原始数据，但 snapshot 会标记 stale
    repo = RepositoryConfig(name="alpha", path="/tmp/a", enabled=True, author_type=True)
    rows = fast_cache.snapshot(valid_repos=[repo])
    assert rows[0]["stale"] is True


def test_trim_removes_stale_names(cache):
    """trim 应移除不在 valid_names 中的条目。"""
    cache.put("alpha", {"name": "alpha"}, source="remote")
    cache.put("beta", {"name": "beta"}, source="remote")
    cache.trim(valid_names={"alpha"})
    assert cache.get("alpha") is not None
    assert cache.get("beta") is None


def test_trim_empty_cache_does_not_error(cache):
    """对空缓存调用 trim 不应抛出异常。"""
    cache.trim(valid_names={"alpha"})


def test_put_overwrites_existing(cache):
    """重复 put 同一仓库应覆盖旧数据并刷新 cached_at。"""
    cache.put("alpha", {"name": "alpha", "status_code": "needs_sync"}, source="remote")
    old = cache.get("alpha")
    old_cached_at = old["cached_at_monotonic"]

    time.sleep(0.05)
    cache.put("alpha", {"name": "alpha", "status_code": "up_to_date"}, source="sync_result")
    new = cache.get("alpha")
    assert new["row"]["status_code"] == "up_to_date"
    assert new["source"] == "sync_result"
    assert new["cached_at_monotonic"] > old_cached_at


def test_ttl_seconds_property(cache):
    """ttl_seconds 属性应返回构造时传入的值。"""
    assert cache.ttl_seconds == 60


def test_clear(cache):
    """clear 应清空所有缓存条目。"""
    cache.put("alpha", {"name": "alpha"}, source="remote")
    cache.put("beta", {"name": "beta"}, source="remote")
    cache.clear()
    assert cache.get("alpha") is None
    assert cache.get("beta") is None
    assert len(cache.get_all()) == 0


def test_snapshot_respects_disabled_placeholder(cache):
    """已禁用仓库即使未缓存也应返回已禁用的占位状态。"""
    repos = [
        RepositoryConfig(name="alpha", path="/tmp/a", enabled=False, author_type=True),
    ]
    rows = cache.snapshot(valid_repos=repos)
    assert rows[0]["status_code"] == "disabled"
    assert rows[0]["source"] == "placeholder"


def test_build_from_sync_result_preserves_needs_sync_status():
    """扫描阶段发现需要同步时，缓存状态必须保留为 needs_sync。"""
    row = StatusCache.build_from_sync_result(SyncResult("alpha", "NEEDS_SYNC", "需要同步"))

    assert row["status_code"] == "needs_sync"
    assert row["status_label"] == "需要同步"


def test_build_from_sync_result_uses_explicit_status_code():
    """同步结果携带精确状态码时，缓存不能把所有 SKIPPED 都归为本地修改。"""
    row = StatusCache.build_from_sync_result(
        SyncResult("alpha", "SKIPPED", "已跳过，当前分支未设置同步目标", status_code="no_upstream")
    )

    assert row["status_code"] == "no_upstream"
    assert row["status_label"] == "已跳过，当前分支未设置同步目标"
