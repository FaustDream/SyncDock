from __future__ import annotations

from pathlib import Path


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


def append_log_line(log_file: Path, line: str) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as handle:
        handle.write(f"{line}\n")
