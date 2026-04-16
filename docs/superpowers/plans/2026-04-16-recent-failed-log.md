# Recent Failed Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增“查看最近失败仓库”菜单项，直接展示最近一次同步中失败的仓库及原因。

**Architecture:** 保持现有日志写入格式不变，在日志模块新增最近失败仓库提取函数，再由菜单层新增入口调用。菜单、日志解析、测试各自负责单一职责，尽量缩小改动范围。

**Tech Stack:** Python 3、pytest、现有 CLI 菜单与日志模块

---

### Task 1: 日志失败项提取

**Files:**
- Modify: `syncdock/log_service.py`
- Test: `tests/test_log_service.py`

- [ ] **Step 1: Write the failing test**

```python
def test_read_latest_failed_log_returns_failed_repositories(tmp_path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "sync-1.log").write_text(
        "仓库A: 已经是最新\n仓库B: 同步失败，网络连接异常\n仓库C: 同步失败，没有权限访问仓库\n",
        encoding="utf-8",
    )

    result = read_latest_failed_log(log_dir)

    assert "仓库B: 同步失败，网络连接异常" in result
    assert "仓库C: 同步失败，没有权限访问仓库" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -3 -m pytest tests/test_log_service.py::test_read_latest_failed_log_returns_failed_repositories -q`
Expected: FAIL with missing function or assertion failure

- [ ] **Step 3: Write minimal implementation**

```python
def read_latest_failed_log(log_dir: Path) -> str:
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -3 -m pytest tests/test_log_service.py::test_read_latest_failed_log_returns_failed_repositories -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add syncdock/log_service.py tests/test_log_service.py
git commit -m "feat: add recent failed log summary"
```

### Task 2: 菜单入口接入

**Files:**
- Modify: `syncdock/menu.py`
- Test: `tests/test_menu.py`

- [ ] **Step 1: Write the failing test**

```python
def test_run_menu_shows_recent_failed_log(monkeypatch, capsys) -> None:
    runtime = build_runtime()
    inputs = iter(["5", "0"])

    monkeypatch.setattr("builtins.input", lambda prompt: next(inputs))
    monkeypatch.setattr("syncdock.menu.read_latest_failed_log", lambda log_dir: "最近日志：sync.log\n\n仓库B: 同步失败，网络连接异常")

    result = run_menu(runtime, silent=False, checker=object(), git_runner=object(), log_dir=Path("logs"))

    assert result == 0
    assert "仓库B: 同步失败，网络连接异常" in capsys.readouterr().out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `py -3 -m pytest tests/test_menu.py::test_run_menu_shows_recent_failed_log -q`
Expected: FAIL because the new menu option does not exist yet

- [ ] **Step 3: Write minimal implementation**

```python
def render_main_menu() -> str:
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `py -3 -m pytest tests/test_menu.py::test_run_menu_shows_recent_failed_log -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add syncdock/menu.py tests/test_menu.py
git commit -m "feat: add recent failed repositories menu"
```
