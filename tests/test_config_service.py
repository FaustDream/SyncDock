from pathlib import Path

from syncdock.config_service import load_runtime_config


def test_load_runtime_config_reads_repositories_and_settings(tmp_path: Path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "repositories.json").write_text(
        '{"repositories":[{"name":"SyncDock","path":"E:\\\\gitHub\\\\SyncDock","enabled":true}]}',
        encoding="utf-8",
    )
    (config_dir / "settings.json").write_text(
        '{"concurrent_limit":3,"command_timeout_seconds":120,"skip_uncommitted_changes":true,"skip_untracked_files":false,"log_retention_days":30}',
        encoding="utf-8",
    )

    runtime = load_runtime_config(config_dir)

    assert runtime.repositories[0].name == "SyncDock"
    assert runtime.settings.concurrent_limit == 3


def test_load_runtime_config_rejects_empty_repository_name(tmp_path: Path):
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    (config_dir / "repositories.json").write_text(
        '{"repositories":[{"name":"","path":"E:\\\\gitHub\\\\SyncDock","enabled":true}]}',
        encoding="utf-8",
    )
    (config_dir / "settings.json").write_text(
        '{"concurrent_limit":3,"command_timeout_seconds":120,"skip_uncommitted_changes":true,"skip_untracked_files":false,"log_retention_days":30}',
        encoding="utf-8",
    )

    try:
        load_runtime_config(config_dir)
    except ValueError as error:
        assert "Repository name cannot be empty" in str(error)
    else:
        raise AssertionError("Expected ValueError")
