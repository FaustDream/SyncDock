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
    """管理多个同步 session 的事件队列，线程安全。"""

    def __init__(self) -> None:
        self._queues: dict[str, queue.Queue] = {}
        self._lock = threading.Lock()
        self._counter: dict[str, int] = {}

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

    def make_callback(self, session_id: str, total: int):
        """生成一个 progress_callback，绑定到指定 session 的队列。

        返回的 callback 可与 sync_engine 的 progress_callback 参数对接。
        """
        def callback(result: SyncResult) -> None:
            with self._lock:
                q = self._queues.get(session_id)
                if q is None:
                    return
                self._counter[session_id] += 1
                current = self._counter[session_id]
            q.put({
                "event": "progress",
                "name": result.name,
                "outcome": result.outcome,
                "message": result.message,
                "progress": current,
                "total": total,
            })

        return callback

    def push_complete(self, session_id: str, summary: dict) -> None:
        """推送同步完成事件。"""
        q = self.get_queue(session_id)
        if q is None:
            return
        q.put({"event": "complete", "summary": summary})

    def cleanup(self, session_id: str) -> None:
        """清理 session 数据。"""
        with self._lock:
            self._queues.pop(session_id, None)
            self._counter.pop(session_id, None)

    @property
    def active_sessions(self) -> int:
        """当前活跃的 session 数量。"""
        with self._lock:
            return len(self._queues)


# 全局单例
sse_manager = SSEManager()
