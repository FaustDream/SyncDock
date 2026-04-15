from syncdock.repo_checker import parse_status_lines


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
