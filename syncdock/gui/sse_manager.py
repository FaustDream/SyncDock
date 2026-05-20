"""SSE 事件流管理器。

管理同步 session 的生命周期和事件队列。
后台同步线程通过队列推送事件，SSE 端点异步消费。
"""

from __future__ import annotations

import queue
import threading
from uuid import uuid4

from syncdock.sync_engine import SyncResult


class SSEManager:
    """管理多个同步 session 的事件队列与取消标记，线程安全。"""

    def __init__(self) -> None:
        self._queues: dict[str, queue.Queue] = {}
        self._lock = threading.Lock()
        self._counter: dict[str, int] = {}
        self._cancelled: set[str] = set()


    def create_session(self) -> str:
        """创建一个新的同步 session，返回 session_id。"""
        session_id = uuid4().hex
        with self._lock:
            self._queues[session_id] = queue.Queue()
            self._counter[session_id] = 0
        return session_id

    def get_queue(self, session_id: str) -> queue.Queue | None:
        """获取指定 session 的事件队列（线程安全）。"""
        with self._lock:
            return self._queues.get(session_id)

    def cancel_session(self, session_id: str) -> None:
        """标记指定 session 为已取消，后台线程将在下一个仓库分片前退出。"""
        with self._lock:
            self._cancelled.add(session_id)

    def is_cancelled(self, session_id: str) -> bool:
        """检查指定 session 是否已被取消（线程安全）。"""
        with self._lock:
            return session_id in self._cancelled

    def make_callback(self, session_id: str, total: int):
        """生成一个 progress_callback，绑定到指定 session 的队列。

        返回的 callback 可与 sync_engine 的 progress_callback 参数对接。
        调用时可传入 ``phase`` 关键字参数（如 ``phase="scanning"``），
        不传时事件中不包含 ``phase`` 字段，保持向后兼容。
        """
        def callback(result: SyncResult, *, phase: str | None = None) -> None:
            with self._lock:
                q = self._queues.get(session_id)
                if q is None:
                    return
                self._counter[session_id] += 1
                current = self._counter[session_id]
            event = {
                "event": "progress",
                "name": result.name,
                "outcome": result.outcome,
                "message": result.message,
                "progress": current,
                "total": total,
            }
            if result.status_code is not None:
                event["status_code"] = result.status_code
            if phase is not None:
                event["phase"] = phase
            q.put(event)

        return callback

    def push_complete(self, session_id: str, summary: dict) -> None:
        """推送同步完成事件。"""
        q = self.get_queue(session_id)
        if q is None:
            return
        q.put({"event": "complete", "summary": summary})

    def cleanup(self, session_id: str) -> None:
        """清理 session 数据，包括取消标记。"""
        with self._lock:
            self._queues.pop(session_id, None)
            self._counter.pop(session_id, None)
            self._cancelled.discard(session_id)

    @property
    def active_sessions(self) -> int:
        """当前活跃的 session 数量。"""
        with self._lock:
            return len(self._queues)


# 全局单例
sse_manager = SSEManager()
