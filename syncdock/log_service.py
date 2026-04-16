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


def _get_latest_log_file(log_dir: Path) -> Path | None:
    if not log_dir.exists():
        return None

    log_files = sorted(log_dir.glob("*.log"))
    if not log_files:
        return None
    return log_files[-1]


def extract_failed_log_lines(content: str) -> list[str]:
    failed_lines: list[str] = []
    for line in content.splitlines():
        if ": " not in line:
            continue
        _, message = line.split(": ", 1)
        if message.startswith("同步失败"):
            failed_lines.append(line)
    return failed_lines


def read_latest_log(log_dir: Path) -> str:
    latest_log = _get_latest_log_file(log_dir)
    if latest_log is None:
        return "暂无日志"
    content = latest_log.read_text(encoding="utf-8").strip()
    if not content:
        return f"最近日志：{latest_log.name}"
    return f"最近日志：{latest_log.name}\n\n{content}"


def read_latest_failed_log(log_dir: Path) -> str:
    latest_log = _get_latest_log_file(log_dir)
    if latest_log is None:
        return "暂无日志"

    content = latest_log.read_text(encoding="utf-8").strip()
    failed_lines = extract_failed_log_lines(content)
    if not failed_lines:
        return f"最近日志：{latest_log.name}\n\n最近一次同步没有失败仓库"
    return f"最近日志：{latest_log.name}\n\n" + "\n".join(failed_lines)
