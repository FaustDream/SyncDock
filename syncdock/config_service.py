from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from syncdock.progress import create_progress_bar


DEFAULT_SETTINGS = {
    "concurrent_limit": 3,
    "command_timeout_seconds": 120,
    "skip_uncommitted_changes": True,
    "skip_untracked_files": False,
    "log_retention_days": 30,
}


@dataclass(slots=True)
class RepositoryConfig:
    name: str
    path: str
    enabled: bool
    author_type: bool = True

    @property
    def uses_force_sync(self) -> bool:
        return not self.author_type


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


def _write_json(path: Path, content: dict) -> None:
    path.write_text(json.dumps(content, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _build_default_repositories(config_dir: Path) -> dict:
    project_root = config_dir.resolve().parent
    repository_name = project_root.name or "SyncDock"
    return {
        "repositories": [
            {
                "name": repository_name,
                "path": str(project_root),
                "enabled": True,
                "author_type": True,
            }
        ]
    }


def _ensure_default_config(config_dir: Path, *, progress_factory=create_progress_bar) -> None:
    repositories_path = config_dir / "repositories.json"
    settings_path = config_dir / "settings.json"

    pending_steps: list[tuple[str, Path]] = []
    if not config_dir.exists():
        pending_steps.append(("config_dir", config_dir))
    if not repositories_path.exists():
        pending_steps.append(("repositories", repositories_path))
    if not settings_path.exists():
        pending_steps.append(("settings", settings_path))

    if not pending_steps:
        return

    progress = progress_factory("首次初始化配置", len(pending_steps))
    for step_kind, target in pending_steps:
        if step_kind == "config_dir":
            config_dir.mkdir(parents=True, exist_ok=True)
            progress.advance(f"已创建目录：{target.name}")
            continue
        if step_kind == "repositories":
            config_dir.mkdir(parents=True, exist_ok=True)
            _write_json(target, _build_default_repositories(config_dir))
            progress.advance(f"已创建默认文件：{target.name}")
            continue

        config_dir.mkdir(parents=True, exist_ok=True)
        _write_json(target, DEFAULT_SETTINGS)
        progress.advance(f"已创建默认文件：{target.name}")


def load_runtime_config(config_dir: Path, *, progress_factory=create_progress_bar) -> RuntimeConfig:
    _ensure_default_config(config_dir, progress_factory=progress_factory)
    repositories_raw = _read_json(config_dir / "repositories.json")
    settings_raw = _read_json(config_dir / "settings.json")

    repositories: list[RepositoryConfig] = []
    for item in repositories_raw.get("repositories", []):
        name = item["name"].strip()
        path = item["path"].strip()
        raw_author_type = item.get("author_type", True)
        if isinstance(raw_author_type, bool):
            author_type = raw_author_type
        elif str(raw_author_type).strip().lower() == "self":
            author_type = True
        elif str(raw_author_type).strip().lower() == "other":
            author_type = False
        else:
            raise ValueError(f"author_type 只能是 true/false 或 \"self\"/\"other\"：{item!r}")
        if not name:
            raise ValueError("仓库名称不能为空")
        if not path:
            raise ValueError(f"仓库路径不能为空：{item!r}")
        repositories.append(
            RepositoryConfig(
                name=name,
                path=path,
                enabled=bool(item.get("enabled", True)),
                author_type=author_type,
            )
        )

    if not repositories:
        raise ValueError("至少需要配置一个仓库")

    settings = SettingsConfig(
        concurrent_limit=max(1, int(settings_raw["concurrent_limit"])),
        command_timeout_seconds=max(10, int(settings_raw["command_timeout_seconds"])),
        skip_uncommitted_changes=bool(settings_raw["skip_uncommitted_changes"]),
        skip_untracked_files=bool(settings_raw["skip_untracked_files"]),
        log_retention_days=max(1, int(settings_raw["log_retention_days"])),
    )
    return RuntimeConfig(repositories=repositories, settings=settings)
