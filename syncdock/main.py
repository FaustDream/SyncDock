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
    config_dir = project_root / "config"
    log_dir = project_root / "logs"
    try:
        runtime = load_runtime_config(config_dir)
    except (OSError, ValueError) as error:
        print(f"配置加载失败：{error}")
        return 1
    if args.silent:
        return run_menu(runtime, silent=True, config_dir=config_dir, log_dir=log_dir)
    return run_menu(runtime, silent=False, config_dir=config_dir, log_dir=log_dir)


if __name__ == "__main__":
    raise SystemExit(main())
