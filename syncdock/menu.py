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


def run_menu(runtime: RuntimeConfig, *, silent: bool) -> int:
    if silent:
        return 0

    print(render_main_menu())
    return 0
