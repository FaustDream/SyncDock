from __future__ import annotations

import argparse
from pathlib import Path

from syncdock.config_service import load_runtime_config
from syncdock.menu import run_menu


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SyncDock 4.0")
    parser.add_argument("--silent", action="store_true", help="Run full sync once and exit")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = Path(__file__).resolve().parent.parent
    runtime = load_runtime_config(project_root / "config")
    if args.silent:
        return run_menu(runtime, silent=True)
    return run_menu(runtime, silent=False)


if __name__ == "__main__":
    raise SystemExit(main())
