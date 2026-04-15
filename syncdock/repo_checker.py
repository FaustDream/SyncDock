from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import subprocess

from syncdock.config_service import RepositoryConfig, SettingsConfig


@dataclass(slots=True)
class RepoStatus:
    has_uncommitted_changes: bool
    has_untracked_files: bool
    untracked_count: int


def parse_status_lines(lines: list[str]) -> RepoStatus:
    has_uncommitted_changes = False
    has_untracked_files = False
    untracked_count = 0

    for line in lines:
        if line.startswith("??"):
            has_untracked_files = True
            untracked_count += 1
        elif line.strip():
            has_uncommitted_changes = True

    return RepoStatus(
        has_uncommitted_changes=has_uncommitted_changes,
        has_untracked_files=has_untracked_files,
        untracked_count=untracked_count,
    )


class RepositoryChecker:
    def inspect(self, repository: RepositoryConfig, settings: SettingsConfig) -> dict:
        path = Path(repository.path)
        if not path.exists():
            return {
                "kind": "invalid",
                "message": "仓库无效，路径不存在",
                "needs_pull": False,
            }

        health = self._run_git(path, "rev-parse", "--is-inside-work-tree")
        if not health or health.stdout.strip() != "true":
            return {
                "kind": "invalid",
                "message": "仓库无效，不是 Git 仓库",
                "needs_pull": False,
            }

        branch = self._run_git(path, "branch", "--show-current")
        if not branch or not branch.stdout.strip():
            return {
                "kind": "skipped",
                "message": "已跳过，当前不在分支上",
                "needs_pull": False,
            }

        status_result = self._run_git(path, "status", "--porcelain")
        lines = status_result.stdout.splitlines() if status_result else []
        parsed_status = parse_status_lines(lines)
        if settings.skip_uncommitted_changes and parsed_status.has_uncommitted_changes:
            return {
                "kind": "skipped",
                "message": "已跳过，有未提交修改",
                "needs_pull": False,
            }
        if settings.skip_untracked_files and parsed_status.has_untracked_files:
            return {
                "kind": "skipped",
                "message": "已跳过，有未跟踪文件",
                "needs_pull": False,
            }

        upstream = self._run_git(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        if not upstream:
            return {
                "kind": "skipped",
                "message": "已跳过，当前分支未设置同步目标",
                "needs_pull": False,
            }

        counts = self._run_git(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
        ahead = 0
        behind = 0
        if counts:
            parts = counts.stdout.split()
            if len(parts) == 2:
                ahead = int(parts[0])
                behind = int(parts[1])

        if ahead > 0 and behind > 0:
            return {
                "kind": "skipped",
                "message": "已跳过，需要手动处理分支差异",
                "needs_pull": False,
            }

        return {
            "kind": "ready",
            "message": "需要同步" if behind > 0 else "已经是最新",
            "needs_pull": behind > 0,
            "ahead_count": ahead,
            "behind_count": behind,
        }

    def _run_git(self, cwd: Path, *args: str) -> subprocess.CompletedProcess | None:
        try:
            return subprocess.run(
                ["git", *args],
                cwd=cwd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except subprocess.CalledProcessError:
            return None
