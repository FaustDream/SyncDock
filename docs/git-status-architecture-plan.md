# SyncDock Git 状态拉取架构优化方案与执行计划

## 1. 背景

当前 `SyncDock` 已支持多仓库同步和 GUI 实时进度，但 Git 状态拉取存在明显串行瓶颈：

- GUI `/api/status` 对所有仓库逐个执行 `inspect(refresh_remote=True)`。
- `needed` 模式在返回 `session_id` 前串行扫描所有仓库。
- CLI 状态查询和部分同步入口也未统一复用并发能力。
- 前端完成同步后全量 `loadAll()`，会再次触发全量状态刷新。

当仓库数量增加、远端网络慢、代理不稳定或某个仓库接近超时时，用户会感知为页面卡顿、按钮长时间无反馈，严重时可能堆积多个 Git 子进程，拖慢整机。

## 2. 优化目标

### 2.1 体验目标

- 首屏不等待所有远端 fetch 完成即可展示仓库列表。
- 状态刷新按仓库增量返回，单仓库慢不阻塞其他仓库展示。
- `仅需同步` 点击后立即进入可见进度，而不是等待扫描完成。
- 同步完成后不再立即触发二次全量远端刷新。

### 2.2 性能目标

- 状态拉取耗时接近 `ceil(仓库数 / 并发数) * 单仓库平均耗时`。
- 默认并发有上限，避免无界创建 Git 子进程。
- 慢仓库、失败仓库、超时仓库互相隔离。
- 状态刷新和同步任务具备背压，避免重复点击造成系统资源耗尽。

### 2.3 安全目标

- 不改变安全同步和强制同步的业务语义。
- 不自动推送、不自动处理分叉。
- 强制同步仍只在用户显式选择强制策略时发生。
- 所有 Git 命令保留超时和错误归一化。

## 3. 推荐架构

### 3.1 分层结构

建议新增或重构为以下服务层：

```text
syncdock/
  git_command.py              # 统一 Git 命令执行、超时、代理、错误映射 — 已通过 GitCommandRunner 实现
  task_executor.py            # 有界并发、任务分片、回调、取消标记 — 已并入 sync_engine.run_repositories_concurrently
  status_service.py           # 状态快照、状态刷新、状态缓存 — 已拆出 status_cache.py
  status_cache.py             # 线程安全的状态缓存模块，支持 TTL 和快照
  sync_engine.py              # 同步业务语义，复用 task_executor
  gui/
    server.py                 # API 编排，不直接串行跑 Git 循环
    sse_manager.py            # 同步与状态刷新事件流复用或扩展
```

### 3.2 任务模型

每个仓库视为一个任务分片：

```text
StatusRefreshTask
  session_id
  repositories[]
  concurrent_limit
  refresh_remote
  cancelled

RepositoryShard
  repository
  operation: inspect | safe_sync | force_sync
  timeout
```

执行规则：

1. API 只负责创建任务和返回 `session_id`。
2. 后台 worker 按并发上限执行仓库分片。
3. 每个分片完成后推送 `progress` 事件。
4. 全部分片完成或取消后推送 `complete` 事件。
5. 任务执行期间新建同类任务需排队、拒绝或取消旧任务。

### 3.3 状态缓存

引入内存缓存：

```text
StatusCache[name] = {
  status_code,
  status_label,
  detail,
  branch_name,
  upstream_name,
  ahead_count,
  behind_count,
  fetched_at,
  source: local | remote | sync_result,
}
```

缓存策略：

- 首屏读取 `snapshot`，无缓存则返回 `unknown` 或本地轻量状态。
- 远端刷新完成后更新缓存。
- 同步进度事件可直接更新缓存为 `up_to_date`、`failed`、`skipped` 等。
- TTL 默认 30~120 秒，可配置。

## 4. API 设计建议

### 4.1 状态快照

`GET /api/status/snapshot`

用途：快速返回缓存，不触发远端 fetch。

响应示例：

```json
{
  "rows": [
    {
      "name": "SyncDock",
      "status_code": "up_to_date",
      "status_label": "已经是最新",
      "detail": "分支 main -> origin/main",
      "cached": true,
      "fetched_at": "2026-05-18T20:35:00+08:00"
    }
  ]
}
```

### 4.2 启动状态刷新

`POST /api/status/refresh`

请求：

```json
{
  "names": ["SyncDock", "DeepFocus"],
  "refresh_remote": true
}
```

响应：

```json
{
  "session_id": "...",
  "total": 2
}
```

### 4.3 状态刷新事件

`GET /api/status/events/{session_id}`

事件：

```text
event: progress
data: {"name":"SyncDock","status_code":"up_to_date","status_label":"已经是最新","progress":1,"total":2}

event: complete
data: {"summary":{"total":2,"failed":0,"invalid":0,"skipped":0,"ready":2}}
```

### 4.4 同步任务事件扩展

现有 `/api/sync/events/{session_id}` 可扩展阶段字段：

```json
{
  "event": "progress",
  "phase": "scanning",
  "name": "SyncDock",
  "outcome": "UP_TO_DATE",
  "message": "已经是最新",
  "progress": 1,
  "total": 11
}
```

阶段建议：

- `scanning`：仅需同步模式扫描阶段。
- `syncing`：执行 fetch/pull/reset/clean。
- `complete`：任务结束。

## 5. 并发与异步策略

### 5.1 后端优先，而不是 Web Worker 优先

Git 命令运行在本地 Python 后端，浏览器 Web Worker 无法直接执行 Git。因此当前主优化点应是：

- 后端有界线程池。
- 后台任务化。
- SSE 增量推送。
- 状态缓存和减少重复 fetch。

Web Worker 适合作为后续补充：

- 大量仓库表格排序、过滤、diff 计算。
- 大日志解析和失败摘要生成。
- 避免复杂前端计算阻塞 UI 主线程。

### 5.2 并发上限建议

默认：

```text
status_concurrent_limit = min(settings.concurrent_limit, 4)
sync_concurrent_limit = settings.concurrent_limit
hard_max_git_processes = 6
```

原因：

- Git fetch 是网络和磁盘混合 I/O，适合小规模并发。
- 并发过高会争抢网络、磁盘和杀毒软件扫描资源。
- Windows 下过多 Git 进程容易造成系统明显卡顿。

### 5.3 背压策略

建议规则：

- 同一时间只允许一个同步任务运行。
- 状态刷新任务在同步任务运行时可降级为缓存读取，或只刷新未参与同步的仓库。
- 重复点击状态刷新时，若已有刷新任务，直接返回已有 `session_id` 或取消旧任务。
- 用户关闭 SSE 连接后，可设置取消标记，不再启动新的仓库分片。

## 6. 实施计划

### 阶段 0：基线记录

目标：在改动前获得可对比数据。

任务：

1. 记录当前仓库数量、`concurrent_limit`、`command_timeout_seconds`。
2. 手动测量 `/api/status` 完整耗时。
3. 手动测量 `仅需同步` 从点击到返回 `session_id` 的耗时。
4. 记录单个慢仓库或失败仓库表现。

验收：

- 文档中记录至少一组基线数据。
- 明确最慢阶段是状态刷新、扫描还是实际 pull。

### 阶段 1：低风险缺陷修复（已完成）

目标：先消除明确 bug 和无效开销。

任务：

1. 已修复 `syncdock/gui/server.py` 中 `shutdown()` 缺少 `time` 导入。
2. 已删除 `get_failed_logs()` 中未使用的 `read_latest_log()` 调用。
3. 已合并前端重复 `closeConfirm()`。
4. 已将同步完成后的立即全量 `loadAll()` 改为仅刷新最近日志，避免二次全量远端 fetch。

验收：

- 关闭服务接口不再因缺少 `time` 导入触发 `NameError`。
- 强制同步确认框保留关闭动画。
- 同步完成后页面不再立即触发全量远端刷新。

### 阶段 2：统一 Git 命令执行器（已完成基础版）

目标：统一超时、代理和错误映射。

任务：

1. 抽出 `git_command.py` 或扩展 `GitCommandRunner`。
2. 支持本地命令短超时与远端命令长超时。
3. `RepositoryChecker._run_git()` 改为复用统一执行器。
4. 保留现有中文错误消息语义。

验收：

- 状态检查中所有 Git 子进程均有超时保护。
- 代理行为一致。
- 现有同步结果消息不发生破坏性变化。

### 阶段 3：通用有界并发执行器（已完成基础版）

目标：让状态检查和多种同步入口复用并发能力。

任务：

1. 已在 `syncdock/sync_engine.py` 新增 `run_repositories_concurrently()`。
2. 已保证结果按输入顺序归位。
3. 已捕获单分片异常并转换为失败结果。
4. `sync_all_repositories()`、GUI 选中/重试/强制同步、CLI 选中/重试/仅需同步执行阶段均已复用该执行器。

验收：

- 全部同步行为与当前安全/强制策略一致。
- 任一仓库失败不影响其他仓库。
- callback 在分片完成后立即触发。

### 阶段 4：并发化状态查询（已完成基础版）

目标：解决 `/api/status` 串行瓶颈。

任务：

1. `/api/status` 已改为并发返回完整结果。
2. CLI `_collect_status_rows()` 已复用并发状态检查。
3. `RepositoryChecker._run_git()` 已增加本地 Git 命令短超时，避免异常仓库无限阻塞。

验收：

- 11 个仓库状态查询可按 `concurrent_limit` 分片并发执行。
- 单仓库超时不会无限阻塞其他仓库结果生成。
- 返回结构与前端现有逻辑保持兼容。

### 阶段 5：状态刷新 SSE 化（已完成基础版）

目标：彻底避免状态刷新期间页面长时间无反馈。

任务：

1. 已新增 `/api/status/snapshot`。
2. 已新增 `/api/status/refresh`。
3. 已新增 `/api/status/events/{session_id}`。
4. 前端首屏已改为先渲染仓库配置和缓存快照，再连接状态刷新 SSE。
5. 每个仓库状态完成后会只更新对应行，避免整表重绘。

验收：

- 首屏能快速展示仓库列表。
- 状态徽标逐行更新。
- 慢仓库不会阻塞快仓库展示。
- 用户刷新状态时页面可继续交互。


### 阶段 6：`needed` 模式后台扫描化（已完成）

目标：让“仅需同步”立即进入进度流。

任务：

1. 已实现 `POST /api/sync/start` 对 `needed` 模式立即创建 session。
2. 后台任务先并发扫描需要同步的仓库。
3. 扫描阶段推送 `phase=scanning` 事件。
4. 扫描完成后对需要同步仓库进入 `phase=syncing`。
5. 如果没有需要同步仓库，通过 `complete` 返回空更新摘要。

验收：

- 点击“仅需同步”后 1 秒内获得可见进度。
- 扫描失败、跳过、无效仓库都有明确事件。
- 需要同步仓库继续按并发上限执行。

### 阶段 7：缓存、取消与背压

目标：降低重复 fetch 和系统资源风险。

任务：

1. 已实现内存级 `StatusCache` 和 60 秒 TTL。
2. 已让同步结果与状态刷新结果回写状态缓存。
3. 状态刷新已支持同类任务复用已有 `session_id`，避免重复点击堆积多组远端 fetch。
4. 同类任务重复启动时已优先复用而不是重复创建新任务。
5. 已实现显式取消标记，支持通过 `POST /api/status/refresh/cancel` 和 `POST /api/sync/cancel/{session_id}` 提前终止未开始的分片。
6. `run_repositories_concurrently` 已新增 `is_cancelled` 可选参数，并改为有界提交；取消后不再继续提交尚未开始的仓库分片。
7. 前端同步进度条旁已新增「取消」按钮，可直接中止本轮同步。
8. 全局 Git 进程硬上限 `HARD_MAX_GIT_PROCESSES = 6` 已在并发执行器中生效，用户配置超过 6 时会被自动钳制。

验收：

- 短时间重复打开页面不会重复全量 fetch。
- 同步期间重复点击不会堆积多组 Git 子进程。
- 页面关闭后后台任务不会继续启动新的未开始分片。
- 用户可通过前端按钮或 API 调用取消正在运行的任务。

### 阶段 8：全局互斥（已完成）

目标：同步运行时状态刷新不会发起远端 fetch，避免 Git 子进程争抢与系统资源耗尽。

任务：

1. 已增加 `_SYNC_ACTIVE_COUNT` 全局计数器，`start_sync` 递增、`_run_sync_in_background` 的 `finally` 递减。
2. `start_status_refresh` 在同步活跃时自动将 `refresh_remote` 设为 `False`，仅返回缓存快照。
3. 响应中增加 `degraded: true` 字段，前端据此显示"状态为缓存快照（同步进行中）"。
4. 同步结束后，下次状态刷新自动恢复正常远端查询。

验收：

- 同步进行中点击状态刷新，不会触发远端 Git fetch。
- 同步结束后状态刷新自动恢复远端刷新。
- 前端能清晰提示用户当前为缓存数据。


## 7. 测试计划

### 7.1 单元测试

- `parse_status_lines()`：未提交、未跟踪、混合状态。
- Git 命令执行器：成功、超时、权限失败、网络失败。
- 并发执行器：顺序保持、异常隔离、回调次数、并发上限。
- 状态缓存：TTL 命中、过期、同步结果覆盖。

### 7.2 集成测试

- `/api/status` 返回结构兼容旧前端。
- 状态刷新 SSE：progress 数量等于目标仓库数，complete 只发送一次。
- `/api/sync/start` 的 `needed` 模式立即返回 session。
- 同步任务和状态任务互斥或背压行为符合预期。

### 7.3 手动验证

- 11 个仓库全部启用。
- 人为断开网络或配置一个不可访问远端。
- 点击刷新状态，观察快仓库是否先返回。
- 点击仅需同步，观察扫描阶段是否有进度。
- 同步完成后确认没有立即二次全量 fetch。
- 连续点击多个按钮，确认不会造成系统明显卡顿。

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 并发 Git 进程过多 | 网络、磁盘、CPU 飙升 | 默认并发 3，硬上限 6，任务背压 |
| 状态缓存过期导致显示不准 | 用户看到旧状态 | 展示 `cached/fetched_at`，允许手动强制刷新 |
| 取消任务无法终止已启动 Git | 慢命令仍运行到超时 | 取消只阻止新分片，已启动进程依赖 timeout 收敛 |
| SSE 断连导致 session 泄漏 | 内存增长 | session TTL 和 finally cleanup |
| `needed` 模式阶段变多 | 前端逻辑复杂 | 事件增加 `phase` 字段，保持旧字段兼容 |

## 9. 推荐落地顺序

最短可见收益路径：

1. 阶段 1：修复缺陷和重复刷新。
2. 阶段 3：引入通用有界并发执行器。
3. 阶段 4：并发化 `/api/status`。
4. 阶段 6：后台化 `needed` 扫描。
5. 阶段 5 和 7：进一步优化首屏体验、缓存和背压。

如时间有限，优先完成 1、3、4，可最快缓解“Git 拉取状态过慢”。

## 10. 交付检查清单

- [x] 所有新增或修改函数已补充中文注释。
- [x] 更新 `README.md` 中状态刷新和并发配置说明。
- [x] 更新 `docs/code-and-business-logic.md` 中架构和接口描述。
- [x] 更新 `docs/code-review-and-performance.md` 中已完成项。
- [x] 补充并发执行器、GUI 同步后台任务和状态服务测试（46 个测试全部通过）。
- [x] 运行 `python -m compileall -q syncdock gui_launcher.py`（通过）。
- [x] 运行 `python -m pytest tests/ -v`（46 个测试全部通过，0.52s）。
- [ ] 手动验证 GUI 状态刷新、同步、仅需同步、关闭服务。
