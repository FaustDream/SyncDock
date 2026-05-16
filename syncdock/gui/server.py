"""SyncDock GUI — FastAPI 服务端。

提供 REST API + SSE 实时推送 + 静态前端服务。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import threading
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from syncdock.config_service import (
    RepositoryConfig,
    RuntimeConfig,
    SettingsConfig,
    _read_json,
    _write_json,
    load_runtime_config,
)
from syncdock.log_service import (
    list_latest_failed_repositories,
    read_latest_log,
    read_recent_logs,
    render_result_line,
    render_summary,
    write_log_session,
)
from syncdock.repo_checker import RepositoryChecker, format_status_detail
from syncdock.sync_engine import (
    GitCommandRunner,
    SyncResult,
    force_sync_single_repository,
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


def _get_runtime() -> RuntimeConfig:
    global _current_runtime
    if _current_runtime is None:
        _current_runtime = load_runtime_config(_CONFIG_DIR)
    return _current_runtime


def _reload_runtime() -> RuntimeConfig:
    global _current_runtime
    _current_runtime = load_runtime_config(_CONFIG_DIR)
    return _current_runtime


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


class SettingsItem(BaseModel):
    concurrent_limit: int = 3
    command_timeout_seconds: int = 120
    skip_uncommitted_changes: bool = True
    skip_untracked_files: bool = False
    log_retention_days: int = 30


# ═══════════════════════════════════════════════════
# 静态文件服务
# ═══════════════════════════════════════════════════

@app.get("/")
async def serve_index():
    return FileResponse(_STATIC_DIR / "index.html")


# ═══════════════════════════════════════════════════
# 同步操作
# ═══════════════════════════════════════════════════

def _run_sync_in_background(
    session_id: str,
    repositories: list,
    settings_obj,
    *,
    mode: str,
) -> None:
    """在后台线程执行同步，通过 SSE 推送进度。"""
    try:
        total = len(repositories)
        callback = sse_manager.make_callback(session_id, total)

        if mode == "all":
            results = sync_all_repositories(
                repositories, settings_obj,
                checker=_checker, git_runner=_git_runner,
                progress_callback=callback,
            )
        else:
            results = []
            for repo in repositories:
                if mode == "force_selected":
                    result = force_sync_single_repository(
                        repo, settings_obj,
                        checker=_checker, git_runner=_git_runner,
                    )
                else:
                    result = sync_repository_by_policy(
                        repo, settings_obj,
                        checker=_checker, git_runner=_git_runner,
                    )
                results.append(result)
                callback(result)

        summary = summarize_results(results)
        sse_manager.push_complete(session_id, summary)

        # 写日志
        lines = [render_result_line(item) for item in results]
        log_summary = render_summary(**summary)
        write_log_session(_LOG_DIR, lines + ["", log_summary])

    except Exception as exc:
        sse_manager.push_complete(session_id, {
            "total": 0, "updated": 0, "up_to_date": 0,
            "skipped": 0, "failed": 0, "invalid": 0,
            "error": str(exc),
        })


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
    elif payload.mode == "needed":
        target = []
        for repo in enabled:
            ins = _checker.inspect(repo, runtime.settings, refresh_remote=True)
            if ins.get("needs_pull"):
                target.append(repo)
        if not target:
            raise HTTPException(400, "没有需要同步的仓库")
    elif payload.mode == "all":
        target = enabled
    else:
        raise HTTPException(400, f"无效的同步模式：{payload.mode}")

    session_id = sse_manager.create_session()
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

@app.get("/api/status")
async def get_status():
    """查询所有已启用仓库的状态。"""
    runtime = _get_runtime()
    rows: list[dict] = []
    for repo in runtime.repositories:
        if not repo.enabled:
            rows.append({
                "name": repo.name,
                "status_code": "disabled",
                "status_label": "未启用",
                "detail": "",
            })
            continue
        try:
            inspection = _checker.inspect(repo, runtime.settings, refresh_remote=True)
            status_code = inspection.get("status_code", "unknown")
            rows.append({
                "name": repo.name,
                "status_code": status_code,
                "status_label": inspection["message"],
                "detail": format_status_detail(repo, inspection),
            })
        except Exception as exc:
            rows.append({
                "name": repo.name,
                "status_code": "error",
                "status_label": f"查询失败：{exc}",
                "detail": "",
            })
    return {"rows": sorted(rows, key=lambda x: x["name"].casefold())}


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
    # 只取失败仓库信息
    content = read_latest_log(_LOG_DIR)
    # parse lines from content
    entries = []
    for name, reason in failed:
        entries.append({
            "name": name,
            "reason": reason,
            "suggestion": _get_suggestion(reason),
        })
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
    threading.Thread(target=lambda: (
        time.sleep(0.5),
        os._exit(0),
    ), daemon=True).start()
    return {"ok": True}
