# SyncDock 4.0

SyncDock 4.0 是一个面向 Windows 的轻量级多仓库同步工具。

目标很明确：在当前电脑上，批量检查并同步多个本地 Git 仓库，同时尽量避免高风险操作。

当前版本采用 `Python + BAT` 方式运行，适合：

- 手动执行同步
- 定时任务静默执行
- 小规模多仓库日常维护

## 功能范围

- 同步全部仓库
- 同步指定仓库，支持多选
- 强制同步指定仓库，支持多选
- 查看全部启用仓库状态
- 查看最近一次失败原因
- 重新加载配置
- 静默执行全部同步

## 同步策略

默认同步是“安全同步”：

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

交互菜单：

```powershell
.\run-sync.bat
```

静默同步：

```powershell
.\run-sync-silent.bat
```

也可以直接运行 Python 入口：

```powershell
py -3 -m syncdock.main
py -3 -m syncdock.main --silent
```

## 菜单说明

### 1. 同步全部仓库

对所有启用仓库执行安全同步。

### 2. 同步指定仓库（可多选）

会先列出所有启用仓库，并显示序号。  
列表会按“本人仓库优先、其他作者仓库靠后”的规则展示，同组内再按仓库名称首字母排序。  
输入多个序号即可多选，支持两种格式：

```text
1 3 5
1,3,5
```

### 3. 查看仓库状态

查看全部启用仓库的当前状态。  
执行状态检查前会先刷新远端引用，再判断本地和云端是否一致。  
仓库展示顺序与“同步指定仓库”一致，默认本人仓库在前，其他作者仓库在后，同组内按仓库名称首字母排序。  
输出使用双栏表格形式展示：

- 左栏：仓库名称
- 右栏：状态说明

### 4. 查看最近失败原因

读取 `logs/` 目录中最新的一份日志文件，并仅展示失败仓库及失败原因摘要。
如果最近一次同步没有失败仓库，会明确提示。

### 5. 重新加载配置

重新读取 `config/` 目录下的配置文件，适用于修改配置后不重启程序直接生效。

### 6. 强制同步指定仓库（可多选）

同样支持多选输入。  
这个选项会直接用远端状态覆盖本地仓库，适合确认不要保留本地改动的场景。

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
  "log_retention_days": 30
}
```

字段说明：

- `concurrent_limit`：并发同步仓库数量
- `command_timeout_seconds`：单个 Git 命令超时时间
- `skip_uncommitted_changes`：有未提交修改时是否跳过
- `skip_untracked_files`：有未跟踪文件时是否跳过
- `log_retention_days`：日志保留天数

修改配置后，可以：

- 重启程序
- 或在菜单中选择“重新加载配置”

## 目录说明

- `syncdock/`：核心同步逻辑
- `config/`：本地配置文件
- `logs/`：运行日志
- `run-sync.bat`：交互菜单启动脚本
- `run-sync-silent.bat`：静默同步启动脚本

## 测试

```powershell
py -3 -m pytest -q
```

## 许可证

MIT
