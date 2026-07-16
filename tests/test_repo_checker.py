"""测试 RepositoryChecker 的失败语义。"""

from subprocess import CompletedProcess

from syncdock.config_service import RepositoryConfig
from syncdock.repo_checker import RepositoryChecker


def _ok(args: list[str], stdout: str) -> CompletedProcess:
    """构造成功的 Git 命令结果，便于测试只关注业务分支。"""
    return CompletedProcess(args=args, returncode=0, stdout=stdout, stderr="")


class ScriptedChecker(RepositoryChecker):
    """按命令名称返回预设结果，用于稳定复现 Git 子命令失败。"""

    def __init__(self, failures: set[str]) -> None:
        self.failures = failures

    def _run_git(self, cwd, *args, timeout_seconds=None, proxy_ports=None):
        command = " ".join(args)
        if command in self.failures:
            return None
        if command == "rev-parse --is-inside-work-tree":
            return _ok(list(args), "true\n")
        if command == "branch --show-current":
            return _ok(list(args), "main\n")
        if command == "status --porcelain":
            return _ok(list(args), "")
        if command == "rev-parse --abbrev-ref --symbolic-full-name @{upstream}":
            return _ok(list(args), "origin/main\n")
        if command == "rev-list --left-right --count HEAD...@{upstream}":
            return _ok(list(args), "0 0\n")
        raise AssertionError(f"未预期的 Git 命令：{command}")


def test_status_command_failure_is_failed(tmp_path, settings):
    """本地 status 失败时应返回 failed，不能按空工作区继续判断。"""
    checker = ScriptedChecker(failures={"status --porcelain"})
    repo = RepositoryConfig(name="alpha", path=str(tmp_path), enabled=True)

    inspection = checker.inspect(repo, settings)

    assert inspection["kind"] == "failed"
    assert inspection["status_code"] == "local_status_failed"
    assert inspection["needs_pull"] is False


def test_rev_list_failure_is_failed(tmp_path, settings):
    """领先/落后计数失败时应返回 failed，不能把 ahead/behind 默认为 0。"""
    checker = ScriptedChecker(failures={"rev-list --left-right --count HEAD...@{upstream}"})
    repo = RepositoryConfig(name="alpha", path=str(tmp_path), enabled=True)

    inspection = checker.inspect(repo, settings)

    assert inspection["kind"] == "failed"
    assert inspection["status_code"] == "branch_compare_failed"
    assert inspection["needs_pull"] is False
