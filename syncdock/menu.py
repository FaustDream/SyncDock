from __future__ import annotations

from syncdock.config_service import RuntimeConfig

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


def run_menu(runtime: RuntimeConfig, *, silent: bool) -> int:
    if silent:
        return 0

    while True:
        print(render_main_menu())
        action = handle_menu_choice(input("请选择: "))
        if action == "exit":
            return 0
        if action == "invalid":
            print("请输入有效选项")
            continue
        print("该功能正在接入中")
