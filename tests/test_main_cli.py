from syncdock.main import parse_args


def test_parse_args_supports_silent_flag():
    args = parse_args(["--silent"])

    assert args.silent is True
