from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from syncdock.config_service import RepositoryConfig, SettingsConfig


@dataclass(slots=True)
class SyncResult:
    name: str
    outcome: str
    message: str


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
    if not inspection["needs_pull"]:
        return SyncResult(repository.name, "UP_TO_DATE", "已经是最新")

    fetch_ok, fetch_message = git_runner.run(
        repository.path,
        ["fetch", "--all", "--prune"],
        settings.command_timeout_seconds,
    )
    if not fetch_ok:
        return SyncResult(repository.name, "FAILED", fetch_message)

    pull_ok, pull_message = git_runner.run(
        repository.path,
        ["pull", "--ff-only"],
        settings.command_timeout_seconds,
    )
    if not pull_ok:
        return SyncResult(repository.name, "FAILED", pull_message)

    return SyncResult(repository.name, "UPDATED", pull_message or "已拉取最新代码")


def sync_all_repositories(
    repositories: list[RepositoryConfig],
    settings: SettingsConfig,
    *,
    checker,
    git_runner,
) -> list[SyncResult]:
    enabled = [item for item in repositories if item.enabled]
    with ThreadPoolExecutor(max_workers=settings.concurrent_limit) as pool:
        futures = [
            pool.submit(
                sync_single_repository,
                repository,
                settings,
                checker=checker,
                git_runner=git_runner,
            )
            for repository in enabled
        ]
        return [future.result() for future in futures]
