# SyncDock 代码逻辑、业务逻辑与功能模块说明

## 1. 项目定位

`SyncDock` 是面向 Windows 本地开发环境的多 Git 仓库同步工具，核心目标是在一个入口中批量检查、同步、强制同步多个本地仓库，并通过 CLI 菜单或 Web GUI 展示状态、进度和失败原因。

当前代码同时保留两条使用路径：

- CLI 路径：`python -m syncdock.main` 或 `run-sync.bat` 启动交互菜单。
- GUI 路径：`gui_launcher.py` 启动本地 `FastAPI + Uvicorn` 服务，并打开 `syncdock/gui/static/index.html`。

## 2. 总体运行链路

### 2.1 CLI 链路

1. `syncdock/main.py` 解析 `--silent` 参数。
2. `load_runtime_config()` 读取或初始化 `config/repositories.json` 与 `config/settings.json`。
3. `run_menu()` 根据用户选择执行同步、状态查询、日志查询或配置重载。
4. 同步类操作委托给 `syncdock/sync_engine.py`，状态检查委托给 `syncdock/repo_checker.py`。
5. 操作结果由 `syncdock/log_service.py` 写入 `logs/sync-*.log`。

### 2.2 GUI 链路

1. `gui_launcher.py` 清理本机 `8866` 端口占用，启动 `uvicorn syncdock.gui.server:app`。
2. `syncdock/gui/server.py` 提供静态页面、REST API、SSE 进度流。
3. 前端 `index.html` 通过 `fetch()` 调用 REST API，通过 `EventSource` 订阅同步进度。
4. 后端同步任务在后台线程中运行，内部仍复用 `sync_engine` 和 `repo_checker`。
5. 后台线程将每个仓库的结果写入 `SSEManager` 队列，由 `/api/sync/events/{session_id}` 推送给页面。

## 3. 核心业务对象

### 3.1 `RepositoryConfig`

位置：`syncdock/config_service.py`

字段：

- `name`：仓库显示名称。
- `path`：本地仓库路径。
- `enabled`：是否参与同步和状态查询。
- `author_type`：旧字段兼容用途，当前被 `uses_force_sync` 用于推导同步策略。
- `uses_force_sync`：当 `author_type=False` 时视为强制同步仓库。

配置文件中的 `sync_policy` 会在加载时转换为 `author_type`：

- `safe` → 安全同步。
- `force` → 强制同步。

### 3.2 `SettingsConfig`

位置：`syncdock/config_service.py`

字段：

- `concurrent_limit`：同步全部仓库时的并发线程数。
- `command_timeout_seconds`：单个 Git 命令超时时间。
- `skip_uncommitted_changes`：安全同步时是否跳过有未提交修改的仓库。
- `skip_untracked_files`：安全同步时是否跳过有未跟踪文件的仓库。
- `log_retention_days`：日志保留天数。
- `proxy_port`：Git HTTP/HTTPS 代理端口。

### 3.3 `SyncResult`

位置：`syncdock/sync_engine.py`

字段：

- `name`：仓库名。
- `outcome`：结果码，包含 `UPDATED`、`UP_TO_DATE`、`SKIPPED`、`FAILED`、`INVALID`。
- `message`：面向用户展示的中文结果说明。

## 4. 模块详细说明

### 4.1 配置模块：`syncdock/config_service.py`

职责：

- 初始化默认配置目录和配置文件。
- 读取 JSON 配置并转换为运行时 dataclass。
- 兼容旧字段 `author_type` 与新字段 `sync_policy`。
- 对关键设置做下限保护，例如 `concurrent_limit >= 1`、`command_timeout_seconds >= 10`。

业务规则：

- 如果配置目录或配置文件不存在，会自动创建默认配置。
- 至少必须配置一个仓库，否则抛出 `ValueError`。
- 无法识别的 `sync_policy` 默认按安全同步处理。

### 4.2 仓库检查模块：`syncdock/repo_checker.py`

职责：

- 判断路径是否存在、是否为 Git 仓库。
- 判断当前是否在正常分支上。
- 检查本地未提交修改和未跟踪文件。
- 检查 upstream 是否存在。
- 可选执行 `git fetch --all --prune` 刷新远端引用。
- 通过 `git rev-list --left-right --count HEAD...@{upstream}` 判断本地领先和远端领先数量。
- 将检查结果格式化为前端/CLI 可展示的状态详情。

主要状态：

- `invalid_path`：路径不存在。
- `not_git_repository`：不是 Git 仓库。
- `detached_head`：不在分支上。
- `local_changes`：存在未提交修改。
- `untracked_files`：存在未跟踪文件。
- `no_upstream`：未设置 upstream。
- `diverged`：本地和远端同时有不同提交。
- `ahead_only`：仅本地领先。
- `needs_sync`：远端领先，需要同步。
- `up_to_date`：已是最新。
- `remote_refresh_failed`：刷新远端引用失败。

### 4.3 同步引擎：`syncdock/sync_engine.py`

职责：

- 封装 Git 命令执行和错误归一化。
- 实现安全同步、强制同步和按策略同步。
- 对全部启用仓库执行线程池并发同步。
- 汇总同步结果。

安全同步流程：

1. `checker.inspect()` 做本地状态检查。
2. 执行 `git fetch --all --prune`。
3. 再次 `checker.inspect()`，基于最新远端引用判断是否需要拉取。
4. 如果仅本地领先或无需拉取，则跳过或返回最新。
5. 如远端领先，执行 `git pull --ff-only`。

强制同步流程：

1. 忽略未提交、未跟踪和分叉检查，执行基础有效性检查。
2. 执行 `git fetch --all --prune`。
3. 执行 `git reset --hard @{upstream}`。
4. 执行 `git clean -fd`。

并发模型：

- `sync_all_repositories()` 通过 `run_repositories_concurrently()` 使用线程池，实际 `max_workers` 会按 `min(settings.concurrent_limit, HARD_MAX_GIT_PROCESSES)` 钳制。
- 每个仓库作为一个 future 独立执行。
- `as_completed()` 按完成顺序回调进度，但最终结果按原仓库顺序归位。

### 4.4 CLI 菜单模块：`syncdock/menu.py`

职责：

- 渲染文本菜单。
- 解析用户菜单选择和多仓库选择。
- 串联同步、仅同步需要同步的仓库、重试失败仓库、状态查询、日志查询和配置重载。
- 使用 `ProgressBar` 展示 CLI 进度。

注意：

- `同步全部仓库` 会走 `sync_all_repositories()`，具备线程池并发。
- `同步指定仓库`、`强制同步指定仓库`、`仅同步需要同步的仓库`、`重试失败仓库` 当前在选定仓库阶段主要是串行同步。
- `查看仓库状态` 当前逐仓库串行执行状态刷新和检查。

### 4.5 日志模块：`syncdock/log_service.py`

职责：

- 渲染同步摘要。
- 写入每次同步日志。
- 清理过期日志。
- 读取最近一次失败仓库。
- 读取最近 N 次日志失败摘要。

日志命名：

- `sync-YYYYMMDD-HHMMSS-ffffff.log`

失败识别：

- 以结果行中 `同步失败` 前缀作为失败仓库判定依据。
- 对错误原因做归一化，去掉明显的 `fatal/error/traceback` 细节尾部。

### 4.6 建议模块：`syncdock/advice_service.py`

职责：

- 根据中文错误消息给出操作建议。
- 为日志失败摘要追加建议。

覆盖场景：

- 网络异常。
- 权限异常。
- 分支分叉。
- 未设置 upstream。
- detached HEAD。
- 本地修改或未跟踪文件。
- 路径无效或非 Git 仓库。
- Git 超时。

### 4.7 GUI 服务模块：`syncdock/gui/server.py`

职责：

- 提供首页静态文件。
- 管理仓库配置和设置配置。
- 启动后台同步任务。
- 提供 SSE 同步进度流。
- 查询状态、失败日志、最近日志。
- 提供关闭本地服务接口。

主要 API：

- `GET /`：返回 `index.html`。
- `POST /api/sync/start`：启动同步任务。
- `GET /api/sync/events/{session_id}`：订阅同步进度。
- `GET /api/repositories`：读取仓库配置。
- `PUT /api/repositories`：保存仓库配置。
- `GET /api/status`：返回状态快照。
- `GET /api/status/snapshot`：快速读取缓存状态，不触发远端 fetch。
- `POST /api/status/refresh`：启动后台状态刷新任务。
- `GET /api/status/events/{session_id}`：订阅状态刷新进度。
- `POST /api/status/refresh/cancel`：取消当前后台状态刷新任务。
- `POST /api/sync/cancel/{session_id}`：取消指定同步任务。
- `GET /api/settings`：读取设置。
- `PUT /api/settings`：保存设置。
- `GET /api/logs/failed`：读取最近失败仓库。
- `GET /api/logs/recent`：读取最近 N 次日志。
- `POST /api/config/reload`：重载配置。
- `POST /api/shutdown`：关闭本地服务。

当前状态策略：

- 首屏先读取 `/api/status/snapshot`，优先命中内存缓存或占位状态，避免等待全部远端 Git 查询。
- 后台通过 `/api/status/refresh` 和 `/api/status/events/{session_id}` 逐仓库推送刷新结果。
- 状态刷新和同步结果都会写回缓存，减少后续重复 fetch。
- 当已有状态刷新任务运行时，重复刷新请求会复用已有 `session_id`，形成轻量背压。
- **全局互斥**：同步任务正在运行时，状态刷新自动降级为缓存读取（不执行远端 Git fetch），前端提示"状态为缓存快照（同步进行中）"。

### 4.8 状态缓存模块：`syncdock/status_cache.py`

职责：

- 线程安全的内存状态缓存，以仓库名称为主线索引。
- 支持 TTL（默认 60 秒），过期后仍可获取原始数据但标记为 stale。
- `snapshot()` 为前端首屏生成快照，命中缓存返回缓存数据，未命中降级为占位状态。
- `build_from_sync_result()` 将同步结果转换为可缓存的状态行，减少重复远端查询。
- `trim()` 在仓库配置变更后清理已删除仓库的缓存。
- 已从 `server.py` 中拆出独立模块，便于单元测试。

### 4.9 SSE 管理模块：`syncdock/gui/sse_manager.py`

职责：

- 创建同步 session。
- 为每个 session 维护线程安全队列。
- 生成同步进度 callback（支持 `phase` 关键字参数）。
- 支持 session 取消标记（`cancel_session` / `is_cancelled`）。
- 推送完成事件。
- 清理 session（同时清除取消标记）。

事件类型：

- `progress`：包含仓库名、结果、消息、当前进度、总数，可选 `phase` 字段。
- `complete`：包含汇总结果（支持 `cancelled` 标记）。

### 4.10 前端页面：`syncdock/gui/static/index.html`

职责：

- 展示仓库列表、状态徽标、同步策略和启用状态。
- 支持新增、编辑、删除仓库配置。
- 支持同步全部、仅需同步、重试失败、同步选中、强制同步选中。
- 展示同步进度条和实时日志。
- 查询最近失败和最近日志。

前端数据流：

1. `loadAll()` 并发请求仓库、状态快照、失败日志和最近日志。
2. `refreshStatuses()` 触发后台状态刷新，并通过 `connectStatusSSE()` 接收逐仓库更新。
3. `renderTable()` 根据状态优先级排序并渲染表格。
4. 用户点击同步按钮后，`startSync()` 创建同步 session。
5. `connectSSE()` 订阅进度并逐条更新状态列；`needed` 模式事件包含 `phase=scanning/syncing` 字段，前端据此显示"扫描中"或"同步中"。
6. 完成后仅刷新最近日志，并补一次后台状态刷新，不再立即全量重查。

### 4.11 测试套件：`tests/`

目录结构：

```text
tests/
  __init__.py
  conftest.py            # 共享 fixture：settings、sample_repos、mixed_repos
  test_sync_engine.py    # 10 个测试：保序、异常隔离、回调、取消门禁、有界提交、全部同步取消透传、并发下限
  test_gui_server_sync.py # 2 个测试：needed 扫描汇总、服务端同步互斥
  test_repo_checker.py   # 2 个测试：Git 本地状态和分支差异查询失败语义
  test_frontend_rendering.py # 1 个测试：前端不可信文本转义约束
  test_sse_manager.py    # 17 个测试：session 生命周期、取消、phase 事件、精确状态码传递
  test_status_cache.py   # 16 个测试：TTL、快照、占位、裁剪、清除、覆盖、扫描态映射、精确状态码映射
```

覆盖范围：

- 并发执行器 `run_repositories_concurrently` 的保序、异常隔离、回调计数、取消门禁。
- `SSEManager` 的 session 创建/清理/取消/phase 事件。
- `StatusCache` 的 TTL 命中、过期标记、快照元数据、占位状态、裁剪。

运行方式：

```bash
cd SyncDock
pytest tests/ -v
```

当前共 46 个测试，全部通过。


## 5. 业务规则汇总

### 5.1 安全同步规则

安全同步尽量避免覆盖本地工作：

- 路径不存在或非 Git 仓库：无效。
- detached HEAD：跳过。
- 未提交修改：默认跳过。
- 未跟踪文件：由配置决定是否跳过。
- 未设置 upstream：跳过。
- 本地和远端分叉：跳过，交给人工处理。
- 本地仅领先：跳过，不自动推送。
- 远端领先：只允许 `git pull --ff-only`。

### 5.2 强制同步规则

强制同步用于接受远端覆盖本地：

- 仍要求路径有效、是 Git 仓库、处于正常分支、存在 upstream。
- 忽略本地修改、未跟踪文件和分叉保护。
- 使用 `reset --hard @{upstream}` 与 `clean -fd` 覆盖工作区。

### 5.3 状态查询规则

状态查询会刷新远端引用，因此会触发网络 Git 命令。GUI 首屏通过状态快照 + 后台 SSE 增量刷新避免阻塞，同步运行时状态刷新自动降级为缓存读取。

## 6. 性能优化已完成内容

1. `RepositoryChecker.inspect(refresh_remote=True)` 多次 Git 子进程已通过 `_run_git()` 增加短超时和代理一致性。
2. GUI 状态查询已拆分为 **快照 + 后台刷新 SSE**，不再串行阻塞首屏。
3. `needed` 模式已改为**立即创建 session + 后台并发扫描**，不再在 session 创建前串行等待。
4. 同步完成后不再立即全量 `loadAll()`，仅刷新最近日志并补一次后台状态刷新。
5. 已引入内存级状态缓存（`StatusCache`），TTL 60 秒，同步结果和状态刷新结果均回写缓存。
6. 已实现任务取消机制（`cancel_session` / `is_cancelled`），前端进度条旁有取消按钮；并发执行器取消后不会继续提交尚未开始的仓库分片。
7. 已实现全局互斥：同步任务运行时状态刷新降级为缓存读取，服务端也会拒绝并发同步 session。
8. 已建立 TDD 测试套件（46 个测试，覆盖并发执行器、GUI 同步后台任务、RepositoryChecker 失败语义、前端文本转义、SSEManager、StatusCache）。

## 7. 验证记录

本次文档更新前执行了以下验证：

- `python -m compileall -q syncdock gui_launcher.py`：通过，未发现 Python 语法错误。
- `python -m pytest tests/ -v`：46 个测试全部通过（0.52s）。
