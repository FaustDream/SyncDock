from __future__ import annotations

from pathlib import Path

from syncdock.config_service import RuntimeConfig, load_runtime_config
from syncdock.log_service import read_latest_log, render_result_line, render_summary, write_log_session
from syncdock.repo_checker import RepositoryChecker
from syncdock.sync_engine import GitCommandRunner, summarize_results, sync_all_repositories, sync_single_repository


def render_main_menu() -> str:
    return "\n".join(
        [
            "SyncDock 4.0",
            "",
            "1. 同步全部仓库",
            "2. 同步指定仓库",
            "3. 查看仓库状态",
            "4. 查看最近日志",
            "5. 重新加载配置",
            "0. 退出",
        ]
    )


def handle_menu_choice(choice: str) -> str:
    mapping = {
        "1": "sync_all",
        "2": "sync_one",
        "3": "status",
        "4": "recent_log",
        "5": "reload_config",
        "0": "exit",
    }
    return mapping.get(choice.strip(), "invalid")


def _print_sync_results(results, log_dir: Path | None) -> None:
    lines = [render_result_line(item) for item in results]
    summary = render_summary(**summarize_results(results))
    for line in lines:
        print(line)
    print(summary)
    if log_dir is not None:
        write_log_session(log_dir, lines + ["", summary])


def _sync_all(runtime: RuntimeConfig, checker, git_runner, log_dir: Path | None) -> None:
    results = sync_all_repositories(runtime.repositories, runtime.settings, checker=checker, git_runner=git_runner)
    _print_sync_results(results, log_dir)


def _sync_one(runtime: RuntimeConfig, checker, git_runner, log_dir: Path | None) -> None:
    enabled = [item for item in runtime.repositories if item.enabled]
    if not enabled:
        print("没有可同步的仓库")
        return

    for index, repository in enumerate(enabled, start=1):
        print(f"{index}. {repository.name}")

    raw_choice = input("请选择仓库编号: ").strip()
    if not raw_choice.isdigit():
        print("请输入有效编号")
        return

    selected_index = int(raw_choice) - 1
    if selected_index < 0 or selected_index >= len(enabled):
        print("请输入有效编号")
        return

    result = sync_single_repository(enabled[selected_index], runtime.settings, checker=checker, git_runner=git_runner)
    _print_sync_results([result], log_dir)


def _show_status(runtime: RuntimeConfig, checker) -> None:
    for repository in runtime.repositories:
        if not repository.enabled:
            continue
        inspection = checker.inspect(repository, runtime.settings)
        print(f"{repository.name}: {inspection['message']}")


def run_menu(
    runtime: RuntimeConfig,
    *,
    silent: bool,
    checker=None,
    git_runner=None,
    config_dir: Path | None = None,
    log_dir: Path | None = None,
) -> int:
    checker = checker or RepositoryChecker()
    git_runner = git_runner or GitCommandRunner()
    current_runtime = runtime

    if silent:
        _sync_all(current_runtime, checker, git_runner, log_dir)
        return 0

    while True:
        print(render_main_menu())
        action = handle_menu_choice(input("请选择: "))
        if action == "exit":
            return 0
        if action == "invalid":
            print("请输入有效选项")
            continue
        if action == "sync_all":
            _sync_all(current_runtime, checker, git_runner, log_dir)
            continue
        if action == "sync_one":
            _sync_one(current_runtime, checker, git_runner, log_dir)
            continue
        if action == "status":
            _show_status(current_runtime, checker)
            continue
        if action == "recent_log":
            if log_dir is None:
                print("暂无日志")
            else:
                print(read_latest_log(log_dir))
            continue
        if action == "reload_config":
            if config_dir is None:
                print("当前无法重新加载配置")
            else:
                current_runtime = load_runtime_config(config_dir)
                print("配置已重新加载")
