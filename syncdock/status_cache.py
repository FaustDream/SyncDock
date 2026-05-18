"""状态缓存模块。

提供线程安全的内存状态缓存，支持 TTL、过期标记、占位状态和仓库列表同步。
用于避免对同一仓库的重复远端 Git fetch，降低状态查询开销。
"""

from __future__ import annotations

import threading
import time
from datetime import datetime

from syncdock.config_service import RepositoryConfig
from syncdock.sync_engine import SyncResult


class StatusCache:
    """线程安全的内存状态缓存。

    每个仓库以名称为主线索引，存储状态行数据、来源和插入时间。
    TTL 过期后仍可获取原始数据（避免空窗期），但 ``snapshot`` 会标记为 stale。
    """

    def __init__(self, ttl_seconds: int = 60) -> None:
        self._ttl_seconds = ttl_seconds
        self._data: dict[str, dict] = {}
        self._lock = threading.Lock()

    # ── 公共属性 ────────────────────────────────────

    @property
    def ttl_seconds(self) -> int:
        """缓存过期时间（秒）。"""
        return self._ttl_seconds

    # ── 核心存取 ────────────────────────────────────

    def put(self, name: str, row: dict, *, source: str) -> None:
        """存储或覆盖单个仓库的状态行。"""
        normalized = dict(row)
        fetched_at = normalized.get("fetched_at") or self._current_timestamp()
        normalized["fetched_at"] = fetched_at
        with self._lock:
            self._data[name] = {
                "row": normalized,
                "fetched_at": fetched_at,
                "source": source,
                "cached_at_monotonic": time.monotonic(),
            }

    def get(self, name: str) -> dict | None:
        """获取单个仓库的缓存条目，未命中返回 None。

        返回结构：:
            {"row": {...}, "fetched_at": str, "source": str, "cached_at_monotonic": float}
        """
        with self._lock:
            return self._data.get(name)

    def get_all(self) -> list[dict]:
        """返回全部缓存的纯净行列表（按名称排序），不含缓存元数据。"""
        with self._lock:
            rows = [entry["row"] for entry in self._data.values()]
        return sorted(rows, key=lambda item: item.get("name", "").casefold())

    def clear(self) -> None:
        """清空所有缓存条目。"""
        with self._lock:
            self._data.clear()

    # ── 裁剪与快照 ──────────────────────────────────

    def trim(self, valid_names: set[str]) -> None:
        """移除不在 ``valid_names`` 中的条目。"""
        with self._lock:
            stale_names = [name for name in self._data if name not in valid_names]
            for name in stale_names:
                self._data.pop(name, None)

    def snapshot(self, valid_repos: list[RepositoryConfig]) -> list[dict]:
        """根据当前仓库配置生成状态快照。

        命中缓存的仓库返回缓存数据（附带 cached/stale 元数据）；
        未命中的仓库降级为占位状态，让前端可立即渲染。
        """
        rows: list[dict] = []
        now_monotonic = time.monotonic()
        with self._lock:
            for repo in valid_repos:
                cached_entry = self._data.get(repo.name)
                if cached_entry is None:
                    rows.append(
                        self._attach_metadata(
                            self._build_placeholder(repo),
                            cached=False,
                            stale=True,
                            fetched_at=None,
                            source="placeholder",
                        )
                    )
                    continue

                age = now_monotonic - cached_entry["cached_at_monotonic"]
                rows.append(
                    self._attach_metadata(
                        cached_entry["row"],
                        cached=True,
                        stale=age > self._ttl_seconds,
                        fetched_at=cached_entry.get("fetched_at"),
                        source=str(cached_entry.get("source", "cache")),
                    )
                )
        return sorted(rows, key=lambda item: item["name"].casefold())

    # ── 静态工具方法 ────────────────────────────────

    @staticmethod
    def _current_timestamp() -> str:
        """返回带时区的 ISO 时间。"""
        return datetime.now().astimezone().isoformat(timespec="seconds")

    @staticmethod
    def _attach_metadata(
        row: dict,
        *,
        cached: bool,
        stale: bool,
        fetched_at: str | None,
        source: str,
    ) -> dict:
        """统一补齐缓存元数据。"""
        normalized = dict(row)
        normalized["cached"] = cached
        normalized["stale"] = stale
        normalized["fetched_at"] = fetched_at
        normalized["source"] = source
        return normalized

    @staticmethod
    def _build_placeholder(repo: RepositoryConfig) -> dict:
        """为未刷新过的仓库构造占位状态。"""
        if not repo.enabled:
            return {"name": repo.name, "status_code": "disabled", "status_label": "未启用", "detail": ""}
        return {
            "name": repo.name,
            "status_code": "unknown",
            "status_label": "等待刷新",
            "detail": "等待后台刷新远端状态",
        }

    @staticmethod
    def build_from_sync_result(result: SyncResult) -> dict:
        """根据同步结果构造可缓存的状态行。

        用此方法回写缓存后，同步完成时的状态立即可靠，无需再次远端查询。
        """
        outcome_map = {
            "UPDATED": ("up_to_date", "已经是最新"),
            "UP_TO_DATE": ("up_to_date", "已经是最新"),
            "FAILED": ("remote_refresh_failed", "同步失败"),
            "SKIPPED": ("local_changes", "已跳过"),
            "INVALID": ("invalid_path", "仓库无效"),
        }
        status_code, status_label = outcome_map.get(result.outcome, ("unknown", result.message or "状态未知"))
        return {
            "name": result.name,
            "status_code": status_code,
            "status_label": status_label,
            "detail": result.message,
            "fetched_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
