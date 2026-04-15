from pathlib import Path

from syncdock.menu import handle_menu_choice, render_main_menu, run_menu


class FakeChecker:
    def inspect(self, repository, settings):
        return {
            "kind": "ready",
            "needs_pull": False,
            "message": "已经是最新",
        }


class FakeGitRunner:
    def run(self, cwd: str, args: list[str], timeout_seconds: int) -> tuple[bool, str]:
        return True, ""


def _runtime():
    from syncdock.config_service import RuntimeConfig, RepositoryConfig, SettingsConfig

    return RuntimeConfig(
        repositories=[RepositoryConfig(name="SyncDock", path="E:\\gitHub\\SyncDock", enabled=True)],
        settings=SettingsConfig(
            concurrent_limit=3,
            command_timeout_seconds=120,
            skip_uncommitted_changes=True,
            skip_untracked_files=False,
            log_retention_days=30,
        ),
    )


def test_render_main_menu_contains_required_options():
    text = render_main_menu()

    assert "1. 同步全部仓库" in text
    assert "2. 同步指定仓库" in text
    assert "3. 查看仓库状态" in text
    assert "4. 查看最近日志" in text
    assert "5. 重新加载配置" in text
    assert "0. 退出" in text


def test_handle_menu_choice_returns_exit_for_zero():
    assert handle_menu_choice("0") == "exit"


def test_run_menu_exits_only_after_zero(monkeypatch, capsys):
    answers = iter(["9", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(_runtime(), silent=False)

    output = capsys.readouterr().out
    assert code == 0
    assert "请输入有效选项" in output
    assert output.count("SyncDock 4.0") == 2


def test_run_menu_silent_runs_sync_all_and_writes_log(tmp_path: Path, capsys):
    code = run_menu(
        _runtime(),
        silent=True,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
        log_dir=tmp_path / "logs",
    )

    output = capsys.readouterr().out
    log_files = list((tmp_path / "logs").glob("*.log"))
    assert code == 0
    assert "同步完成" in output
    assert len(log_files) == 1
    assert "SyncDock: 已经是最新" in log_files[0].read_text(encoding="utf-8")


def test_run_menu_status_displays_checker_message(monkeypatch, capsys):
    answers = iter(["3", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(
        _runtime(),
        silent=False,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
    )

    output = capsys.readouterr().out
    assert code == 0
    assert "SyncDock: 已经是最新" in output


def test_run_menu_sync_one_runs_selected_repository(monkeypatch, capsys):
    answers = iter(["2", "1", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(
        _runtime(),
        silent=False,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
    )

    output = capsys.readouterr().out
    assert code == 0
    assert "1. SyncDock" in output
    assert "SyncDock: 已经是最新" in output


def test_run_menu_recent_log_displays_latest_log(monkeypatch, tmp_path: Path, capsys):
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-20260415-220000.log").write_text("最近一次日志\n", encoding="utf-8")
    answers = iter(["4", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(
        _runtime(),
        silent=False,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
        log_dir=log_dir,
    )

    output = capsys.readouterr().out
    assert code == 0
    assert "最近一次日志" in output


def test_run_menu_reloads_config_from_directory(monkeypatch, tmp_path: Path, capsys):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "repositories.json").write_text(
        '{"repositories":[{"name":"Reloaded","path":"E:\\\\gitHub\\\\Reloaded","enabled":true}]}',
        encoding="utf-8",
    )
    (config_dir / "settings.json").write_text(
        '{"concurrent_limit":1,"command_timeout_seconds":30,"skip_uncommitted_changes":true,"skip_untracked_files":false,"log_retention_days":7}',
        encoding="utf-8",
    )
    answers = iter(["5", "3", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(
        _runtime(),
        silent=False,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
        config_dir=config_dir,
    )

    output = capsys.readouterr().out
    assert code == 0
    assert "配置已重新加载" in output
    assert "Reloaded: 已经是最新" in output


def test_run_menu_reload_config_shows_friendly_error(monkeypatch, tmp_path: Path, capsys):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "repositories.json").write_text("{bad json", encoding="utf-8")
    (config_dir / "settings.json").write_text("{}", encoding="utf-8")
    answers = iter(["5", "0"])
    monkeypatch.setattr("builtins.input", lambda _="": next(answers))

    code = run_menu(
        _runtime(),
        silent=False,
        checker=FakeChecker(),
        git_runner=FakeGitRunner(),
        config_dir=config_dir,
    )

    output = capsys.readouterr().out
    assert code == 0
    assert "重新加载配置失败" in output
