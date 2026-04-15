from pathlib import Path
import subprocess

from syncdock.repo_checker import RepositoryChecker, parse_status_lines


def test_parse_status_lines_detects_untracked_and_modified():
    status = parse_status_lines([" M README.md", "?? notes.txt"])

    assert status.has_uncommitted_changes is True
    assert status.has_untracked_files is True
    assert status.untracked_count == 1


def test_parse_status_lines_detects_clean_repo():
    status = parse_status_lines([])

    assert status.has_uncommitted_changes is False
    assert status.has_untracked_files is False
    assert status.untracked_count == 0


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _make_committed_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.name", "SyncDock Test")
    _git(repo, "config", "user.email", "syncdock@example.com")
    (repo / "README.md").write_text("hello\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "init")
    return repo


def test_repository_checker_marks_missing_path_invalid(tmp_path: Path):
    from syncdock.config_service import RepositoryConfig, SettingsConfig

    checker = RepositoryChecker()
    repository = RepositoryConfig(name="Missing", path=str(tmp_path / "missing"), enabled=True)
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=30,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    result = checker.inspect(repository, settings)

    assert result["kind"] == "invalid"
    assert result["message"] == "仓库无效，路径不存在"


def test_repository_checker_skips_repo_with_uncommitted_changes(tmp_path: Path):
    from syncdock.config_service import RepositoryConfig, SettingsConfig

    repo = _make_committed_repo(tmp_path)
    (repo / "README.md").write_text("changed\n", encoding="utf-8")

    checker = RepositoryChecker()
    repository = RepositoryConfig(name="DirtyRepo", path=str(repo), enabled=True)
    settings = SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=30,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
    )

    result = checker.inspect(repository, settings)

    assert result["kind"] == "skipped"
    assert result["message"] == "已跳过，有未提交修改"
