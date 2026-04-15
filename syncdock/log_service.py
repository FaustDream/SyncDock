from __future__ import annotations

from datetime import datetime
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


def write_log_session(log_dir: Path, lines: list[str]) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"sync-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
    for line in lines:
        append_log_line(log_file, line)
    return log_file


def read_latest_log(log_dir: Path) -> str:
    if not log_dir.exists():
        return "暂无日志"

    log_files = sorted(log_dir.glob("*.log"))
    if not log_files:
        return "暂无日志"

    return log_files[-1].read_text(encoding="utf-8")
