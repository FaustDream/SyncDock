from syncdock import __version__


def test_package_exposes_version():
    assert __version__ == "4.0.0"
