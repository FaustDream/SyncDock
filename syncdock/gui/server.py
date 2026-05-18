"""SyncDock GUI — FastAPI 服务端。

提供 REST API + SSE 实时推送 + 静态前端服务。
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
import threading
import time
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from syncdock.config_service import (
    RepositoryConfig,
    RuntimeConfig,
    SettingsConfig,
    _write_json,
    load_runtime_config,
)
from syncdock.log_service import (
    list_latest_failed_repositories,
    read_recent_logs,
    render_result_line,
    render_summary,
    write_log_session,
)
from syncdock.repo_checker import RepositoryChecker, format_status_detail
from syncdock.status_cache import StatusCache
from syncdock.sync_engine import (
    GitCommandRunner,
    SyncResult,
    force_sync_single_repository,
    run_repositories_concurrently,
    summarize_results,
    sync_all_repositories,
    sync_repository_by_policy,
)

from .sse_manager import sse_manager

# ── 路径 ─────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_CONFIG_DIR = _PROJECT_ROOT / "config"
_LOG_DIR = _PROJECT_ROOT / "logs"
_STATIC_DIR = Path(__file__).resolve().parent / "static"

# ── 全局组件 ─────────────────────────────────────────
_checker = RepositoryChecker()
_git_runner = GitCommandRunner()
_current_runtime: RuntimeConfig | None = None
_status_cache = StatusCache(ttl_seconds=60)
_STATUS_REFRESH_LOCK = threading.Lock()
_ACTIVE_STATUS_REFRESH_SESSION: str | None = None
_ACTIVE_STATUS_REFRESH_TOTAL = 0

# 全局互斥：同步与状态刷新
_SYNC_GLOBAL_LOCK = threading.Lock()
_SYNC_ACTIVE_COUNT = 0       # 当前正在运行的同步线程数


def _is_sync_running() -> bool:
    """判断当前是否有同步任务正在执行，用于状态刷新降级。"""
    with _SYNC_GLOBAL_LOCK:
        return _SYNC_ACTIVE_COUNT > 0


def _increment_sync_count() -> None:
    """启动同步时增加同步计数器。"""
    with _SYNC_GLOBAL_LOCK:
        global _SYNC_ACTIVE_COUNT
        _SYNC_ACTIVE_COUNT += 1


def _decrement_sync_count() -> None:
    """同步完成后减少同步计数器。"""
    with _SYNC_GLOBAL_LOCK:
        global _SYNC_ACTIVE_COUNT
        if _SYNC_ACTIVE_COUNT > 0:
            _SYNC_ACTIVE_COUNT -= 1

# 全局互斥：同步与状态刷新
_SYNC_GLOBAL_LOCK = threading.Lock()
_SYNC_ACTIVE_COUNT = 0       # 当前正在运行的同步线程数


def _get_runtime() -> RuntimeConfig:
    global _current_runtime
    if _current_runtime is None:
        _current_runtime = load_runtime_config(_CONFIG_DIR)
        _trim_status_cache(_current_runtime.repositories)
    return _current_runtime


def _reload_runtime() -> RuntimeConfig:
    global _current_runtime
    _current_runtime = load_runtime_config(_CONFIG_DIR)
    _trim_status_cache(_current_runtime.repositories)
    return _current_runtime


def _current_timestamp() -> str:
    """返回带时区的 ISO 时间，便于前端展示状态缓存的新鲜度。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _cache_status_row(row: dict, *, source: str) -> None:
    """写入单仓库状态缓存，供快照接口直接复用。"""
    _status_cache.put(row["name"], row, source=source)


def _trim_status_cache(repositories: list[RepositoryConfig]) -> None:
    """配置变更后清理已删除仓库的缓存，避免旧仓库状态泄漏到新界面。"""
    valid_names = {repo.name for repo in repositories}
    _status_cache.trim(valid_names)


def _build_status_row_from_inspection(repo: RepositoryConfig, inspection: dict) -> dict:
    """把检查结果标准化成前端状态行，方便缓存、SSE 和同步逻辑共用。"""
    return {
        "name": repo.name,
        "status_code": inspection.get("status_code", "unknown"),
        "status_label": inspection.get("message", "状态未知"),
        "detail": format_status_detail(repo, inspection),
    }


def _cache_status_from_sync_result(result: SyncResult) -> None:
    """同步或扫描完成后立即回写缓存，减少后续无意义的全量状态刷新。"""
    row = StatusCache.build_from_sync_result(result)
    _cache_status_row(row, source="sync_result")


def _snapshot_rows_for_repositories(repositories: list[RepositoryConfig]) -> list[dict]:
    """按当前仓库配置生成状态快照；命中缓存时直接返回，未命中时降级为占位状态。"""
    return _status_cache.snapshot(valid_repos=repositories)


def _is_status_refresh_running() -> bool:
    """判断当前是否已有状态刷新任务在跑，用于做轻量背压。"""
    with _STATUS_REFRESH_LOCK:
        return _ACTIVE_STATUS_REFRESH_SESSION is not None


def _mark_status_refresh_started(session_id: str, total: int) -> None:
    """记录当前活跃的状态刷新任务，避免短时间内重复堆积多组 Git fetch。"""
    global _ACTIVE_STATUS_REFRESH_SESSION, _ACTIVE_STATUS_REFRESH_TOTAL
    with _STATUS_REFRESH_LOCK:
        _ACTIVE_STATUS_REFRESH_SESSION = session_id
        _ACTIVE_STATUS_REFRESH_TOTAL = total


def _mark_status_refresh_finished(session_id: str) -> None:
    """仅清理当前活跃任务自身的占位，防止旧任务误删新任务标记。"""
    global _ACTIVE_STATUS_REFRESH_SESSION, _ACTIVE_STATUS_REFRESH_TOTAL
    with _STATUS_REFRESH_LOCK:
        if _ACTIVE_STATUS_REFRESH_SESSION == session_id:
            _ACTIVE_STATUS_REFRESH_SESSION = None
            _ACTIVE_STATUS_REFRESH_TOTAL = 0


def _get_active_status_refresh() -> tuple[str | None, int]:
    """返回当前活跃刷新任务，用于重复点击时复用已有 session。"""
    with _STATUS_REFRESH_LOCK:
        return _ACTIVE_STATUS_REFRESH_SESSION, _ACTIVE_STATUS_REFRESH_TOTAL


# ── FastAPI App ──────────────────────────────────────
app = FastAPI(title="SyncDock 5.0 GUI")


# ═══════════════════════════════════════════════════
# Pydantic 模型
# ═══════════════════════════════════════════════════

class RepositoryItem(BaseModel):
    name: str
    path: str
    enabled: bool
    sync_policy: str  # "safe" | "force"


class SyncRequest(BaseModel):
    mode: str  # "all" | "needed" | "retry" | "selected" | "force_selected"
    names: list[str] | None = None


class StatusRefreshRequest(BaseModel):
    names: list[str] | None = None
    refresh_remote: bool = True


class SettingsItem(BaseModel):
    concurrent_limit: int = 3
    command_timeout_seconds: int = 120
    skip_uncommitted_changes: bool = True
    skip_untracked_files: bool = False
    log_retention_days: int = 30
    proxy_port: int = 28203


# ═══════════════════════════════════════════════════
# 静态文件服务
# ═══════════════════════════════════════════════════

@app.get("/")
async def serve_index():
    return FileResponse(_STATIC_DIR / "index.html")


# ═══════════════════════════════════════════════════
# 同步操作
# ═══════════════════════════════════════════════════

def _sync_worker_for_mode(mode: str, settings_obj: SettingsConfig):
    """根据 GUI 同步模式生成仓库同步 worker，便于所有模式复用有界并发执行。"""

    def worker(repo: RepositoryConfig) -> SyncResult:
        if mode == "force_selected":
            return force_sync_single_repository(repo, settings_obj, checker=_checker, git_runner=_git_runner)
        return sync_repository_by_policy(repo, settings_obj, checker=_checker, git_runner=_git_runner)

    return worker


def _inspection_to_result(repo: RepositoryConfig, inspection: dict) -> SyncResult:
    """把扫描阶段的非同步状态转换为进度事件，确保 needed 模式检查期也有可见反馈。"""
    outcome_map = {"invalid": "INVALID", "skipped": "SKIPPED", "failed": "FAILED"}
    if inspection["kind"] == "ready" and not inspection.get("needs_pull"):
        return SyncResult(repo.name, "UP_TO_DATE", inspection["message"])
    return SyncResult(repo.name, outcome_map.get(inspection["kind"], "SKIPPED"), inspection["message"])


def _collect_needed_repositories_in_background(
    repositories: list[RepositoryConfig],
    settings_obj: SettingsConfig,
    progress_callback,
    *,
    cancelled_checker=None,
) -> tuple[list[RepositoryConfig], list[SyncResult]]:
    """并发扫描需要同步的仓库，并把扫描结果立即推送给前端避免按钮长时间无反馈。"""
    target: list[RepositoryConfig] = []
    needs_sync_by_name: dict[str, bool] = {}
    cancelled_checker = cancelled_checker or (lambda: False)

    def worker(repo: RepositoryConfig) -> SyncResult:
        if cancelled_checker():
            return SyncResult(repo.name, "SKIPPED", "已取消")
        inspection = _checker.inspect(
            repo,
            settings_obj,
            refresh_remote=True,
            ignore_uncommitted_changes=repo.uses_force_sync,
            ignore_untracked_files=repo.uses_force_sync,
            ignore_divergence=repo.uses_force_sync,
        )
        needs_sync_by_name[repo.name] = inspection["kind"] == "ready" and bool(inspection.get("needs_pull"))
        row = _build_status_row_from_inspection(repo, inspection)
        row["fetched_at"] = _current_timestamp()
        _cache_status_row(row, source="remote")
        return _inspection_to_result(repo, inspection)

    scan_results = run_repositories_concurrently(
        repositories,
        settings_obj,
        worker,
        progress_callback=progress_callback,
        is_cancelled=cancelled_checker,
    )
    for repo in repositories:
        if needs_sync_by_name.get(repo.name):
            target.append(repo)
    return target, scan_results


def _run_sync_in_background(
    session_id: str,
    repositories: list,
    settings_obj,
    *,
    mode: str,
) -> None:
    """在后台线程执行同步，通过 SSE 推送进度，并实时回写状态缓存。

    若 session 被取消，跳过仍未开始的仓库分片并推送 cancelled 完成事件。
    needed 模式的进度事件会包含 phase=scanning/syncing 字段，方便前端区分阶段。
    """
    # 构造取消检查器，供 run_repositories_concurrently 在提交新分片时检查。
    cancelled_checker = lambda: sse_manager.is_cancelled(session_id)

    def _phase_wrapper(base_callback, phase: str):
        """给进度事件补充阶段字段，不改变原有事件结构。"""
        def wrapped(result: SyncResult) -> None:
            _cache_status_from_sync_result(result)
            base_callback(result, phase=phase)
        return wrapped

    try:
        if sse_manager.is_cancelled(session_id):
            _push_cancelled_complete(session_id)
            return

        total = len(repositories)
        raw_callback = sse_manager.make_callback(session_id, total)

        def callback_with_phase(result: SyncResult, phase: str | None = None) -> None:
            _cache_status_from_sync_result(result)
            raw_callback(result, phase=phase)

        if mode == "needed":
            # 扫描阶段：phase=scanning
            scan_callback = _phase_wrapper(callback_with_phase, "scanning")
            sync_targets, scan_results = _collect_needed_repositories_in_background(
                repositories,
                settings_obj,
                scan_callback,
                cancelled_checker=cancelled_checker,
            )
            if sse_manager.is_cancelled(session_id):
                _push_cancelled_complete(session_id)
                return
            # 同步阶段：phase=syncing
            if sync_targets:
                sync_callback = _phase_wrapper(callback_with_phase, "syncing")
                sync_results = run_repositories_concurrently(
                    sync_targets,
                    settings_obj,
                    _sync_worker_for_mode("selected", settings_obj),
                    progress_callback=sync_callback,
                    is_cancelled=cancelled_checker,
                )
            else:
                sync_results = []
            results = [item for item in scan_results if item.outcome != "UP_TO_DATE"] + sync_results
        elif mode == "all":
            results = sync_all_repositories(
                repositories,
                settings_obj,
                checker=_checker,
                git_runner=_git_runner,
                progress_callback=lambda r: callback_with_phase(r),
            )
        else:
            if sse_manager.is_cancelled(session_id):
                _push_cancelled_complete(session_id)
                return
            results = run_repositories_concurrently(
                repositories,
                settings_obj,
                _sync_worker_for_mode(mode, settings_obj),
                progress_callback=lambda r: callback_with_phase(r),
                is_cancelled=cancelled_checker,
            )

        if sse_manager.is_cancelled(session_id):
            _push_cancelled_complete(session_id)
            return

        summary = summarize_results(results)
        sse_manager.push_complete(session_id, summary)

        # 写日志
        lines = [render_result_line(item) for item in results]
        log_summary = render_summary(**summary)
        write_log_session(_LOG_DIR, lines + ["", log_summary])

    except Exception as exc:
        sse_manager.push_complete(
            session_id,
            {
                "total": 0,
                "updated": 0,
                "up_to_date": 0,
                "skipped": 0,
                "failed": 0,
                "invalid": 0,
                "error": str(exc),
            },
        )
    finally:
        # 同步结束后递减计数器，让状态刷新接口可以重新进行远端查询。
        _decrement_sync_count()


@app.post("/api/sync/start")
async def start_sync(payload: SyncRequest):
    """触发同步任务，返回 session_id。"""
    runtime = _get_runtime()
    enabled = [r for r in runtime.repositories if r.enabled]

    if not enabled:
        raise HTTPException(400, "没有已启用的仓库")

    if payload.mode in ("selected", "force_selected"):
        if not payload.names:
            raise HTTPException(400, "请选择要同步的仓库")
        indexed = {r.name: r for r in enabled}
        selected = []
        for name in payload.names:
            repo = indexed.get(name)
            if repo is None:
                raise HTTPException(400, f"仓库不存在或未启用：{name}")
            selected.append(repo)
        target = selected
    elif payload.mode == "retry":
        failed = list_latest_failed_repositories(_LOG_DIR)
        if not failed:
            raise HTTPException(400, "最近一次同步没有失败仓库")
        names_set = {name for name, _ in failed}
        target = [r for r in enabled if r.name in names_set]
    elif payload.mode in ("needed", "all"):
        target = enabled
    else:
        raise HTTPException(400, f"无效的同步模式：{payload.mode}")

    session_id = sse_manager.create_session()
    # 同步开始前递增计数器，让状态刷新接口感知到同步正在进行。
    _increment_sync_count()
    thread = threading.Thread(
        target=_run_sync_in_background,
        args=(session_id, target, runtime.settings),
        kwargs={"mode": payload.mode},
        daemon=True,
    )
    thread.start()
    return {"session_id": session_id, "total": len(target)}


@app.get("/api/sync/events/{session_id}")
async def stream_sync_events(session_id: str):
    """SSE 实时推送同步进度。"""
    sync_queue = sse_manager.get_queue(session_id)
    if sync_queue is None:
        raise HTTPException(404, "session 不存在或已过期")

    async def event_generator():
        loop = asyncio.get_event_loop()
        try:
            while True:
                event = await loop.run_in_executor(None, sync_queue.get)
                if event["event"] == "complete":
                    yield f"event: complete\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    sse_manager.cleanup(session_id)
                    break
                yield f"event: progress\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            sse_manager.cleanup(session_id)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════
# 仓库配置管理
# ═══════════════════════════════════════════════════

def _repo_to_dict(r: RepositoryConfig) -> dict:
    return {
        "name": r.name,
        "path": r.path,
        "enabled": r.enabled,
        "sync_policy": "force" if r.uses_force_sync else "safe",
    }


def _normalize_repository_payload(items: list[dict]) -> list[dict]:
    raw: list[dict] = []
    seen_names: set[str] = set()
    for item in items:
        name = str(item.get("name", "")).strip()
        path = str(item.get("path", "")).strip()
        policy = str(item.get("sync_policy", "safe")).strip().lower() or "safe"
        if not name:
            raise HTTPException(400, "仓库名称不能为空")
        if not path:
            raise HTTPException(400, "仓库路径不能为空")
        if name in seen_names:
            raise HTTPException(400, f"仓库名称不能重复：{name}")
        seen_names.add(name)
        raw.append(
            {
                "name": name,
                "path": path,
                "enabled": bool(item.get("enabled", True)),
                "sync_policy": "force" if policy == "force" else "safe",
            }
        )
    return raw


@app.get("/api/repositories")
async def get_repositories():
    """返回仓库列表。"""
    runtime = _get_runtime()
    return {"repositories": [_repo_to_dict(r) for r in runtime.repositories]}


@app.put("/api/repositories")
async def save_repositories(data: dict):
    """保存仓库配置到 repositories.json。"""
    items = data.get("repositories", [])
    raw = _normalize_repository_payload(items)
    try:
        _write_json(_CONFIG_DIR / "repositories.json", {"repositories": raw})
        _reload_runtime()
    except (OSError, ValueError) as exc:
        raise HTTPException(400, str(exc))
    return {"ok": True}


# ═══════════════════════════════════════════════════
# 仓库状态查询
# ═══════════════════════════════════════════════════

def _status_row_for_repository(repo: RepositoryConfig, settings: SettingsConfig, *, refresh_remote: bool) -> dict:
    """查询单个仓库状态；支持本地快查与远端刷新两种模式，供后台分片执行。"""
    if not repo.enabled:
        return {
            "name": repo.name,
            "status_code": "disabled",
            "status_label": "未启用",
            "detail": "",
            "fetched_at": _current_timestamp(),
        }
    try:
        inspection = _checker.inspect(repo, settings, refresh_remote=refresh_remote)
        row = _build_status_row_from_inspection(repo, inspection)
        row["fetched_at"] = _current_timestamp()
        return row
    except Exception as exc:
        return {
            "name": repo.name,
            "status_code": "error",
            "status_label": f"查询失败：{exc}",
            "detail": "",
            "fetched_at": _current_timestamp(),
        }


def _push_cancelled_complete(session_id: str) -> None:
    """推送 cancelled 完成事件，让前端知道任务已被取消而不是异常结束。"""
    sse_manager.push_complete(
        session_id,
        {
            "total": 0,
            "cancelled": True,
            "error": None,
        },
    )


def _run_status_refresh_in_background(
    session_id: str,
    repositories: list[RepositoryConfig],
    settings_obj: SettingsConfig,
    *,
    refresh_remote: bool,
) -> None:
    """后台刷新状态并逐仓库推送事件，避免页面等待全部 Git 命令完成。"""
    # 如果已取消，尽快退出不执行任何 Git 命令。
    if sse_manager.is_cancelled(session_id):
        _mark_status_refresh_finished(session_id)
        _push_cancelled_complete(session_id)
        return

    progress_lock = threading.Lock()
    rows_lock = threading.Lock()
    progress = 0
    rows_by_name: dict[str, dict] = {}
    queue_obj = sse_manager.get_queue(session_id)
    source = "remote" if refresh_remote else "local"

    if queue_obj is None:
        _mark_status_refresh_finished(session_id)
        return

    try:
        total = len(repositories)

        def worker(repo: RepositoryConfig) -> SyncResult:
            row = _status_row_for_repository(repo, settings_obj, refresh_remote=refresh_remote)
            _cache_status_row(row, source=source)
            with rows_lock:
                rows_by_name[repo.name] = row
            return SyncResult(repo.name, "UP_TO_DATE", row["status_label"])

        def callback(result: SyncResult) -> None:
            nonlocal progress
            with rows_lock:
                row = dict(rows_by_name.get(result.name, {"name": result.name, "status_code": "unknown", "status_label": result.message, "detail": ""}))
            with progress_lock:
                progress += 1
                current = progress
            queue_obj.put(
                {
                    "event": "progress",
                    "name": row["name"],
                    "status_code": row["status_code"],
                    "status_label": row["status_label"],
                    "detail": row.get("detail", ""),
                    "progress": current,
                    "total": total,
                    "cached": False,
                    "stale": False,
                    "fetched_at": row.get("fetched_at"),
                    "source": source,
                }
            )

        run_repositories_concurrently(
            repositories,
            settings_obj,
            worker,
            progress_callback=callback,
            is_cancelled=lambda: sse_manager.is_cancelled(session_id),
        )

        failed_count = 0
        need_sync_count = 0
        with rows_lock:
            final_rows = list(rows_by_name.values())
        for row in final_rows:
            if row["status_code"] in {
                "error",
                "invalid_path",
                "not_git_repository",
                "remote_refresh_failed",
                "local_status_failed",
                "branch_compare_failed",
            }:
                failed_count += 1
            if row["status_code"] in {"needs_sync", "needs_force_sync"}:
                need_sync_count += 1

        sse_manager.push_complete(
            session_id,
            {
                "total": len(final_rows),
                "refreshed": len(final_rows),
                "failed": failed_count,
                "needs_sync": need_sync_count,
                "source": source,
            },
        )
    except Exception as exc:
        sse_manager.push_complete(
            session_id,
            {
                "total": 0,
                "refreshed": 0,
                "failed": 1,
                "needs_sync": 0,
                "source": source,
                "error": str(exc),
            },
        )
    finally:
        _mark_status_refresh_finished(session_id)


@app.get("/api/status")
async def get_status():
    """兼容旧接口：直接返回状态快照，由前端按需触发后台刷新。"""
    runtime = _get_runtime()
    return {"rows": _snapshot_rows_for_repositories(runtime.repositories), "ttl_seconds": _status_cache.ttl_seconds}


@app.get("/api/status/snapshot")
async def get_status_snapshot():
    """快速返回当前缓存快照，不触发远端 fetch，保证首屏可立即渲染。"""
    runtime = _get_runtime()
    return {"rows": _snapshot_rows_for_repositories(runtime.repositories), "ttl_seconds": _status_cache.ttl_seconds}


@app.post("/api/status/refresh")
async def start_status_refresh(payload: StatusRefreshRequest):
    """启动后台状态刷新；若已有同类任务运行，则直接复用已有 session 做轻量背压。

    当同步任务正在运行时，状态刷新自动降级为缓存读取 + 占位状态（不执行远端 fetch），
    避免同步与状态刷新争抢 Git 子进程资源。降级时响应中 ``degraded=True``。
    """
    runtime = _get_runtime()
    indexed = {repo.name: repo for repo in runtime.repositories}
    if payload.names:
        target = []
        for name in payload.names:
            repo = indexed.get(name)
            if repo is None:
                raise HTTPException(400, f"仓库不存在：{name}")
            target.append(repo)
    else:
        target = list(runtime.repositories)

    if not target:
        raise HTTPException(400, "没有可刷新的仓库")

    # 同步正在进行时，状态刷新降级为仅返回当前缓存快照（不触发远端 fetch）。
    sync_running = _is_sync_running()
    refresh_remote = payload.refresh_remote and not sync_running

    existing_session, existing_total = _get_active_status_refresh()
    if existing_session is not None:
        return {"session_id": existing_session, "total": existing_total, "reused": True, "degraded": sync_running}

    session_id = sse_manager.create_session()
    _mark_status_refresh_started(session_id, len(target))
    thread = threading.Thread(
        target=_run_status_refresh_in_background,
        args=(session_id, target, runtime.settings),
        kwargs={"refresh_remote": refresh_remote},
        daemon=True,
    )
    thread.start()
    return {"session_id": session_id, "total": len(target), "reused": False, "degraded": sync_running}


@app.post("/api/status/refresh/cancel")
async def cancel_status_refresh():
    """取消当前运行的状态刷新任务，未开始的仓库分片将被跳过。"""
    session, total = _get_active_status_refresh()
    if session is None:
        return {"ok": True, "message": "当前没有活跃的状态刷新任务"}

    sse_manager.cancel_session(session)
    # 尽快清理全局标记，让新的刷新请求可以立即创建新 session
    _mark_status_refresh_finished(session)
    return {"ok": True, "session_id": session, "total": total}


@app.post("/api/sync/cancel/{session_id}")
async def cancel_sync_session(session_id: str):
    """取消指定的同步任务，未开始的分片将被跳过。"""
    sse_manager.cancel_session(session_id)
    return {"ok": True, "session_id": session_id}


@app.get("/api/status/events/{session_id}")
async def stream_status_events(session_id: str):
    """SSE 推送状态刷新进度，让前端逐仓库更新而不阻塞主线程。"""
    status_queue = sse_manager.get_queue(session_id)
    if status_queue is None:
        raise HTTPException(404, "session 不存在或已过期")

    async def event_generator():
        loop = asyncio.get_event_loop()
        try:
            while True:
                event = await loop.run_in_executor(None, status_queue.get)
                if event["event"] == "complete":
                    yield f"event: complete\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                    sse_manager.cleanup(session_id)
                    break
                yield f"event: progress\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
        except GeneratorExit:
            sse_manager.cleanup(session_id)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ═══════════════════════════════════════════════════
# 设置管理
# ═══════════════════════════════════════════════════

@app.get("/api/settings")
async def get_settings():
    """返回全局设置。"""
    s = _get_runtime().settings
    return {
        "concurrent_limit": s.concurrent_limit,
        "command_timeout_seconds": s.command_timeout_seconds,
        "skip_uncommitted_changes": s.skip_uncommitted_changes,
        "skip_untracked_files": s.skip_untracked_files,
        "log_retention_days": s.log_retention_days,
        "proxy_port": s.proxy_port,
    }


@app.put("/api/settings")
async def save_settings(payload: SettingsItem):
    """保存全局设置到 settings.json。"""
    raw = payload.model_dump()
    _write_json(_CONFIG_DIR / "settings.json", raw)
    _reload_runtime()
    return {"ok": True}


# ═══════════════════════════════════════════════════
# 日志
# ═══════════════════════════════════════════════════

@app.get("/api/logs/failed")
async def get_failed_logs():
    """返回最近一次同步的失败记录。"""
    if not _LOG_DIR.exists():
        return {"entries": []}
    failed = list_latest_failed_repositories(_LOG_DIR)
    entries = []
    for name, reason in failed:
        entries.append(
            {
                "name": name,
                "reason": reason,
                "suggestion": _get_suggestion(reason),
            }
        )
    return {"entries": entries}


def _get_suggestion(message: str) -> str:
    from syncdock.advice_service import get_sync_suggestion

    return get_sync_suggestion(message) or ""


@app.get("/api/logs/recent")
async def get_recent_logs(limit: Annotated[int, Query(ge=1, le=50)] = 5):
    """返回最近 N 次日志的失败摘要。"""
    if not _LOG_DIR.exists():
        return {"logs": []}
    raw = read_recent_logs(_LOG_DIR, limit)
    if raw == "暂无日志":
        return {"logs": []}
    return {"raw": raw}


# ═══════════════════════════════════════════════════
# 配置重新加载
# ═══════════════════════════════════════════════════

@app.post("/api/config/reload")
async def reload_config():
    """重新加载配置文件。"""
    try:
        _reload_runtime()
        return {"ok": True}
    except (OSError, ValueError) as exc:
        raise HTTPException(400, str(exc))


# ═══════════════════════════════════════════════════
# 关闭服务
# ═══════════════════════════════════════════════════

@app.post("/api/shutdown")
async def shutdown():
    """关闭 uvicorn 服务器，启动器自动退出，无残留进程。"""
    import os

    # 给一点时间让响应返回客户端
    threading.Thread(
        target=lambda: (
            time.sleep(0.5),
            os._exit(0),
        ),
        daemon=True,
    ).start()
    return {"ok": True}
