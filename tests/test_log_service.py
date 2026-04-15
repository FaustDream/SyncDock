from datetime import datetime, timedelta
from pathlib import Path
import os

from syncdock.log_service import read_latest_log, render_summary, write_log_session


def test_render_summary_returns_simple_chinese_totals():
    text = render_summary(total=5, updated=2, up_to_date=1, skipped=1, failed=1, invalid=0)

    assert "同步完成" in text
    assert "总仓库数：5" in text
    assert "已同步：2" in text
    assert "失败：1" in text


def test_write_log_session_removes_expired_logs(tmp_path: Path):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    old_log = log_dir / "sync-old.log"
    old_log.write_text("old\n", encoding="utf-8")
    old_time = datetime(2026, 4, 1, 12, 0, 0)
    os.utime(old_log, (old_time.timestamp(), old_time.timestamp()))

    now = datetime(2026, 4, 15, 12, 0, 0)
    created = write_log_session(log_dir, ["line-1"], retention_days=7, now=now)

    assert created.exists()
    assert not old_log.exists()


def test_read_latest_log_returns_no_logs_message(tmp_path: Path):
    text = read_latest_log(tmp_path / "logs")

    assert text == "暂无日志"


def test_read_latest_log_includes_filename_and_content(tmp_path: Path):
    log_dir = tmp_path / "logs"
    created = write_log_session(
        log_dir,
        ["第一行", "第二行"],
        retention_days=7,
        now=datetime(2026, 4, 15, 12, 0, 0),
    )

    text = read_latest_log(log_dir)

    assert created.name in text
    assert "第一行" in text
    assert "第二行" in text
