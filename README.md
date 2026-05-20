# SyncDock 5.0

SyncDock 是一个面向 Windows 的轻量级多仓库同步工具，同时提供 **GUI 图形界面** 和 **CLI 交互菜单** 两种运行方式。

目标很明确：在当前电脑上，批量检查并同步多个本地 Git 仓库，同时尽量避免高风险操作。

## 功能范围

- 同步全部仓库
- 仅同步需要更新的仓库
- 重试最近失败的仓库
- 同步指定仓库，支持多选
- 强制同步指定仓库，支持多选
- 查看全部启用仓库状态（首屏快速加载 + 后台增量刷新）
- 查看最近一次失败原因
- 实时同步进度 SSE 推送
- 取消正在运行的同步/状态刷新任务
- 重新加载配置
- 静默执行全部同步

## 同步策略

默认同步是"安全同步"：

- 先执行 `git fetch --all --prune`
- 仅在安全情况下执行 `git pull --ff-only`
- 有未提交修改时跳过
- 可按配置决定是否因未跟踪文件而跳过
- `detached HEAD` 时跳过
- 正在 `merge / rebase / cherry-pick` 时跳过
- 未配置 upstream 时跳过
- 分支出现双向分叉时跳过

强制同步用于直接覆盖本地工作区：

- 先执行 `git fetch --all --prune`
- 再执行 `git reset --hard @{upstream}`
- 最后执行 `git clean -fd`

这会覆盖本地未提交改动并清理未跟踪文件。

## 安装依赖

```powershell
py -3 -m pip install -r requirements.txt
```

## 运行方式

### GUI 模式（推荐）

```powershell
.\run-gui.vbs
```

启动后浏览器自动打开 `http://localhost:8866`，提供完整的仓库管理和同步操作界面。

### CLI 交互菜单

```powershell
.\run-sync.bat
```

### 静默同步

```powershell
.\run-sync-silent.bat
```

### 直接运行 Python 入口

```powershell
py -3 -m syncdock.main
py -3 -m syncdock.main --silent
```

## GUI 界面说明

### 状态刷新机制

状态查询采用"**先快照、后刷新**"模式，避免首屏长时间等待：

1. 首屏调用 `/api/status/snapshot`，**内存缓存**命中时立即返回，未命中时降级为占位状态。
2. 后台自动发起 `/api/status/refresh` 创建状态刷新任务。
3. 每个仓库状态刷新完成后，通过 **SSE 事件流** 逐行更新对应行状态徽标，不阻塞其他仓库。
4. 支持取消正在运行的状态刷新任务（点击刷新按钮会先取消旧任务再新建）。

### 同步进度

- 点击同步按钮后，立即创建同步 session 并显示进度条。
- `仅需同步` 模式先并发扫描所有仓库（推送 `phase=scanning` 事件），再对需要同步的仓库执行同步（`phase=syncing`）。
- 同步过程中遇到取消任务、网络超时、权限错误等异常时，仅影响单个仓库，其他仓库继续执行。
- 同步完成后仅刷新最近日志，不立即全量刷新状态。
- 进度条旁有"取消"按钮，可随时中止未开始的分片。

### 全局互斥

同步任务正在运行时，状态刷新请求会自动降级为**缓存读取模式**（不执行远端 Git fetch），
前端会提示"状态为缓存快照（同步进行中）"。同步结束后，下次状态刷新恢复正常远端查询。

## 配置文件

配置目录：

- `config/repositories.json`
- `config/settings.json`

### repositories.json

作用：定义要纳入同步的仓库列表。

示例：

```json
{
  "repositories": [
    {
      "name": "SyncDock",
      "path": "D:\\gitHub\\SyncDock",
      "enabled": true
    }
  ]
}
```

字段说明：

- `name`：仓库显示名称
- `path`：本地仓库绝对路径
- `enabled`：是否启用；为 `false` 时不会参与同步和状态查看

### settings.json

作用：定义运行时同步策略。

示例：

```json
{
  "concurrent_limit": 3,
  "command_timeout_seconds": 120,
  "skip_uncommitted_changes": true,
  "skip_untracked_files": false,
  "log_retention_days": 30,
  "proxy_port": 28203
}
```

字段说明：

- `concurrent_limit`：多仓库同步/状态刷新的最大并发数（默认 3，受 `HARD_MAX_GIT_PROCESSES=6` 硬上限约束）
- `command_timeout_seconds`：单个 Git 命令超时时间
- `skip_uncommitted_changes`：有未提交修改时是否跳过
- `skip_untracked_files`：有未跟踪文件时是否跳过
- `log_retention_days`：日志保留天数
- `proxy_port`：Git 代理端口（默认 28203）

修改配置后，可以：

- 重启程序
- 或在 GUI 中点击"重新加载"
- 或在 CLI 菜单中选择"重新加载配置"

## 目录说明

- `syncdock/`：核心同步逻辑（sync_engine、repo_checker、status_cache 等模块）
- `syncdock/gui/`：GUI 服务端（FastAPI + SSE）和前端静态页
- `config/`：本地配置文件
- `logs/`：运行日志
- `tests/`：测试套件（46 个测试，覆盖并发执行器、GUI 同步后台任务、RepositoryChecker 失败语义、前端文本转义、SSE 管理、状态缓存）
- `run-gui.vbs`：GUI 模式启动脚本
- `run-sync.bat`：交互菜单启动脚本
- `run-sync-silent.bat`：静默同步启动脚本
- `gui_launcher.py`：GUI 服务启动入口

## 测试

```powershell
py -3 -m pytest tests/ -v
```

当前共 46 个测试：

| 模块 | 数量 | 覆盖内容 |
|---|---|---|
| `test_sync_engine.py` | 10 | 保序、异常隔离、回调、取消门禁、有界提交、全部同步取消透传、并发下限、硬上限 |
| `test_gui_server_sync.py` | 2 | `needed` 模式扫描汇总、服务端同步互斥 |
| `test_repo_checker.py` | 2 | Git 本地状态和分支差异查询失败语义 |
| `test_frontend_rendering.py` | 1 | 前端不可信文本转义约束 |
| `test_sse_manager.py` | 17 | session 生命周期、取消、phase 事件、精确状态码传递 |
| `test_status_cache.py` | 16 | TTL、快照、占位、裁剪、覆盖、扫描态映射、精确状态码映射、清除 |

## 许可证

MIT
