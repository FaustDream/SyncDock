from syncdock.main import main, parse_args


def test_parse_args_supports_silent_flag():
    args = parse_args(["--silent"])

    assert args.silent is True


def test_main_returns_nonzero_when_config_load_fails(monkeypatch, capsys):
    def _raise(_path):
        raise ValueError("broken config")

    monkeypatch.setattr("syncdock.main.load_runtime_config", _raise)

    code = main([])

    output = capsys.readouterr().out
    assert code == 1
    assert "配置加载失败" in output
