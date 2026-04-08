# SyncDock v2.0.0 构建指南

## 适用范围

- Windows 安装版
- Windows 免安装版

## 构建前提

- Node.js 已安装
- Rust/Cargo 已安装
- Windows 构建环境可用
- 已执行 `npm install`

## 常用命令

```powershell
npm run build
npm run tauri build
```

## 产物位置

- 安装版：`src-tauri\target\release\bundle\nsis\`
- 主程序：`src-tauri\target\release\syncdock-desktop.exe`
- 发布整理目录：`Releases\v2.0.0\`

## 推荐方式

```powershell
.\build-release.bat
```

该脚本会完成：

- 生产构建
- 复制安装包
- 生成免安装版目录
- 打包便携压缩包

