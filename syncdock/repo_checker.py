from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess

from syncdock.advice_service import get_sync_suggestion
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
    def inspect(
        self,
        repository: RepositoryConfig,
        settings: SettingsConfig,
        *,
        ignore_uncommitted_changes: bool = False,
        ignore_untracked_files: bool = False,
        ignore_divergence: bool = False,
        refresh_remote: bool = False,
    ) -> dict:
        path = Path(repository.path)
        if not path.exists():
            return {
                "kind": "invalid",
                "message": "仓库无效，路径不存在",
                "needs_pull": False,
                "status_code": "invalid_path",
            }

        health = self._run_git(path, "rev-parse", "--is-inside-work-tree")
        if not health or health.stdout.strip() != "true":
            return {
                "kind": "invalid",
                "message": "仓库无效，不是 Git 仓库",
                "needs_pull": False,
                "status_code": "not_git_repository",
            }

        branch = self._run_git(path, "branch", "--show-current")
        branch_name = branch.stdout.strip() if branch else ""
        if not branch_name:
            return {
                "kind": "skipped",
                "message": "已跳过，当前不在分支上",
                "needs_pull": False,
                "status_code": "detached_head",
            }

        status_result = self._run_git(path, "status", "--porcelain")
        lines = status_result.stdout.splitlines() if status_result else []
        parsed_status = parse_status_lines(lines)
        if (
            settings.skip_uncommitted_changes
            and not ignore_uncommitted_changes
            and parsed_status.has_uncommitted_changes
        ):
            return {
                "kind": "skipped",
                "message": "已跳过，有未提交修改",
                "needs_pull": False,
                "status_code": "local_changes",
                "branch_name": branch_name,
            }
        if settings.skip_untracked_files and not ignore_untracked_files and parsed_status.has_untracked_files:
            return {
                "kind": "skipped",
                "message": "已跳过，有未跟踪文件",
                "needs_pull": False,
                "status_code": "untracked_files",
                "branch_name": branch_name,
            }

        upstream = self._run_git(path, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        if not upstream:
            return {
                "kind": "skipped",
                "message": "已跳过，当前分支未设置同步目标",
                "needs_pull": False,
                "status_code": "no_upstream",
                "branch_name": branch_name,
            }
        upstream_name = upstream.stdout.strip()

        if refresh_remote:
            remote_status = self._refresh_remote(path, settings.command_timeout_seconds, settings.proxy_port)
            if remote_status is not None:
                return {
                    "kind": "failed",
                    "message": remote_status,
                    "needs_pull": False,
                    "status_code": "remote_refresh_failed",
                    "branch_name": branch_name,
                    "upstream_name": upstream_name,
                }

        counts = self._run_git(path, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
        ahead = 0
        behind = 0
        if counts:
            parts = counts.stdout.split()
            if len(parts) == 2:
                ahead = int(parts[0])
                behind = int(parts[1])

        if ahead > 0 and behind > 0 and not ignore_divergence:
            return {
                "kind": "skipped",
                "message": "已跳过，需要手动处理分支差异",
                "needs_pull": False,
                "status_code": "diverged",
                "branch_name": branch_name,
                "upstream_name": upstream_name,
                "ahead_count": ahead,
                "behind_count": behind,
            }

        if repository.uses_force_sync and (ahead > 0 or behind > 0):
            return {
                "kind": "ready",
                "message": "需要强制同步",
                "needs_pull": True,
                "status_code": "needs_force_sync",
                "branch_name": branch_name,
                "upstream_name": upstream_name,
                "ahead_count": ahead,
                "behind_count": behind,
            }

        if ahead > 0 and behind == 0:
            return {
                "kind": "ready",
                "message": "本地有未推送提交",
                "needs_pull": False,
                "status_code": "ahead_only",
                "branch_name": branch_name,
                "upstream_name": upstream_name,
                "ahead_count": ahead,
                "behind_count": behind,
            }

        return {
            "kind": "ready",
            "message": "需要同步" if behind > 0 else "已经是最新",
            "needs_pull": behind > 0,
            "status_code": "needs_sync" if behind > 0 else "up_to_date",
            "branch_name": branch_name,
            "upstream_name": upstream_name,
            "ahead_count": ahead,
            "behind_count": behind,
        }

    def _refresh_remote(self, cwd: Path, timeout_seconds: int, proxy_port: int | None = None) -> str | None:
        try:
            subprocess.run(
                self._build_command(["fetch", "--all", "--prune"], proxy_port),
                cwd=cwd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout_seconds,
            )
            return None
        except subprocess.TimeoutExpired:
            return "查询远端状态失败，Git 执行超时"
        except subprocess.CalledProcessError as error:
            stderr = (error.stderr or "").lower()
            if "could not read from remote repository" in stderr or "permission denied" in stderr:
                return "查询远端状态失败，没有权限访问仓库"
            if "could not resolve host" in stderr or "failed to connect" in stderr:
                return "查询远端状态失败，网络连接异常"
            return "查询远端状态失败"

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

    def _run_git(self, cwd: Path, *args: str) -> subprocess.CompletedProcess | None:
        try:
            return subprocess.run(
                ["git", *args],
                cwd=cwd,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except subprocess.CalledProcessError:
            return None


def format_status_detail(repository: RepositoryConfig, inspection: dict) -> str:
    parts = [inspection["message"]]

    branch_name = inspection.get("branch_name")
    upstream_name = inspection.get("upstream_name")
    if branch_name and upstream_name:
        parts.append(f"分支 {branch_name} -> {upstream_name}")
    elif branch_name:
        parts.append(f"分支 {branch_name}")

    ahead_count = int(inspection.get("ahead_count", 0) or 0)
    behind_count = int(inspection.get("behind_count", 0) or 0)
    if ahead_count > 0:
        parts.append(f"本地领先 {ahead_count}")
    if behind_count > 0:
        parts.append(f"远端领先 {behind_count}")

    parts.append(f"策略：{'强制同步' if repository.uses_force_sync else '安全同步'}")

    suggestion = get_sync_suggestion(inspection["message"])
    if suggestion is not None:
        parts.append(f"建议：{suggestion}")

    return " | ".join(parts)
