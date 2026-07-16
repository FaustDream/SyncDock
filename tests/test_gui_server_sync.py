"""测试 GUI 同步后台任务的汇总、取消和互斥语义。"""

from syncdock.config_service import RepositoryConfig, SettingsConfig
from syncdock.gui import server
from syncdock.gui.sse_manager import SSEManager


def _settings() -> SettingsConfig:
    """构造 GUI 后台任务使用的最小设置。"""
    return SettingsConfig(
        concurrent_limit=1,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
        proxy_ports=[28203],
    )


def _repo() -> RepositoryConfig:
    """构造一个启用的安全同步仓库配置。"""
    return RepositoryConfig(name="alpha", path="E:/tmp/alpha", enabled=True, author_type=True)


class AlwaysNeedsSyncChecker:
    """模拟仓库始终落后远端，用于稳定覆盖 needed 扫描和同步阶段。"""

    def inspect(self, repository, settings, **kwargs):
        return {
            "kind": "ready",
            "message": "需要同步",
            "needs_pull": True,
            "status_code": "needs_sync",
            "branch_name": "main",
            "upstream_name": "origin/main",
            "ahead_count": 0,
            "behind_count": 1,
        }


class SuccessfulGitRunner:
    """模拟 Git fetch/pull 均成功，避免测试依赖真实仓库。"""

    def run(self, cwd, args, timeout_seconds, proxy_ports=None):
        return True, "ok"


def _collect_events(manager: SSEManager, session_id: str) -> list[dict]:
    """读取指定 session 的全部事件，直到 complete。"""
    queue_obj = manager.get_queue(session_id)
    events: list[dict] = []
    while True:
        event = queue_obj.get(timeout=1)
        events.append(event)
        if event["event"] == "complete":
            return events


def test_needed_mode_scan_result_does_not_enter_final_summary(monkeypatch):
    """needed 扫描阶段的“需要同步”只做进度事件，最终汇总只统计真实同步结果。"""
    manager = SSEManager()
    monkeypatch.setattr(server, "sse_manager", manager)
    monkeypatch.setattr(server, "_checker", AlwaysNeedsSyncChecker())
    monkeypatch.setattr(server, "_git_runner", SuccessfulGitRunner())
    monkeypatch.setattr(server, "write_log_session", lambda *args, **kwargs: None)

    session_id = manager.create_session()
    server._run_sync_in_background(session_id, [_repo()], _settings(), mode="needed")

    events = _collect_events(manager, session_id)
    progress_events = [event for event in events if event["event"] == "progress"]
    complete = events[-1]

    assert progress_events[0]["phase"] == "scanning"
    assert progress_events[0]["outcome"] == "NEEDS_SYNC"
    assert progress_events[-1]["phase"] == "syncing"
    assert progress_events[-1]["outcome"] == "UPDATED"
    assert complete["summary"]["total"] == 1
    assert complete["summary"]["updated"] == 1
    assert complete["summary"]["skipped"] == 0


def test_sync_start_marker_allows_only_one_active_sync(monkeypatch):
    """服务端同步互斥必须在全局层面生效，不能只依赖单页面按钮状态。"""
    monkeypatch.setattr(server, "_SYNC_ACTIVE_COUNT", 0)

    assert server._try_mark_sync_started() is True
    assert server._try_mark_sync_started() is False

    server._decrement_sync_count()
    assert server._is_sync_running() is False
