from __future__ import annotations

import json

from syncdock.config_service import load_runtime_config


class FakeProgress:
    def __init__(self, title: str, total: int) -> None:
        self.title = title
        self.total = total
        self.details: list[str] = []

    def advance(self, detail: str = "") -> None:
        self.details.append(detail)


def build_progress_factory(created: list[FakeProgress]):
    def factory(title: str, total: int) -> FakeProgress:
        progress = FakeProgress(title, total)
        created.append(progress)
        return progress

    return factory


def test_load_runtime_config_creates_missing_default_files(tmp_path) -> None:
    created: list[FakeProgress] = []

    runtime = load_runtime_config(tmp_path / "config", progress_factory=build_progress_factory(created))

    repositories_path = tmp_path / "config" / "repositories.json"
    settings_path = tmp_path / "config" / "settings.json"

    assert repositories_path.exists()
    assert settings_path.exists()
    assert runtime.repositories[0].name == tmp_path.name
    assert runtime.repositories[0].path == str(tmp_path.resolve())
    assert runtime.repositories[0].enabled is True
    assert runtime.settings.concurrent_limit == 3
    assert created[0].title == "首次初始化配置"
    assert created[0].total == 3
    assert "config" in created[0].details[0]
    assert "repositories.json" in created[0].details[1]
    assert "settings.json" in created[0].details[2]


def test_load_runtime_config_keeps_existing_files(tmp_path) -> None:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    repositories_path = config_dir / "repositories.json"
    settings_path = config_dir / "settings.json"

    repositories_path.write_text(
        json.dumps(
            {
                "repositories": [
                    {
                        "name": "现有仓库",
                        "path": "D:\\gitHub\\existing",
                        "enabled": False,
                    }
                ]
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    settings_path.write_text(
        json.dumps(
            {
                "concurrent_limit": 5,
                "command_timeout_seconds": 240,
                "skip_uncommitted_changes": False,
                "skip_untracked_files": True,
                "log_retention_days": 7,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    created: list[FakeProgress] = []
    runtime = load_runtime_config(config_dir, progress_factory=build_progress_factory(created))

    assert runtime.repositories[0].name == "现有仓库"
    assert runtime.repositories[0].path == "D:\\gitHub\\existing"
    assert runtime.repositories[0].enabled is False
    assert runtime.settings.concurrent_limit == 5
    assert runtime.settings.command_timeout_seconds == 240
    assert runtime.settings.skip_uncommitted_changes is False
    assert runtime.settings.skip_untracked_files is True
    assert runtime.settings.log_retention_days == 7
    assert created == []
