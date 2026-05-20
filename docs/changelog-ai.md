# AI/人工上下文变更摘要

## 2026-05-18

- 新增 `docs/code-and-business-logic.md`，系统梳理 SyncDock 的代码逻辑、业务逻辑、核心业务对象、功能模块和当前性能热点。
- 新增 `docs/code-review-and-performance.md`，完成现有代码库审查，重点指出 `/api/status`、`needed` 模式、CLI 状态查询和重复 `loadAll()` 导致 Git 状态拉取过慢。
- 新增 `docs/git-status-architecture-plan.md`，提出后端有界并发、状态刷新 SSE、任务分片、状态缓存、背压和后续实施阶段。
- 关键结论：当前 Git 状态慢的根因主要在后端串行执行 `git fetch --all --prune` 和多次 Git 子进程调用，Web Worker 只能辅助前端数据处理，不是解决 Git 拉取慢的主方案。
- 已根据审查文档完成第一轮优化：新增 `run_repositories_concurrently()` 有界并发执行器，并让 GUI/CLI 的多仓库同步和状态查询复用并发能力。
- 已修复 GUI 明确缺陷：`shutdown()` 缺少 `time` 导入、失败日志接口无用读取、前端重复 `closeConfirm()`、同步完成后立即全量 `loadAll()` 导致二次远端 fetch。
- 已为 `RepositoryChecker._run_git()` 增加短超时和代理命令构造，减少异常仓库拖住整体状态查询的风险。
- 已落地状态缓存与快照链路：新增 `/api/status/snapshot`、`/api/status/refresh`、`/api/status/events/{session_id}`，前端首屏改为先用快照渲染，再后台增量刷新状态。
- 已让同步结果和状态刷新结果回写内存缓存，并对重复状态刷新请求做 session 复用，进一步减少重复 fetch 和页面卡顿。
- 已补全取消机制：SSEManager 新增 `cancel_session` / `is_cancelled`，`run_repositories_concurrently` 新增 `is_cancelled` 门禁，后端新增 `/api/status/refresh/cancel` 和 `/api/sync/cancel/{session_id}` 接口，前端同步进度条旁新增取消按钮，状态刷新在重复点击时先取消旧任务再发起新任务。
- 已为 `needed` 模式的同步事件补充 `phase=scanning/syncing` 阶段字段，前端进度显示会区分"扫描中"和"同步中"。
- 已将状态缓存从 `server.py` 拆分为独立 `syncdock/status_cache.py` 模块，包含 `StatusCache` 类（线程安全、TTL、快照、占位状态、同步结果回写），server.py 直接复用。
- 已为 TDD 创建 `tests/` 测试套件，包含 35 个测试：sync_engine 并发执行器 7 个、SSEManager 16 个、StatusCache 14 个，全部通过（0.17s）。
- 已同步 `docs/code-review-and-performance.md` 中阶段描述，将 Stage 3/4 从"部分完成/待实施"更新为"已完成"。
- 已同步 `docs/git-status-architecture-plan.md` 中阶段 6 为已完成。
- 已实现全局互斥：同步任务运行时状态刷新自动降级为缓存读取，`degraded: true` 传递到前端。
- 已同步更新 `README.md` 为版本 5.0，补充 GUI 模式、状态刷新机制、全局互斥、测试套件说明。
- 已将全部 4 个文档（changelog-ai / code-and-business-logic / code-review-and-performance / git-status-architecture-plan）同步为最新代码状态。
- 本次审查修复了 3 类问题：`RepositoryChecker` 对 `git status` / `rev-list` 失败不再误判为“最新”；`run_repositories_concurrently()` 已按 `HARD_MAX_GIT_PROCESSES=6` 钳制线程池上限；前端仓库名、路径、状态徽标和日志写入 `innerHTML` 前统一使用 `escapeHtml()` 转义。
- 已补充 4 个定向测试，测试总数更新为 39 个；`py -3 -m pytest tests/ -q` 全部通过（0.19s）。

## 2026-05-20

- 修复 GUI `needed` 模式扫描结果进入最终同步汇总的问题：扫描阶段发现需要同步时改为 `NEEDS_SYNC` 进度事件，最终 summary/log 只统计真实同步或扫描异常结果。
- 修复取消语义：`run_repositories_concurrently()` 改为有界提交，取消后不再把尚未开始的仓库继续塞入线程池；`sync_all_repositories()` 与 GUI `all` 模式同步透传取消检查器。
- 增加服务端同步互斥：`/api/sync/start` 在已有同步任务运行时返回 `409`，避免多个页面或脚本同时对同一批仓库执行 Git 操作。
- 补充 `NEEDS_SYNC` 在状态缓存和前端状态列中的映射，避免扫描阶段把“需要同步”误显示成“已跳过/有本地修改”。
- 调整 `.gitignore`，不再忽略 `tests/` 和 `docs/`，让测试套件与项目上下文文档可进入 Git 协作范围。
- 已新增 7 个回归测试，测试总数更新为 46 个；`py -3 -m pytest tests/ -v` 与 `py -3 -m compileall syncdock` 均通过。





