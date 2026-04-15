from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path


@dataclass(slots=True)
class RepositoryConfig:
    name: str
    path: str
    enabled: bool


@dataclass(slots=True)
class SettingsConfig:
    concurrent_limit: int
    command_timeout_seconds: int
    skip_uncommitted_changes: bool
    skip_untracked_files: bool
    log_retention_days: int


@dataclass(slots=True)
class RuntimeConfig:
    repositories: list[RepositoryConfig]
    settings: SettingsConfig


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_runtime_config(config_dir: Path) -> RuntimeConfig:
    repositories_raw = _read_json(config_dir / "repositories.json")
    settings_raw = _read_json(config_dir / "settings.json")

    repositories: list[RepositoryConfig] = []
    for item in repositories_raw.get("repositories", []):
        name = item["name"].strip()
        path = item["path"].strip()
        if not name:
            raise ValueError("Repository name cannot be empty")
        if not path:
            raise ValueError(f"Repository path cannot be empty: {item!r}")
        repositories.append(
            RepositoryConfig(
                name=name,
                path=path,
                enabled=bool(item.get("enabled", True)),
            )
        )

    if not repositories:
        raise ValueError("At least one repository must be configured")

    settings = SettingsConfig(
        concurrent_limit=max(1, int(settings_raw["concurrent_limit"])),
        command_timeout_seconds=max(10, int(settings_raw["command_timeout_seconds"])),
        skip_uncommitted_changes=bool(settings_raw["skip_uncommitted_changes"]),
        skip_untracked_files=bool(settings_raw["skip_untracked_files"]),
        log_retention_days=max(1, int(settings_raw["log_retention_days"])),
    )
    return RuntimeConfig(repositories=repositories, settings=settings)
