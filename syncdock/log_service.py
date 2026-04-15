from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from syncdock.sync_engine import SyncResult


def render_summary(*, total: int, updated: int, up_to_date: int, skipped: int, failed: int, invalid: int) -> str:
    return "\n".join(
        [
            "同步完成",
            "",
            f"总仓库数：{total}",
            f"已同步：{updated}",
            f"无需同步：{up_to_date}",
            f"已跳过：{skipped}",
            f"失败：{failed}",
            f"无效：{invalid}",
        ]
    )


def render_result_line(result: SyncResult) -> str:
    return f"{result.name}: {result.message}"


def append_log_line(log_file: Path, line: str) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(f"{line}\n")


def cleanup_old_logs(log_dir: Path, retention_days: int, *, now: datetime | None = None) -> None:
    if not log_dir.exists():
        return

    now = now or datetime.now()
    cutoff = now - timedelta(days=retention_days)
    for log_file in log_dir.glob("*.log"):
        modified_at = datetime.fromtimestamp(log_file.stat().st_mtime)
        if modified_at < cutoff:
            log_file.unlink(missing_ok=True)


def write_log_session(
    log_dir: Path,
    lines: list[str],
    *,
    retention_days: int = 30,
    now: datetime | None = None,
) -> Path:
    now = now or datetime.now()
    log_dir.mkdir(parents=True, exist_ok=True)
    cleanup_old_logs(log_dir, retention_days, now=now)
    log_file = log_dir / f"sync-{now.strftime('%Y%m%d-%H%M%S-%f')}.log"
    for line in lines:
        append_log_line(log_file, line)
    return log_file


def read_latest_log(log_dir: Path) -> str:
    if not log_dir.exists():
        return "暂无日志"

    log_files = sorted(log_dir.glob("*.log"))
    if not log_files:
        return "暂无日志"

    latest_log = log_files[-1]
    content = latest_log.read_text(encoding="utf-8").strip()
    if not content:
        return f"最近日志：{latest_log.name}"
    return f"最近日志：{latest_log.name}\n\n{content}"
