"""SyncDock 5.0 — 后台启动器

用 pythonw.exe 运行，无窗口。
启动服务器 → 开浏览器 → 保持运行。
关闭页面时点"关闭服务"，自动清理退出。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


def _free_port(port: int = 8866) -> None:
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

    # 清理旧进程
    _free_port(8866)

    # 启动 uvicorn
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn",
         "syncdock.gui.server:app",
         "--host", "127.0.0.1", "--port", "8866"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # 等服务器就绪
    ready = _wait_for_server("http://127.0.0.1:8866/")

    # 开浏览器
    webbrowser.open("http://localhost:8866")

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
