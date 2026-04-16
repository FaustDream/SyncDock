from __future__ import annotations

from syncdock.log_service import read_latest_failed_log


def test_read_latest_failed_log_returns_failed_repositories(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260416-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库A: 已经是最新",
                "仓库B: 同步失败，网络连接异常",
                "仓库C: 同步失败，没有权限访问仓库",
                "",
                "同步完成",
            ]
        ),
        encoding="utf-8",
    )

    result = read_latest_failed_log(log_dir)

    assert "最近日志：sync-20260416-100000-000001.log" in result
    assert "仓库B: 同步失败，网络连接异常" in result
    assert "仓库C: 同步失败，没有权限访问仓库" in result
    assert "仓库A: 已经是最新" not in result


def test_read_latest_failed_log_reports_no_failed_repositories(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260416-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库A: 已经是最新",
                "仓库B: 已跳过，有未提交修改",
                "",
                "同步完成",
            ]
        ),
        encoding="utf-8",
    )

    result = read_latest_failed_log(log_dir)

    assert "最近日志：sync-20260416-100000-000001.log" in result
    assert "最近一次同步没有失败仓库" in result

