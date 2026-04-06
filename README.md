# SyncDock / 同步坞

<div align="center">

**多 Git 仓库一键同步工作台**

*A calm desktop hub for multi-repository sync*

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-1.8-9cf.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18.3-61dafb.svg)](https://reactjs.org/)
[![Rust](https://img.shields.io/badge/Rust-1.77+-orange.svg)](https://www.rust-lang.org/)

</div>

---

## 📖 项目简介

**同步坞（SyncDock）** 是一款面向个人开发者的桌面端多 Git 仓库同步工具。

### 核心价值

- 🎯 **一键同步** - 批量同步多个 Git 仓库，告别逐个手动 pull
- 🛡️ **稳定优先** - 采用保守策略，默认保护本地工作区不被破坏
- 📊 **统一视图** - 集中查看所有仓库状态，一目了然
- 🔍 **可解释性** - 每个同步结果都有明确说明，知道为什么成功、失败或跳过

### 适用场景

- 多设备办公，需要在设备间同步多个仓库
- 维护大量分散的代码、文档、配置仓库
- 希望降低日常同步操作成本的开发者
- 需要统一管理多个独立 Git 仓库的用户

---

## ✨ 主要功能

### 📦 仓库管理

- 扫描本地目录，自动识别 Git 仓库
- 手动添加单个仓库
- 仓库分组管理
- 启用/禁用仓库
- 编辑仓库名称、备注、分组

### 🔄 同步功能

- 一键同步全部仓库
- 按分组同步
- 选中仓库批量同步
- 单仓库单独同步
- 实时进度展示

### 📈 状态监控

- 当前分支显示
- ahead/behind 提交数
- 工作区状态检测
- 最近同步结果
- 同步时间记录

### 📝 日志追踪

- 同步任务历史记录
- 每仓库详细结果
- 错误摘要查看
- 日志导出功能
- 日志自动清理

### ⚙️ 配置管理

- 自定义同步策略
- 并发数、超时设置
- 配置导入导出
- 跨设备迁移支持
- 路径前缀替换

---

## 🚀 快速开始

### 前置要求

- **Git**: 版本 2.0 或更高
- **Node.js**: 版本 16 或更高（仅开发时需要）
- **Rust**: 版本 1.77 或更高（仅开发时需要）

### 从源码构建

#### 1. 克隆仓库

```bash
git clone https://github.com/your-username/SyncDock.git
cd SyncDock
```

#### 2. 安装依赖

```bash
# 安装 Node.js 依赖
npm install
```

#### 3. 开发模式运行

```bash
# 启动开发服务器
npm run tauri dev
```

#### 4. 构建生产版本

```bash
# 构建桌面应用
npm run tauri build
```

构建完成后，安装包位于 `src-tauri/target/release/bundle/` 目录。

### 直接下载

访问 [Releases](https://github.com/your-username/SyncDock/releases) 页面下载最新版本安装包。

---

## 📚 文档导航

完整文档位于 [`docs/`](./docs/) 目录：

### 核心文档

- [文档目录](./docs/00-文档目录.md) - 完整文档索引
- [项目总览](./docs/01-项目总览.md) - 项目定位与价值
- [需求文档 PRD](./docs/02-项目需求文档-PRD.md) - 产品需求定义

### 设计文档

- [技术路线方案](./docs/03-技术路线方案.md) - 技术栈与架构设计
- [功能模块清单](./docs/04-功能模块清单.md) - 功能拆解与优先级
- [稳定性与同步策略](./docs/05-稳定性与同步策略设计.md) - 核心同步策略
- [界面风格与交互规范](./docs/06-界面风格与交互规范.md) - UI/UX 设计规范

### 运维文档

- [边界问题与异常场景](./docs/07-边界问题与异常场景处理清单.md) - 边界场景处理
- [常见 Bug 风险与排查](./docs/08-常见Bug风险与排查清单.md) - 问题排查指南
- [错误码与提示文案](./docs/09-错误码与提示文案规范.md) - 错误码规范

### 用户手册

- [用户使用手册（中文）](./docs/10-用户使用手册-中文.md) - 中文使用指南
- [用户使用手册（英文）](./docs/11-用户使用手册-英文.md) - English User Guide
- [故障排查指南](./docs/12-故障排查指南.md) - 常见问题解决方案

### 开发文档

- [开发者指南](./docs/13-开发者指南.md) - 开发环境与贡献指南
- [现有完整功能文档](./docs/14-现有完整功能文档.md) - 功能详细说明

---

## 🗂️ 日志位置

### Windows

```
C:\Users\<用户名>\AppData\Roaming\com.syncdock.desktop\logs\
```

### macOS

```
~/Library/Application Support/com.syncdock.desktop/logs/
```

### Linux

```
~/.config/com.syncdock.desktop/logs/
```

### 日志文件说明

- `task_YYYYMMDD_HHMMSS.log` - 同步任务日志
- `app.log` - 应用运行日志
- 日志自动清理周期可在设置中配置（默认 30 天）

---

## 🛠️ 技术栈

### 前端

- **React 18** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具

### 后端

- **Tauri 1.8** - 桌面应用框架
- **Rust** - 后端逻辑
- **Serde** - 序列化框架

### 核心依赖

- **chrono** - 时间处理
- **rayon** - 并行计算
- **walkdir** - 目录遍历

---

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

### 开发指南

详细开发指南请参考 [开发者指南](./docs/13-开发者指南.md)。

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

---

## 🙏 致谢

感谢所有为这个项目做出贡献的开发者！

---

## 📮 联系方式

- 提交 Issue: [GitHub Issues](https://github.com/your-username/SyncDock/issues)
- 功能建议: [GitHub Discussions](https://github.com/your-username/SyncDock/discussions)

---

<div align="center">

**同步坞 - 让多仓库同步变得简单而稳定**

Made with ❤️ by SyncDock Team

</div>
