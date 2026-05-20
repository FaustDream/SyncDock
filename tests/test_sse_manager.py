"""测试 SSEManager：session 生命周期、取消标记、phase 事件。"""

import time

import pytest

from syncdock.gui.sse_manager import SSEManager
from syncdock.sync_engine import SyncResult


@pytest.fixture
def manager():
    """返回一个干净的 SSEManager 实例。"""
    return SSEManager()


def test_create_session(manager):
    """create_session 应返回非空字符串且不重复。"""
    s1 = manager.create_session()
    s2 = manager.create_session()
    assert isinstance(s1, str) and len(s1) > 0
    assert s1 != s2


def test_get_queue_returns_queue_for_valid_session(manager):
    """已创建的 session 应能获取到队列。"""
    session_id = manager.create_session()
    q = manager.get_queue(session_id)
    assert q is not None


def test_get_queue_returns_none_for_unknown_session(manager):
    """未创建的 session 应返回 None。"""
    q = manager.get_queue("nonexistent")
    assert q is None


def test_cleanup_removes_session(manager):
    """cleanup 后 session 队列和计数器应被移除。"""
    session_id = manager.create_session()
    manager.cleanup(session_id)
    assert manager.get_queue(session_id) is None
    assert manager.active_sessions == 0


def test_active_sessions_count(manager):
    """active_sessions 应正确反映当前 session 数量。"""
    s1 = manager.create_session()
    assert manager.active_sessions == 1
    s2 = manager.create_session()
    assert manager.active_sessions == 2
    manager.cleanup(s1)
    assert manager.active_sessions == 1
    manager.cleanup(s2)
    assert manager.active_sessions == 0


def test_cancel_session_marks_cancelled(manager):
    """cancel_session 后 is_cancelled 应返回 True。"""
    session_id = manager.create_session()
    assert not manager.is_cancelled(session_id)
    manager.cancel_session(session_id)
    assert manager.is_cancelled(session_id)


def test_cancel_unknown_session_no_error(manager):
    """取消不存在的 session 不应抛出异常。"""
    manager.cancel_session("does-not-exist")


def test_cleanup_removes_cancel_flag(manager):
    """cleanup 后取消标记也应被清除。"""
    session_id = manager.create_session()
    manager.cancel_session(session_id)
    assert manager.is_cancelled(session_id)
    manager.cleanup(session_id)
    assert not manager.is_cancelled(session_id)


def test_make_callback_increments_counter(manager):
    """make_callback 每次调用应递增 counter。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=5)
    result = SyncResult("alpha", "UP_TO_DATE", "ok")
    cb(result)
    cb(result)
    with manager._lock:
        assert manager._counter.get(session_id) == 2


def test_make_callback_queue_events(manager):
    """make_callback 应把事件放入队列。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=3)
    result = SyncResult("beta", "FAILED", "网络异常")
    cb(result)

    q = manager.get_queue(session_id)
    event = q.get(timeout=1)
    assert event["event"] == "progress"
    assert event["name"] == "beta"
    assert event["outcome"] == "FAILED"
    assert event["message"] == "网络异常"
    assert event["progress"] == 1
    assert event["total"] == 3


def test_make_callback_with_phase(manager):
    """make_callback 支持 phase 参数，事件中应包含 phase 字段。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=1)
    result = SyncResult("gamma", "UP_TO_DATE", "已经是最新")
    cb(result, phase="scanning")

    q = manager.get_queue(session_id)
    event = q.get(timeout=1)
    assert event["phase"] == "scanning"
    assert event["name"] == "gamma"


def test_make_callback_includes_status_code_when_present(manager):
    """同步结果携带精确状态码时，SSE 事件应传给前端做状态列映射。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=1)
    result = SyncResult("gamma", "SKIPPED", "已跳过，当前分支未设置同步目标", status_code="no_upstream")
    cb(result)

    q = manager.get_queue(session_id)
    event = q.get(timeout=1)
    assert event["status_code"] == "no_upstream"


def test_make_callback_without_phase_no_phase_field(manager):
    """不传 phase 时事件中不应包含 phase 字段，保持向后兼容。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=1)
    result = SyncResult("delta", "UPDATED", "已更新")
    cb(result)

    q = manager.get_queue(session_id)
    event = q.get(timeout=1)
    assert "phase" not in event


def test_push_complete_sends_complete_event(manager):
    """push_complete 应把 complete 事件放入队列。"""
    session_id = manager.create_session()
    manager.push_complete(session_id, {"total": 2, "updated": 1})
    q = manager.get_queue(session_id)
    event = q.get(timeout=1)
    assert event["event"] == "complete"
    assert event["summary"]["total"] == 2


def test_push_complete_unknown_session_no_error(manager):
    """对不存在的 session 调用 push_complete 不应抛出异常。"""
    manager.push_complete("nonexistent", {"total": 0})


def test_callback_after_cleanup_does_nothing(manager):
    """cleanup 后调用 callback 不应抛出异常，计数器不应递增。"""
    session_id = manager.create_session()
    cb = manager.make_callback(session_id, total=1)
    result = SyncResult("epsilon", "SKIPPED", "已跳过")
    manager.cleanup(session_id)
    cb(result)  # 不应抛出异常


def test_multiple_callbacks_independent(manager):
    """不同 session 的 callback 应互不影响。"""
    s1 = manager.create_session()
    s2 = manager.create_session()
    cb1 = manager.make_callback(s1, total=2)
    cb2 = manager.make_callback(s2, total=3)

    cb1(SyncResult("a", "UPDATED", "ok"))
    cb2(SyncResult("b", "FAILED", "err"))

    with manager._lock:
        assert manager._counter[s1] == 1
        assert manager._counter[s2] == 1
