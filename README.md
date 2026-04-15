# SyncDock 2.0.0

SyncDock 是一款面向多 Git 仓库场景的桌面同步工作台，帮助开发者在一个界面内完成仓库状态查看、后台同步、任务追踪、日志排查和配置迁移。

## 当前版本

- 版本：`2.0.0`
- 桌面框架：`Tauri 1.x`
- 前端：`React 18 + TypeScript + Vite`
- 后端：`Rust`
- 当前交付平台：`Windows`

## 核心能力

- 多仓库统一管理
- 仓库分组与归属管理
- 后台刷新状态
- 后台同步、分组同步、单仓库同步、强制同步
- 任务进度条与阶段日志
- 仓库日志中心与任务日志中心
- 错误码透出与故障排查
- 仓库配置导入导出

## 2.0.0 重点更新

- 所有同步与刷新操作改为后台执行，避免界面卡住
- 任务概览新增今日任务分组与当前任务进度展示
- 仓库详情页重排为顶部操作区 + 双栏正文 + 底部日志
- 仓库日志默认显示全部日志，选中仓库后切换单仓库视角
- 日志中的 warning/error 增加错误码展示
- 设置页重构，补齐路径与目录、关于页与 2.0.0 发布信息
- 新增 `docs/v2.0.0` 全套交付文档

## 页面结构

- 总览：查看仓库状态、最近任务、待处理项
- 仓库：
  - 工作区
  - 清单
  - 日志
- 任务：
  - 概览
  - 历史任务
  - 日志中心
- 设置：
  - 常规
  - 同步
  - 路径与目录
  - 关于

## 开发环境

- Node.js 18+
- Rust 1.77+
- Windows 10/11
- Microsoft Edge WebView2 Runtime

## 本地运行

```powershell
npm install
npm run tauri dev
```

## 生产构建

```powershell
npm run tauri build
```

## 发布构建

```powershell
.\build-release.bat
```

构建完成后可得到：

- Windows 安装版
- Windows 免安装版压缩包

发布说明见：

- [BUILD.md](./BUILD.md)
- [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)

## 文档导航

2.0.0 文档位于：

- [docs/v2.0.0/00-文档目录.md](./docs/v2.0.0/00-文档目录.md)

重点文档：

- [项目总览](./docs/v2.0.0/01-项目总览.md)
- [项目需求文档 PRD](./docs/v2.0.0/02-项目需求文档-PRD.md)
- [技术路线方案](./docs/v2.0.0/03-技术路线方案.md)
- [总览与仓库页面说明](./docs/v2.0.0/04-功能与页面使用说明-总览与仓库.md)
- [任务与设置页面说明](./docs/v2.0.0/05-功能与页面使用说明-任务与设置.md)
- [边界问题与异常场景处理清单](./docs/v2.0.0/07-边界问题与异常场景处理清单.md)
- [常见 Bug 风险与排除清单](./docs/v2.0.0/08-常见Bug风险与排除清单.md)
- [错误码与提示文案规范](./docs/v2.0.0/09-错误码与提示文案规范.md)
- [故障排查指南](./docs/v2.0.0/12-故障排查指南.md)

## 目录说明

- `src/`：前端页面、组件、状态与工具
- `src-tauri/`：Rust 后端、Tauri 命令、存储与同步逻辑
- `docs/`：版本化文档
- `Releases/`：本地发布产物目录

说明：`Releases/` 已加入 `.gitignore`，不会提交到仓库。

## 许可证

MIT

## SyncDock 4.0 CLI Usage

### Install dependencies

```powershell
py -3 -m pip install -r requirements.txt
```

### Interactive mode

```powershell
.\run-sync.bat
```

### Silent mode

```powershell
.\run-sync-silent.bat
```

