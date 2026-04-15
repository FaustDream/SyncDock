from __future__ import annotations

from dataclasses import dataclass


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
