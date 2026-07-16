from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
import logging
import subprocess

from syncdock.config_service import RepositoryConfig, SettingsConfig

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class SyncResult:
    name: str
    outcome: str
    message: str
    status_code: str | None = None


SyncWorker = Callable[[RepositoryConfig], SyncResult]
HARD_MAX_GIT_PROCESSES = 6


class GitCommandRunner:
    def run(self, cwd: str, args: list[str], timeout_seconds: int, proxy_ports: list[int] | None = None) -> tuple[bool, str]:
        """执行 Git 命令，支持多代理端口自动切换。

        当 ``proxy_ports`` 提供时，按顺序尝试每个端口；若某个端口执行失败
        （连接/网络相关错误），则自动切换到下一个端口重试。全部失败时返回错误。
        """
        if not proxy_ports:
            return self._execute(cwd, self._build_command(args, None), timeout_seconds)

        last_result: tuple[bool, str] | None = None
        for i, port in enumerate(proxy_ports):
            if i > 0:
                logger.info("代理端口 %d 失败，尝试下一个端口 %d", proxy_ports[i - 1], port)
            ok, message = self._execute(cwd, self._build_command(args, port), timeout_seconds)
            if ok:
                if i > 0:
                    logger.info("代理端口 %d 连接成功", port)
                return ok, message
            # 只有网络/连接类错误才尝试下一个端口，其他错误直接返回
            msg_lower = message.lower()
            if not self._is_connection_error(msg_lower):
                return ok, message
            last_result = (ok, message)

        return last_result or (False, "所有代理端口均连接失败")

    @staticmethod
    def _is_connection_error(message: str) -> bool:
        """判断是否为网络连接类错误（此类错误值得尝试下一个端口）。"""
        connection_keywords = [
            "failed to connect",
            "could not resolve host",
            "connection refused",
            "connection timed out",
            "network is unreachable",
            "no route to host",
            "proxy connect",
            "tunnel connection failed",
            "could not resolve proxy",
        ]
        return any(kw in message for kw in connection_keywords)

    def _execute(self, cwd: str, command: list[str], timeout_seconds: int) -> tuple[bool, str]:
        try:
            completed = subprocess.run(
                command,
                cwd=cwd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            return False, "同步失败，Git 执行超时"
        except subprocess.CalledProcessError as error:
            stderr = (error.stderr or "").lower()
            if "could not read from remote repository" in stderr or "permission denied" in stderr:
                return False, "同步失败，没有权限访问仓库"
            if "could not resolve host" in stderr or "failed to connect" in stderr:
                return False, "同步失败，网络连接异常"
            if "not possible to fast-forward" in stderr or "divergent branches" in stderr:
                return False, "同步失败，需要手动处理分支差异"
            return False, "同步失败，Git 命令执行失败"

        output = completed.stdout.strip() or completed.stderr.strip()
        return True, output

    @staticmethod
    def _build_command(args: list[str], proxy_port: int | None) -> list[str]:
        if proxy_port is None:
            return ["git", *args]

        proxy_url = f"http://127.0.0.1:{max(1, int(proxy_port))}"
        return [
            "git",
            "-c", f"http.proxy={proxy_url}",
            "-c", f"https.proxy={proxy_url}",
            *args,
        ]


def summarize_results(results: list[SyncResult]) -> dict[str, int]:
    summary = {
        "total": len(results),
        "updated": 0,
        "up_to_date": 0,
        "skipped": 0,
        "failed": 0,
        "invalid": 0,
    }
    mapping = {
        "UPDATED": "updated",
        "UP_TO_DATE": "up_to_date",
        "SKIPPED": "skipped",
        "FAILED": "failed",
        "INVALID": "invalid",
    }
    for item in results:
        summary[mapping[item.outcome]] += 1
    return summary


def _result_from_inspection(repository: RepositoryConfig, outcome: str, inspection: dict) -> SyncResult:
    """把仓库检查结果转换为同步结果，同时保留精确状态码供 GUI 缓存复用。"""
    return SyncResult(repository.name, outcome, inspection["message"], inspection.get("status_code"))


def sync_single_repository(repository: RepositoryConfig, settings: SettingsConfig, *, checker, git_runner) -> SyncResult:
    inspection = checker.inspect(repository, settings)

    if inspection["kind"] == "invalid":
        return _result_from_inspection(repository, "INVALID", inspection)
    if inspection["kind"] == "skipped":
        return _result_from_inspection(repository, "SKIPPED", inspection)
    if inspection["kind"] == "failed":
        return _result_from_inspection(repository, "FAILED", inspection)

    fetch_ok, fetch_message = git_runner.run(
        repository.path,
        ["fetch", "--all", "--prune"],
        settings.command_timeout_seconds,
        settings.proxy_ports,
    )
    if not fetch_ok:
        return SyncResult(repository.name, "FAILED", fetch_message)

    inspection = checker.inspect(repository, settings)
    if inspection["kind"] == "invalid":
        return _result_from_inspection(repository, "INVALID", inspection)
    if inspection["kind"] == "skipped":
        return _result_from_inspection(repository, "SKIPPED", inspection)
    if inspection["kind"] == "failed":
        return _result_from_inspection(repository, "FAILED", inspection)
    if inspection.get("status_code") == "ahead_only":
        return _result_from_inspection(repository, "SKIPPED", inspection)
    if not inspection["needs_pull"]:
        return SyncResult(repository.name, "UP_TO_DATE", "已经是最新")

    pull_ok, pull_message = git_runner.run(
        repository.path,
        ["pull", "--ff-only"],
        settings.command_timeout_seconds,
        settings.proxy_ports,
    )
    if not pull_ok:
        return SyncResult(repository.name, "FAILED", pull_message)

    return SyncResult(repository.name, "UPDATED", "已拉取远端最新代码")


def force_sync_single_repository(repository: RepositoryConfig, settings: SettingsConfig, *, checker, git_runner) -> SyncResult:
    inspection = checker.inspect(
        repository,
        settings,
        ignore_uncommitted_changes=True,
        ignore_untracked_files=True,
        ignore_divergence=True,
    )

    if inspection["kind"] == "invalid":
        return _result_from_inspection(repository, "INVALID", inspection)
    if inspection["kind"] == "skipped":
        return _result_from_inspection(repository, "SKIPPED", inspection)
    if inspection["kind"] == "failed":
        return _result_from_inspection(repository, "FAILED", inspection)

    fetch_ok, fetch_message = git_runner.run(
        repository.path,
        ["fetch", "--all", "--prune"],
        settings.command_timeout_seconds,
        settings.proxy_ports,
    )
    if not fetch_ok:
        return SyncResult(repository.name, "FAILED", fetch_message)

    reset_ok, reset_message = git_runner.run(
        repository.path,
        ["reset", "--hard", "@{upstream}"],
        settings.command_timeout_seconds,
        settings.proxy_ports,
    )
    if not reset_ok:
        return SyncResult(repository.name, "FAILED", reset_message)

    clean_ok, clean_message = git_runner.run(
        repository.path,
        ["clean", "-fd"],
        settings.command_timeout_seconds,
        settings.proxy_ports,
    )
    if not clean_ok:
        return SyncResult(repository.name, "FAILED", clean_message)

    return SyncResult(repository.name, "UPDATED", "已强制同步到远端最新状态")


def sync_repository_by_policy(repository: RepositoryConfig, settings: SettingsConfig, *, checker, git_runner) -> SyncResult:
    if repository.uses_force_sync:
        return force_sync_single_repository(repository, settings, checker=checker, git_runner=git_runner)
    return sync_single_repository(repository, settings, checker=checker, git_runner=git_runner)


def run_repositories_concurrently(
    repositories: list[RepositoryConfig],
    settings: SettingsConfig,
    worker: SyncWorker,
    *,
    progress_callback=None,
    is_cancelled: Callable[[], bool] | None = None,
) -> list[SyncResult]:
    """按配置的仓库并发上限执行任务，并保持返回结果与输入仓库顺序一致。

    每个仓库作为独立分片运行，单个分片完成后立即触发回调，避免慢仓库阻塞整体进度展示。
    若提供了 ``is_cancelled`` 可调用对象，在开始新分片调度时检查一次；
    已提交的分片不受影响，继续执行直到完成。
    """
    results: list[SyncResult | None] = [None] * len(repositories)
    # Git 子进程是全局资源，用户配置过大时仍需受硬上限保护。
    max_workers = min(HARD_MAX_GIT_PROCESSES, max(1, settings.concurrent_limit))
    next_index = 0

    def mark_remaining_cancelled(start_index: int) -> None:
        """把尚未提交到线程池的仓库标记为已取消，避免继续启动 Git 子进程。"""
        for remaining_index in range(start_index, len(repositories)):
            if results[remaining_index] is not None:
                continue
            results[remaining_index] = SyncResult(
                repositories[remaining_index].name,
                "SKIPPED",
                "已取消",
            )
            if progress_callback is not None:
                progress_callback(results[remaining_index])

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_index = {}

        def submit_until_full() -> None:
            """维持有界队列：只提交可立即运行的分片，取消后不再塞满等待队列。"""
            nonlocal next_index
            while len(future_to_index) < max_workers and next_index < len(repositories):
                # 在提交每个新分片前检查取消标记，已提交的继续完成。
                if is_cancelled is not None and is_cancelled():
                    mark_remaining_cancelled(next_index)
                    next_index = len(repositories)
                    return
                future_to_index[pool.submit(worker, repositories[next_index])] = next_index
                next_index += 1

        submit_until_full()

        while future_to_index:
            done, _ = wait(future_to_index, return_when=FIRST_COMPLETED)
            for future in done:
                index = future_to_index.pop(future)
                repository = repositories[index]
                try:
                    result = future.result()
                except Exception as exc:
                    result = SyncResult(repository.name, "FAILED", f"同步失败，执行异常：{exc}")
                results[index] = result
                if progress_callback is not None:
                    progress_callback(result)
            submit_until_full()
    return [item for item in results if item is not None]


def sync_all_repositories(
    repositories: list[RepositoryConfig],
    settings: SettingsConfig,
    *,
    checker,
    git_runner,
    progress_callback=None,
    is_cancelled: Callable[[], bool] | None = None,
) -> list[SyncResult]:
    enabled = [item for item in repositories if item.enabled]

    def worker(repository: RepositoryConfig) -> SyncResult:
        # 同步策略由仓库配置决定，线程池只负责调度，不改变安全/强制同步语义。
        return sync_repository_by_policy(repository, settings, checker=checker, git_runner=git_runner)

    return run_repositories_concurrently(
        enabled,
        settings,
        worker,
        progress_callback=progress_callback,
        is_cancelled=is_cancelled,
    )
