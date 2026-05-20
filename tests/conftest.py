"""pytest 共享 fixture。"""

import pytest

from syncdock.config_service import RepositoryConfig, SettingsConfig


@pytest.fixture
def settings():
    """返回默认的 SettingsConfig 实例，所有测试使用相同默认值。"""
    return SettingsConfig(
        concurrent_limit=3,
        command_timeout_seconds=120,
        skip_uncommitted_changes=True,
        skip_untracked_files=False,
        log_retention_days=30,
        proxy_port=28203,
    )


@pytest.fixture
def sample_repos():
    """返回 4 个启用的测试仓库，名称有序便于断言保序行为。
    author_type=True 对应安全同步，False 对应强制同步。
    """
    return [
        RepositoryConfig(name="alpha", path="/tmp/alpha", enabled=True, author_type=True),
        RepositoryConfig(name="beta", path="/tmp/beta", enabled=True, author_type=False),
        RepositoryConfig(name="gamma", path="/tmp/gamma", enabled=True, author_type=True),
        RepositoryConfig(name="delta", path="/tmp/delta", enabled=True, author_type=True),
    ]


@pytest.fixture
def mixed_repos():
    """返回含禁用仓库的混合列表。"""
    return [
        RepositoryConfig(name="alice", path="/tmp/alice", enabled=True, author_type=True),
        RepositoryConfig(name="bob", path="/tmp/bob", enabled=False, author_type=True),
        RepositoryConfig(name="carol", path="/tmp/carol", enabled=True, author_type=False),
    ]
