from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import subprocess

from syncdock.config_service import RepositoryConfig, SettingsConfig


@dataclass(slots=True)
class SyncResult:
    name: str
    outcome: str
    message: str


SyncWorker = Callable[[RepositoryConfig], SyncResult]
HARD_MAX_GIT_PROCESSES = 6


class GitCommandRunner:
    def run(self, cwd: str, args: list[str], timeout_seconds: int, proxy_port: int | None = None) -> tuple[bool, str]:
        try:
            completed = subprocess.run(
                self._build_command(args, proxy_port),
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


def sync_single_repository(repository: RepositoryConfig, settings: SettingsConfig, *, checker, git_runner) -> SyncResult:
    inspection = checker.inspect(repository, settings)

    if inspection["kind"] == "invalid":
        return SyncResult(repository.name, "INVALID", inspection["message"])
    if inspection["kind"] == "skipped":
        return SyncResult(repository.name, "SKIPPED", inspection["message"])
    if inspection["kind"] == "failed":
        return SyncResult(repository.name, "FAILED", inspection["message"])

    fetch_ok, fetch_message = git_runner.run(
        repository.path,
        ["fetch", "--all", "--prune"],
        settings.command_timeout_seconds,
        settings.proxy_port,
    )
    if not fetch_ok:
        return SyncResult(repository.name, "FAILED", fetch_message)

    inspection = checker.inspect(repository, settings)
    if inspection["kind"] == "invalid":
        return SyncResult(repository.name, "INVALID", inspection["message"])
    if inspection["kind"] == "skipped":
        return SyncResult(repository.name, "SKIPPED", inspection["message"])
    if inspection["kind"] == "failed":
        return SyncResult(repository.name, "FAILED", inspection["message"])
    if inspection.get("status_code") == "ahead_only":
        return SyncResult(repository.name, "SKIPPED", inspection["message"])
    if not inspection["needs_pull"]:
        return SyncResult(repository.name, "UP_TO_DATE", "已经是最新")

    pull_ok, pull_message = git_runner.run(
        repository.path,
        ["pull", "--ff-only"],
        settings.command_timeout_seconds,
        settings.proxy_port,
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
        return SyncResult(repository.name, "INVALID", inspection["message"])
    if inspection["kind"] == "skipped":
        return SyncResult(repository.name, "SKIPPED", inspection["message"])
    if inspection["kind"] == "failed":
        return SyncResult(repository.name, "FAILED", inspection["message"])

    fetch_ok, fetch_message = git_runner.run(
        repository.path,
        ["fetch", "--all", "--prune"],
        settings.command_timeout_seconds,
        settings.proxy_port,
    )
    if not fetch_ok:
        return SyncResult(repository.name, "FAILED", fetch_message)

    reset_ok, reset_message = git_runner.run(
        repository.path,
        ["reset", "--hard", "@{upstream}"],
        settings.command_timeout_seconds,
        settings.proxy_port,
    )
    if not reset_ok:
        return SyncResult(repository.name, "FAILED", reset_message)

    clean_ok, clean_message = git_runner.run(
        repository.path,
        ["clean", "-fd"],
        settings.command_timeout_seconds,
        settings.proxy_port,
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
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_index = {}
        for index, repository in enumerate(repositories):
            # 在提交每个新分片前检查取消标记，已提交的继续完成。
            if is_cancelled is not None and is_cancelled():
                # 将剩余未提交的仓库标记为 SKIPPED 并跳过调度。
                for remaining_index in range(index, len(repositories)):
                    results[remaining_index] = SyncResult(
                        repositories[remaining_index].name,
                        "SKIPPED",
                        "已取消",
                    )
                    if progress_callback is not None:
                        progress_callback(results[remaining_index])
                break
            future_to_index[pool.submit(worker, repository)] = index

        for future in as_completed(future_to_index):
            index = future_to_index[future]
            repository = repositories[index]
            try:
                result = future.result()
            except Exception as exc:
                result = SyncResult(repository.name, "FAILED", f"同步失败，执行异常：{exc}")
            results[index] = result
            if progress_callback is not None:
                progress_callback(result)
    return [item for item in results if item is not None]


def sync_all_repositories(
    repositories: list[RepositoryConfig],
    settings: SettingsConfig,
    *,
    checker,
    git_runner,
    progress_callback=None,
) -> list[SyncResult]:
    enabled = [item for item in repositories if item.enabled]

    def worker(repository: RepositoryConfig) -> SyncResult:
        # 同步策略由仓库配置决定，线程池只负责调度，不改变安全/强制同步语义。
        return sync_repository_by_policy(repository, settings, checker=checker, git_runner=git_runner)

    return run_repositories_concurrently(enabled, settings, worker, progress_callback=progress_callback)
