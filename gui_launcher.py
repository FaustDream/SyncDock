"""SyncDock 5.0 — 后台启动器

用 pythonw.exe 运行，无窗口。
启动服务器 → 开浏览器 → 保持运行。
关闭页面时点"关闭服务"，自动清理退出。
"""

from __future__ import annotations

import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


# 默认端口保持历史访问习惯；扫描上限用于绕开 Windows/Hyper-V 的连续保留端口段。
DEFAULT_GUI_PORT = 8866
PORT_SCAN_LIMIT = 200


def _free_port(port: int = DEFAULT_GUI_PORT) -> None:
    """杀掉占用指定端口的进程。"""
    try:
        output = subprocess.check_output(
            ["netstat", "-ano"],
            stderr=subprocess.DEVNULL,
        ).decode("gbk", errors="replace")
        for line in output.splitlines():
            if f":{port}" not in line:
                continue
            match = re.search(r"LISTENING\s+(\d+)", line)
            if match:
                subprocess.run(
                    ["taskkill", "/f", "/pid", match.group(1)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                time.sleep(0.5)
                return
    except (OSError, subprocess.CalledProcessError):
        pass


def _is_port_bindable(port: int) -> bool:
    """检查本机 GUI 端口是否可绑定，覆盖 Windows 端口排除范围和已占用两类失败。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", port))
    except OSError:
        return False
    return True


def _find_gui_port(preferred: int = DEFAULT_GUI_PORT, scan_limit: int = PORT_SCAN_LIMIT) -> int:
    """选择 GUI 服务端口；优先复用默认端口，不可绑定时向后扫描邻近端口。"""
    _free_port(preferred)
    if _is_port_bindable(preferred):
        return preferred

    # Windows/Hyper-V 可能保留连续端口段，逐个试探比依赖 netstat 更可靠。
    for port in range(preferred + 1, preferred + scan_limit + 1):
        if _is_port_bindable(port):
            return port

    raise RuntimeError(f"No bindable GUI port found near {preferred}")


def _wait_for_server(url: str, timeout: float = 10) -> bool:
    """轮询直到服务器就绪。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.3)
    return False


def main() -> None:
    root = Path(__file__).resolve().parent
    os.chdir(root)

    port = _find_gui_port()
    base_url = f"http://127.0.0.1:{port}"
    browser_url = f"http://localhost:{port}"

    # 启动 uvicorn
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn",
         "syncdock.gui.server:app",
         "--host", "127.0.0.1", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # 等服务器就绪
    ready = _wait_for_server(f"{base_url}/")

    # 开浏览器
    webbrowser.open(browser_url)

    # 保持运行，等服务器退出
    # 用户点击页面上的"关闭服务"→ 服务器退出 → proc.wait() 返回 → 启动器退出
    if ready:
        proc.wait()
    else:
        # 服务器没起来，等一会儿再检查
        time.sleep(5)
        if proc.poll() is None:
            proc.terminate()


if __name__ == "__main__":
    main()
