from __future__ import annotations

from syncdock.log_service import list_latest_failed_repositories, read_latest_log, read_recent_logs


def test_read_latest_log_returns_failed_reasons_only(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260416-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库A: 已经是最新",
                "仓库B: 同步失败，网络连接异常",
                "仓库C: 同步失败，Git 命令执行失败: fatal: unable to access 'https://example.com/repo.git/'",
                "",
                "同步完成",
            ]
        ),
        encoding="utf-8",
    )

    result = read_latest_log(log_dir)

    assert "最近日志：sync-20260416-100000-000001.log" in result
    assert "仓库B: 网络连接异常；建议：" in result
    assert "仓库C: Git 命令执行失败；建议：" in result
    assert "仓库A: 已经是最新" not in result
    assert "同步失败" not in result
    assert "fatal: unable to access" not in result


def test_read_latest_log_reports_no_failed_repositories(tmp_path) -> None:
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

    result = read_latest_log(log_dir)

    assert "最近日志：sync-20260416-100000-000001.log" in result
    assert "最近一次同步没有失败仓库" in result


def test_list_latest_failed_repositories_returns_repository_names_and_reasons(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260416-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库A: 已经是最新",
                "仓库B: 同步失败，网络连接异常",
                "仓库C: 同步失败，没有权限访问仓库",
            ]
        ),
        encoding="utf-8",
    )

    result = list_latest_failed_repositories(log_dir)

    assert result == [("仓库B", "网络连接异常"), ("仓库C", "没有权限访问仓库")]


def test_read_recent_logs_returns_latest_n_failed_summaries(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260415-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库A: 已经是最新",
                "仓库B: 同步失败，网络连接异常",
            ]
        ),
        encoding="utf-8",
    )
    (log_dir / "sync-20260416-100000-000001.log").write_text(
        "\n".join(
            [
                "仓库C: 已经是最新",
            ]
        ),
        encoding="utf-8",
    )

    result = read_recent_logs(log_dir, 2)

    assert "最近 2 次日志" in result
    assert "sync-20260416-100000-000001.log" in result
    assert "sync-20260415-100000-000001.log" in result
    assert "最近一次同步没有失败仓库" in result
    assert "仓库B: 网络连接异常；建议：" in result
