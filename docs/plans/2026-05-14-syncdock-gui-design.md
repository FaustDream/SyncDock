# SyncDock 5.0 界面化设计文档

> 将 cmd 命令行工具改造为本地 Web 图形界面，核心同步逻辑不变。

## 一、背景与目标

### 1.1 现状

SyncDock 5.0 是一个多仓库 Git 同步管理工具，当前通过 cmd 窗口运行，使用数字菜单交互：

```
SyncDock 5.0

1. 同步全部仓库
2. 同步指定仓库（可多选）
3. 查看仓库状态
4. 查看最近失败原因
5. 仅同步需要同步的仓库
6. 重试最近失败仓库
7. 查看最近 N 次日志
8. 重新加载配置
9. 强制同步指定仓库（可多选）
0. 退出
```

配置文件为 JSON 格式，手动编辑：

- `config/repositories.json` — 仓库列表（名称、路径、启用、author_type）
- `config/settings.json` — 全局设置（并发数、超时、跳过规则等）

### 1.2 改造目标

| 维度   | 说明                                                              |
| ---- | --------------------------------------------------------------- |
| 核心逻辑 | 不变 — `sync_engine.py`、`repo_checker.py`、`config_service.py` 零修改 |
| 交互方式 | cmd 菜单 → 本地 Web 界面（浏览器打开 localhost）                             |
| 配置管理 | 手动编辑 JSON → 界面表格直接编辑                                            |
| 参数清理 | `author_type` 模糊命名 → 合并为「同步策略」清晰语义                              |
| 稳定性  | SSE 异步推送 + 后台线程池，确保同步时界面不卡死                                     |

---

## 二、技术选型

| 层    | 选择                       | 理由                                            |
| ---- | ------------------------ | --------------------------------------------- |
| 后端框架 | FastAPI                  | 原生 async 支持、SSE 流式响应、自动 OpenAPI               |
| 前端   | 单页 HTML（内联 CSS/JS）       | 自包含、零 CDN 依赖、启动即用                             |
| 实时推送 | SSE (Server-Sent Events) | 单向推送（后端→前端），轻量高效，FastAPI 原生 StreamingResponse |
| 同步执行 | 后台线程池                    | 不阻塞 FastAPI 事件循环和 HTTP 请求                     |
| 启动方式 | `run-gui.bat`            | 启动 FastAPI 服务器，自动打开浏览器                        |

### 2.1 SSE 不卡死架构

```
浏览器                          FastAPI                         核心模块
  │                              │                              │
  │  点击「同步全部」              │                              │
  │ ── POST /api/sync/start ───► │                              │
  │ ◄── { session_id } ───────── │                              │
  │                              │  后台线程启动                 │
  │                              │ ── 调用 sync_all_ ──────────►│
  │                              │    repositories()             │
  │                              │    + progress_callback        │
  │  EventSource 连接 SSE         │                              │
  │ ── GET /api/sync/events ───► │                              │
  │                              │  每个仓库完成                 │
  │ ◄── SSE: {name, status} ──── │ ◄── callback ─────────────── │
  │  实时更新进度条/日志          │                              │
  │                              │  全部完成                     │
  │ ◄── SSE: {done: true} ───── │                              │
  │  连接自动关闭                 │                              │
```

**关键设计**：

- POST 触发同步后 **立即返回 session_id**（~5ms），不阻塞
- 前端通过 `EventSource` 接收 SSE 流，消息即到即渲染
- 同步在单独的后台线程中运行，与 FastAPI 事件循环隔离
- 利用 `sync_engine.py` 已有的 `progress_callback` 参数，推送到 SSE 队列

---

## 三、项目结构

```
D:\gitHub\SyncDock\
├── syncdock/
│   ├── __init__.py
│   ├── main.py              # CLI 入口（保留不变）
│   ├── menu.py               # CLI 菜单（保留不变）
│   ├── sync_engine.py        # 同步核心（不变）
│   ├── repo_checker.py        # 仓库检查（不变）
│   ├── config_service.py     # 配置管理（不变）
│   ├── log_service.py        # 日志服务（不变）
│   ├── progress.py           # 进度条（不变）
│   ├── advice_service.py     # 建议服务（不变）
│   └── gui/                  # [新增] GUI 包
│       ├── __init__.py
│       ├── server.py         # FastAPI 应用 + 路由定义
│       ├── sse_manager.py    # SSE 事件流管理
│       └── static/
│           └── index.html    # 单文件前端（内联 CSS/JS）
├── config/
│   ├── repositories.json     # 仓库配置（格式微调）
│   └── settings.json         # 全局设置（不变）
├── run-sync.bat              # CLI 启动（不变）
├── run-gui.bat               # [新增] GUI 启动批处理
└── docs/plans/
    └── 2026-05-14-syncdock-gui-design.md  # 本文档
```

**设计原则**：不修改任何现有 `.py` 文件，GUI 层独立于 `gui/` 包内，通过 import 直接复用核心模块。

---

## 四、前端界面布局

### 4.1 整体布局

```
┌────────────────────────────────────────────────────────────┐
│  [SD] SyncDock 5.0    仓库同步管理         [重新加载] [设置]│  ← 顶栏
├────────────────────────────────────────────────────────────┤
│  [同步全部] [仅需同步] [重试失败] [同步选中] [强制同步选中] [+添加]│  ← 操作栏
├────────────────────────────────────────────────────────────┤
│   ☐  #  仓库名称         状态          启用  同步策略      │
│  ────────────────────────────────────────────────────────── │
│   ☐  1  SyncDock        ✓ 已经是最新   ■   安全同步        │  ← 仓库表格
│   ☐  2  awesome-design  ⚡需要同步     ■   强制同步        │
│   ☐  3  GoldView        ✗ 同步失败     ■   安全同步        │
│   ☐  4  DeepFocus       ⏸已跳过       ■   安全同步        │
│   ☐  5  RuoYi           未启用         □   安全同步        │
├────────────────────────────────────────────────────────────┤
│  同步进度 [████████░░░░░░░░░░] 4/12                         │  ← 进度条
├───────────────────────┬────────────────────────────────────┤
│  失败记录              │  同步日志          显示最近 [5次▾]  │  ← 双栏日志
│  GoldView: 同步失败... │  [09:50] SyncDock: 已拉取...      │
│                       │  [09:50] GoldView: 同步失败...     │
│                       │  [09:49] DeepFocus: 已经是最新     │
└───────────────────────┴────────────────────────────────────┘
```

### 4.2 设计风格

- **白底黑字**，极简 Flat 设计
- 无渐变、无阴影、无蓝色主色调
- 0.5px 细边框分割区域
- 等宽字体（`monospace`）显示路径和日志
- 状态标签用颜色区分：绿=成功、琥珀=警告、红=失败、灰=跳过

---

## 五、功能详细说明

### 5.1 仓库配置表格（核心模块）

仓库信息以表格行呈现，每个参数可直接在界面编辑，编辑后点击「保存修改」写回 `repositories.json`。

| 表头      | 对应字段          | 编辑方式     | 说明                                        |
| ------- | ------------- | -------- | ----------------------------------------- |
| ☐ (复选框) | —             | 点击勾选/取消  | 用于多选仓库执行「同步选中」或「强制同步选中」                   |
| #       | —             | —        | 自动序号，不可编辑                                 |
| 仓库名称    | `name`        | 点击文本直接编辑 | 仓库标识名                                     |
| 状态      | —             | 自动显示（只读） | 通过 `repo_checker.inspect()` 获取的实时状态，带颜色标签 |
| 启用      | `enabled`     | 复选框切换    | 灰色行 = 未启用，不参与同步操作                         |
| 同步策略    | `sync_policy` | 下拉选择     | 「安全同步」或「强制同步」（见 5.2 参数清理）                 |

**状态标签色值规范**：

| 状态    | 背景色       | 文字色       | 含义                 |
| ----- | --------- | --------- | ------------------ |
| 已经是最新 | `#EAF3DE` | `#3B6D11` | 本地与远端一致            |
| 需要同步  | `#FAEEDA` | `#854F0B` | 远端有更新，需要 pull      |
| 同步失败  | `#FCEBEB` | `#A32D2D` | Git 命令执行出错         |
| 已跳过   | `#F1EFE8` | `#5F5E5A` | 有未提交修改/未跟踪文件/分支分叉等 |
| 未启用   | `#F1EFE8` | `#888780` | enabled=false      |

### 5.2 参数清理：author_type → sync_policy

**现状问题**：

`repositories.json` 中现有字段 `author_type: "self" / "other"`：

- 命名与语义不匹配——它实际控制的是**同步策略**而非作者类型
- `self` → 安全同步（`git pull --ff-only`，保留本地修改）
- `other` → 强制同步（`git reset --hard` + `git clean -fd`，覆盖本地）

**界面化后**：

- 界面显示为「同步策略」，选项：「安全同步」/「强制同步」
- 后端 JSON 存储字段改为 `sync_policy: "safe" / "force"`
- 代码层 `RepositoryConfig.uses_force_sync` property 保持不变以兼容现有 CLI
- 加载配置时自动兼容旧的 `author_type` 字段

**映射关系**：

| 旧值 (author_type)    | 新值 (sync_policy) | 界面显示 | 实际行为                                 |
| ------------------- | ---------------- | ---- | ------------------------------------ |
| `"self"` / `true`   | `"safe"`         | 安全同步 | `git pull --ff-only`                 |
| `"other"` / `false` | `"force"`        | 强制同步 | `git reset --hard` + `git clean -fd` |

### 5.3 操作栏按钮

#### 按钮 1：同步全部（对应 CLI 功能 1）

- **触发**：点击「同步全部」黑色实心按钮
- **行为**：遍历所有已启用仓库，依次执行 fetch → pull/reset
- **后端**：调用 `sync_all_repositories()`，即使仓库已 up to date 也执行
- **进度**：SSE 推送每个仓库的完成事件，进度条从 0/N 走到 N/N
- **安全措施**：同步中按钮变为「同步中…」禁用态，防止重复触发

#### 按钮 2：仅需同步（对应 CLI 功能 5）

- **触发**：点击「仅需同步」
- **行为**：先逐个检查仓库远端状态（`fetch --all --prune` + 对比 ahead/behind），只 pull 远端有更新的仓库
- **后端**：调用 `_collect_repositories_needing_sync()` + `sync_repository_by_policy()`
- **进度**：同「同步全部」，但跳过无需同步的仓库

#### 按钮 3：重试失败（对应 CLI 功能 6）

- **触发**：点击「重试失败」
- **行为**：读取最后一次日志中的失败仓库列表，只对这些仓库执行同步
- **后端**：调用 `list_latest_failed_repositories()` + `_collect_retry_repositories()` + `sync_repository_by_policy()`
- **状态**：如果最近无失败仓库，弹出提示「最近一次同步没有失败仓库」

#### 按钮 4：同步选中（对应 CLI 功能 2）

- **触发**：在仓库表格勾选复选框 → 点击「同步选中」
- **行为**：对选中的仓库执行常规同步（按各自策略：安全或强制）
- **可视化**：未勾选任何仓库时按钮灰色半透明（禁用态），勾选后变亮
- **后端**：调用 `sync_repository_by_policy()` 逐个同步选中的仓库

#### 按钮 5：强制同步选中（对应 CLI 功能 9）

- **触发**：在仓库表格勾选复选框 → 点击「强制同步选中」
- **行为**：对选中的仓库**强制**同步（无视仓库自身的同步策略设置）
- **后端**：调用 `force_sync_single_repository()`
- **风险提示**：首次点击时弹出确认对话框：「强制同步将覆盖本地所有未推送的修改，确认继续？」

#### 按钮 6：添加仓库

- **触发**：点击「+ 添加仓库」
- **行为**：在表格末尾新增一空白行，可编辑名称、路径、同步策略
- **存储**：点击「保存修改」后写入 `repositories.json`

### 5.4 顶栏配置操作

#### 重新加载配置（对应 CLI 功能 8）

- **触发**：点击顶栏「重新加载」按钮
- **行为**：重新读取 `config/repositories.json` 和 `config/settings.json`，刷新表格和设置
- **后端**：调用 `load_runtime_config()`
- **反馈**：加载完成后显示「配置已重新加载」短暂提示

#### 设置面板（新增，对应 settings.json）

- **触发**：点击顶栏「设置」按钮
- **内容**：弹出面板编辑以下参数：

| 参数                         | 类型   | 界面组件  | 默认值   | 说明                  |
| -------------------------- | ---- | ----- | ----- | ------------------- |
| `concurrent_limit`         | int  | 数字输入框 | 3     | 并发同步数，最小 1          |
| `command_timeout_seconds`  | int  | 数字输入框 | 120   | 每次 git 命令超时秒数，最小 10 |
| `skip_uncommitted_changes` | bool | 开关切换  | true  | 有未提交修改时跳过           |
| `skip_untracked_files`     | bool | 开关切换  | false | 有未跟踪文件时跳过           |
| `log_retention_days`       | int  | 数字输入框 | 30    | 日志保留天数，最小 1         |

- **存储**：点击「保存」写回 `config/settings.json`

### 5.5 日志面板

#### 失败记录（对应 CLI 功能 4）

- **位置**：底部左栏
- **内容**：自动显示最近一次同步的失败仓库列表，每条附带建议
- **数据来源**：`list_latest_failed_repositories()` + `append_sync_suggestion()`
- **显示格式**：
  
  ```
  GoldView: 同步失败，Git 命令执行失败；建议：检查远端配置或手动执行 Git 命令确认原因
  ```
- **空状态**：「最近一次同步没有失败仓库」（灰色文字）

#### 同步日志（对应 CLI 功能 7）

- **位置**：底部右栏
- **内容**：显示最近 N 次同步日志的失败记录摘要
- **条数选择**：下拉菜单（1 / 5 / 10 / 20 次）
- **数据来源**：`read_recent_logs(log_dir, limit)`
- **日志格式**：
  
  ```
  [09:50] SyncDock: 已拉取远端最新代码
  [09:50] GoldView: 同步失败，Git 命令执行失败
  ```

#### 同步进度条

- **位置**：底部日志上方
- **显示**：灰色细进度条 + 当前进度文字（如 `4/12`）
- **说明文字**：上一个完成的仓库名（如「已完成：GoldView」）
- **行为**：同步结束时进度条填满，1 秒后自动隐藏

---

## 六、API 接口设计

| 方法   | 路径                              | 说明       | 请求体              | 响应                        |
| ---- | ------------------------------- | -------- | ---------------- | ------------------------- |
| GET  | `/`                             | 返回前端首页   | —                | index.html                |
| POST | `/api/sync/start`               | 触发同步任务   | `{"mode":"all"}` | `{"session_id":"..."}`    |
| GET  | `/api/sync/events/{session_id}` | SSE 进度流  | —                | `text/event-stream`       |
| GET  | `/api/repositories`             | 获取仓库列表   | —                | `{"repositories": [...]}` |
| PUT  | `/api/repositories`             | 保存仓库配置   | 完整仓库数组           | `{"ok": true}`            |
| GET  | `/api/status`                   | 刷新所有仓库状态 | —                | `{"rows": [...]}`         |
| GET  | `/api/settings`                 | 获取设置     | —                | settings.json 内容          |
| PUT  | `/api/settings`                 | 保存设置     | 设置对象             | `{"ok": true}`            |
| GET  | `/api/logs/failed`              | 最近失败记录   | —                | `{"entries": [...]}`      |
| GET  | `/api/logs/recent`              | 最近 N 次日志 | `?limit=5`       | `{"logs": [...]}`         |
| POST | `/api/config/reload`            | 重新加载配置   | —                | `{"ok": true}`            |

### 6.1 SSE 事件格式

```
event: progress
data: {"name":"SyncDock","outcome":"UPDATED","message":"已拉取远端最新代码","progress":"3/12","total":12}

event: progress
data: {"name":"GoldView","outcome":"FAILED","message":"同步失败，Git 命令执行失败","progress":"4/12","total":12}

event: complete
data: {"summary":{"total":12,"updated":5,"up_to_date":4,"skipped":1,"failed":2,"invalid":0}}
```

### 6.2 sync 模式参数

`POST /api/sync/start` 的 `mode` 字段：

| mode               | 对应按钮   | 行为                          |
| ------------------ | ------ | --------------------------- |
| `"all"`            | 同步全部   | 全部已启用仓库同步                   |
| `"needed"`         | 仅需同步   | 只同步远端有更新的仓库                 |
| `"retry"`          | 重试失败   | 重试最近失败的仓库                   |
| `"selected"`       | 同步选中   | 同步指定仓库（需传 `names: [...]`）   |
| `"force_selected"` | 强制同步选中 | 强制同步指定仓库（需传 `names: [...]`） |

---

## 七、SSE 事件管理器设计

### 7.1 核心类

```python
# gui/sse_manager.py

class SSEManager:
    """管理多个同步 session 的 SSE 事件队列"""

    def create_session(self) -> str:
        """创建新的同步 session，返回 session_id"""

    def get_queue(self, session_id: str) -> asyncio.Queue | None:
        """获取指定 session 的事件队列"""

    def make_callback(self, session_id: str, total: int):
        """生成 progress_callback，推送事件到 SSE 队列"""

    def cleanup(self, session_id: str):
        """同步完成后清理 session"""

    def remove_stale_sessions(self):
        """清理超时的僵尸 session"""


# gui/server.py (关键路由)

@router.post("/api/sync/start")
async def start_sync(payload: SyncRequest):
    session_id = sse_manager.create_session()
    runtime = load_runtime_config(config_dir)

    # 在后台线程运行同步
    def run_sync():
        callback = sse_manager.make_callback(session_id, len(enabled_repos))
        results = sync_all_repositories(
            runtime.repositories, runtime.settings,
            checker=checker, git_runner=git_runner,
            progress_callback=callback,
        )
        # 推送完成事件
        queue = sse_manager.get_queue(session_id)
        queue.put_nowait({
            "event": "complete",
            "summary": summarize_results(results)
        })

    thread = Thread(target=run_sync, daemon=True)
    thread.start()
    return {"session_id": session_id}


@router.get("/api/sync/events/{session_id}")
async def stream_events(session_id: str):
    queue = sse_manager.get_queue(session_id)
    async def event_generator():
        while True:
            event = await queue.get()
            if event.get("event") == "complete":
                yield f"event: complete\ndata: {json.dumps(event)}\n\n"
                break
            yield f"event: progress\ndata: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

---

## 八、同步状态对照表

`repo_checker.inspect()` 返回的所有状态码及其界面展示：

| status_code             | 状态标签              | 颜色  | 含义             | 可同步？        |
| ----------------------- | ----------------- | --- | -------------- | ----------- |
| `up_to_date`            | 已经是最新             | 绿   | 本地与远端代码一致      | 否           |
| `needs_sync`            | 需要同步              | 琥珀  | 远端有未拉取提交       | 是           |
| `needs_force_sync`      | 需要强制同步            | 琥珀  | 使用强制同步策略的仓库需同步 | 是（强制）       |
| `ahead_only`            | 本地领先远端            | 灰   | 有未推送的本地提交      | 否           |
| `local_changes`         | 已跳过(有未提交修改)       | 灰   | 有未提交的本地修改      | 否（除非强制同步策略） |
| `untracked_files`       | 已跳过(有未跟踪文件)       | 灰   | 有未跟踪的文件        | 否（除非强制同步策略） |
| `diverged`              | 已跳过(分支已分叉)        | 灰   | 本地和远端分支分叉      | 否           |
| `no_upstream`           | 已跳过(未设置 upstream) | 灰   | 当前分支没有远端跟踪     | 否           |
| `detached_head`         | 已跳过(HEAD 分离)      | 灰   | 不在分支上          | 否           |
| `invalid_path`          | 路径无效              | 红   | 仓库路径不存在        | 否           |
| `not_git_repository`    | 不是 Git 仓库         | 红   | 路径不是 Git 仓库    | 否           |
| `remote_refresh_failed` | 查询远端失败            | 红   | git fetch 失败   | 否           |

---

## 九、错误处理

### 9.1 同步中的错误

- 单个仓库失败不影响其他仓库同步
- SSE 流中推送失败事件，前端在日志面板红色显示
- 同步完成后前端显示汇总统计（总仓库数 / 成功 / 失败 / 跳过）

### 9.2 网络断开

- 如果浏览器关闭或网络断开，SSE 连接自动断开
- 后台同步线程检测到 SSE 队列溢出时自动停止
- 重新打开页面后通过「重新加载配置」恢复状态

### 9.3 配置错误

- 后端 JSON 解析失败时返回 HTTP 400 + 错误详情
- 前端显示错误提示，不覆盖当前界面数据
- 配置字段校验（名称非空、路径非空等）前后端双重检查

---

## 十、启动方式

### 10.1 run-gui.bat

```batch
@echo off
setlocal
cd /d "%~dp0"
echo Starting SyncDock GUI...
echo Open http://localhost:8866 in your browser
py -3 -m uvicorn syncdock.gui.server:app --host 127.0.0.1 --port 8866
endlocal
```

### 10.2 依赖

新增依赖（加入 `requirements.txt`）：

```
fastapi>=0.110,<1.0
uvicorn>=0.29,<1.0
```

---

## 十一、实施计划

| 阶段            | 内容                                                   | 预计文件     |
| ------------- | ---------------------------------------------------- | -------- |
| 1. 基础设施       | 创建 gui/ 包，安装 FastAPI/uvicorn，编写 run-gui.bat          | 4 个文件    |
| 2. SSE 管理器    | 实现 `sse_manager.py` 事件队列                             | 1 个文件    |
| 3. FastAPI 路由 | 实现 `server.py` 所有 API 端点                             | 1 个文件    |
| 4. 前端页面       | 实现 `index.html` 完整界面                                 | 1 个文件    |
| 5. 参数兼容       | 在 `config_service.py` 中兼容旧 author_type→新 sync_policy | 修改 1 个文件 |
| 6. 测试验证       | 运行测试，修复问题                                            | —        |
