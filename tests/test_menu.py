from syncdock.menu import render_main_menu


def test_render_main_menu_contains_required_options():
    text = render_main_menu()

    assert "1. 同步全部仓库" in text
    assert "2. 同步指定仓库" in text
    assert "3. 查看仓库状态" in text
    assert "4. 查看最近日志" in text
    assert "5. 重新加载配置" in text
    assert "0. 退出" in text


def test_handle_menu_choice_returns_exit_for_zero():
    from syncdock.menu import handle_menu_choice

    assert handle_menu_choice("0") == "exit"


def test_run_menu_exits_only_after_zero(monkeypatch, capsys):
    from syncdock.config_service import RuntimeConfig, RepositoryConfig, SettingsConfig
    from syncdock.menu import run_menu

    runtime = RuntimeConfig(
        repositories=[RepositoryConfig(name="SyncDock", path="E:\\gitHub\\SyncDock", enabled=True)],
        settings=SettingsConfig(
            concurrent_limit=3,
            command_timeout_seconds=120,
            skip_uncommitted_changes=True,
            skip_untracked_files=False,
            log_retention_days=30,
        ),
    )
    answers = iter(["9", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(runtime, silent=False)

    output = capsys.readouterr().out
    assert code == 0
    assert "请输入有效选项" in output
    assert output.count("SyncDock 4.0") == 2
