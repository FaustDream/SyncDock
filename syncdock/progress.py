from __future__ import annotations

import sys
from typing import TextIO


class ProgressBar:
    def __init__(self, title: str, total: int, *, width: int = 24, stream: TextIO | None = None) -> None:
        self.title = title
        self.total = max(1, total)
        self.width = width
        self.stream = stream or sys.stdout
        self.current = 0
        self.finished = False
        self._render("准备中")

    def advance(self, detail: str = "") -> None:
        if self.finished:
            return

        self.current = min(self.total, self.current + 1)
        self._render(detail)
        if self.current >= self.total:
            self.stream.write("\n")
            self.stream.flush()
            self.finished = True

    def _render(self, detail: str) -> None:
        filled = int(self.width * self.current / self.total)
        bar = "#" * filled + "-" * (self.width - filled)
        suffix = f" {detail}" if detail else ""
        self.stream.write(f"\r{self.title} [{bar}] {self.current}/{self.total}{suffix}")
        self.stream.flush()


def create_progress_bar(title: str, total: int) -> ProgressBar:
    return ProgressBar(title, total)
