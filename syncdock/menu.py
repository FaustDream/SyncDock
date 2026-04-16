from __future__ import annotations

from pathlib import Path

from syncdock.config_service import RuntimeConfig, load_runtime_config
from syncdock.log_service import read_latest_failed_log, read_latest_log, render_result_line, render_summary, write_log_session
from syncdock.progress import create_progress_bar
from syncdock.repo_checker import RepositoryChecker
from syncdock.sync_engine import (
    GitCommandRunner,
    force_sync_single_repository,
    summarize_results,
    sync_all_repositories,
    sync_single_repository,
)


def render_two_column_table(left_header: str, right_header: str, rows: list[tuple[str, str]]) -> str:
    left_width = max(len(left_header), *(len(left) for left, _ in rows)) if rows else len(left_header)
    right_width = max(len(right_header), *(len(right) for _, right in rows)) if rows else len(right_header)
    border = f"+-{'-' * left_width}-+-{'-' * right_width}-+"
    header = f"| {left_header.ljust(left_width)} | {right_header.ljust(right_width)} |"
    body = [f"| {left.ljust(left_width)} | {right.ljust(right_width)} |" for left, right in rows]
    return "\n".join([border, header, border, *body, border])


def render_main_menu() -> str:
    return "\n".join(
        [
            "SyncDock 4.0",
            "",
            "1. 同步全部仓库",
            "2. 同步指定仓库（可多选）",
            "3. 查看仓库状态",
            "4. 查看最近日志",
            "5. 查看最近失败仓库",
            "6. 重新加载配置",
            "7. 强制同步指定仓库（可多选）",
            "0. 退出",
        ]
    )


def handle_menu_choice(choice: str) -> str:
    mapping = {
        "1": "sync_all",
        "2": "sync_selected",
        "3": "status",
        "4": "recent_log",
        "5": "recent_failed_log",
        "6": "reload_config",
        "7": "force_sync_selected",
        "0": "exit",
    }
    return mapping.get(choice.strip(), "invalid")


def parse_repository_selection(raw_choice: str, repository_count: int) -> list[int]:
    raw_tokens = raw_choice.replace(",", " ").split()
    if not raw_tokens:
        raise ValueError("请选择至少一个仓库编号")

    indices: list[int] = []
    seen: set[int] = set()
    for token in raw_tokens:
        if not token.isdigit():
            raise ValueError("请输入有效编号，多个编号可用空格或逗号分隔")
        selected_index = int(token) - 1
        if selected_index < 0 or selected_index >= repository_count:
            raise ValueError("输入的仓库编号超出范围")
        if selected_index not in seen:
            indices.append(selected_index)
            seen.add(selected_index)
    return indices


def _print_sync_results(results, log_dir: Path | None) -> None:
    lines = [render_result_line(item) for item in results]
    summary = render_summary(**summarize_results(results))
    for line in lines:
        print(line)
    print(summary)
    if log_dir is not None:
        write_log_session(log_dir, lines + ["", summary])


def _sync_all(runtime: RuntimeConfig, checker, git_runner, log_dir: Path | None, *, progress_factory=create_progress_bar) -> None:
    enabled_count = sum(1 for item in runtime.repositories if item.enabled)
    progress = progress_factory("同步进度", enabled_count) if enabled_count else None
    results = sync_all_repositories(
        runtime.repositories,
        runtime.settings,
        checker=checker,
        git_runner=git_runner,
        progress_callback=(lambda result: progress.advance(f"已完成：{result.name}")) if progress else None,
    )
    _print_sync_results(results, log_dir)


def _select_enabled_repositories(runtime: RuntimeConfig) -> list:
    enabled = [item for item in runtime.repositories if item.enabled]
    if not enabled:
        print("没有可同步的仓库")
        return []

    rows = [(str(index), repository.name) for index, repository in enumerate(enabled, start=1)]
    print(render_two_column_table("序号", "仓库", rows))
    return enabled


def _sync_repositories_with_progress(
    repositories: list,
    settings,
    *,
    checker,
    git_runner,
    force: bool,
    progress_factory=create_progress_bar,
) -> list:
    progress_title = "强制同步进度" if force else "同步进度"
    progress = progress_factory(progress_title, len(repositories)) if repositories else None
    results = []
    for repository in repositories:
        if force:
            result = force_sync_single_repository(repository, settings, checker=checker, git_runner=git_runner)
        else:
            result = sync_single_repository(repository, settings, checker=checker, git_runner=git_runner)
        results.append(result)
        if progress is not None:
            progress.advance(f"已完成：{repository.name}")
    return results


def _sync_selected(
    runtime: RuntimeConfig,
    checker,
    git_runner,
    log_dir: Path | None,
    *,
    force: bool,
    progress_factory=create_progress_bar,
) -> None:
    enabled = _select_enabled_repositories(runtime)
    if not enabled:
        return

    prompt = "请输入仓库编号，多个编号可用空格或逗号分隔: "
    raw_choice = input(prompt).strip()
    try:
        selected_indices = parse_repository_selection(raw_choice, len(enabled))
    except ValueError as error:
        print(str(error))
        return

    selected_repositories = [enabled[index] for index in selected_indices]
    results = _sync_repositories_with_progress(
        selected_repositories,
        runtime.settings,
        checker=checker,
        git_runner=git_runner,
        force=force,
        progress_factory=progress_factory,
    )

    _print_sync_results(results, log_dir)


def _collect_status_rows(runtime: RuntimeConfig, checker, *, progress_factory=create_progress_bar) -> list[tuple[str, str]]:
    enabled = [repository for repository in runtime.repositories if repository.enabled]
    progress = progress_factory("查询仓库状态", len(enabled)) if enabled else None
    rows: list[tuple[str, str]] = []
    for repository in enabled:
        inspection = checker.inspect(repository, runtime.settings)
        rows.append((repository.name, inspection["message"]))
        if progress is not None:
            progress.advance(f"已完成：{repository.name}")
    return rows


def _show_status(runtime: RuntimeConfig, checker, *, progress_factory=create_progress_bar) -> None:
    rows = _collect_status_rows(runtime, checker, progress_factory=progress_factory)
    if not rows:
        print("没有可查看状态的仓库")
        return

    print(render_two_column_table("仓库", "状态", rows))


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
        try:
            if action == "sync_all":
                _sync_all(current_runtime, checker, git_runner, log_dir)
                continue
            if action == "sync_selected":
                _sync_selected(current_runtime, checker, git_runner, log_dir, force=False)
                continue
            if action == "force_sync_selected":
                _sync_selected(current_runtime, checker, git_runner, log_dir, force=True)
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
            if action == "recent_failed_log":
                if log_dir is None:
                    print("暂无日志")
                else:
                    print(read_latest_failed_log(log_dir))
                continue
            if action == "reload_config":
                if config_dir is None:
                    print("当前无法重新加载配置")
                else:
                    try:
                        current_runtime = load_runtime_config(config_dir)
                    except (OSError, ValueError) as error:
                        print(f"重新加载配置失败：{error}")
                    else:
                        print("配置已重新加载")
        except Exception as error:
            print(f"操作执行失败：{error}")
