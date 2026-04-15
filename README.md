# SyncDock 4.0

SyncDock 4.0 是一个面向 Windows 的轻量级多仓库同步工具。

它专注解决一个核心问题：

在当前电脑上，批量检查并安全同步多个本地 Git 仓库。

当前版本采用 `Python + BAT` 方案，提供交互式数字菜单和静默执行模式，适合手动使用，也适合挂到 Windows 计划任务里定时执行。

## 功能范围

- 同步全部仓库
- 同步指定仓库
- 查看仓库状态
- 查看最近一次日志
- 重新加载配置
- 静默执行全部同步

## 同步策略

SyncDock 4.0 默认只做“安全同步”，不会替你做高风险 Git 操作。

- 执行 `git fetch --all --prune`
- 仅在安全情况下执行 `git pull --ff-only`
- 有未提交修改时跳过
- `detached HEAD` 时跳过
- 正在 `merge / rebase / cherry-pick` 时跳过
- 未配置 upstream 时跳过
- 需要手动处理分支差异时跳过

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

## 配置文件

- [config/repositories.json](/E:/gitHub/SyncDock/config/repositories.json)
- [config/settings.json](/E:/gitHub/SyncDock/config/settings.json)

## 目录说明

- `syncdock/`：4.0 Python 同步内核
- `config/`：仓库与运行配置
- `tests/`：CLI、同步逻辑和边界测试
- `docs/superpowers/specs/`：4.0 设计文档
- `docs/superpowers/plans/`：4.0 实施计划

## 测试

```powershell
py -3 -m pytest tests -q
```

## 许可证

MIT
