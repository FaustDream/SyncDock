"""测试 GUI 启动器的端口选择逻辑。"""

import gui_launcher


def test_find_gui_port_prefers_default_when_bindable(monkeypatch):
    """默认端口可绑定时必须优先使用，保持 README 中的稳定访问入口。"""
    freed_ports: list[int] = []

    def fake_free_port(port: int) -> None:
        freed_ports.append(port)

    monkeypatch.setattr(gui_launcher, "_free_port", fake_free_port)
    monkeypatch.setattr(gui_launcher, "_is_port_bindable", lambda port: True)

    assert gui_launcher._find_gui_port(8866, scan_limit=3) == 8866
    assert freed_ports == [8866]


def test_find_gui_port_falls_back_when_default_is_reserved(monkeypatch):
    """默认端口被 Windows 保留或占用时，启动器应自动选择后续可绑定端口。"""
    bindable_ports = {8869}

    monkeypatch.setattr(gui_launcher, "_free_port", lambda port: None)
    monkeypatch.setattr(gui_launcher, "_is_port_bindable", lambda port: port in bindable_ports)

    assert gui_launcher._find_gui_port(8866, scan_limit=4) == 8869
