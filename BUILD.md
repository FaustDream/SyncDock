# SyncDock v1.0.0 构建指南

## 快速构建

### 方法一：执行打包脚本（推荐）

```powershell
# 在项目根目录执行
.\build-release.bat
```

### 方法二：手动分步构建

```powershell
# 1. 构建前端
npm run build

# 2. 构建 Tauri 应用（生成安装包）
npm run tauri build

# 3. 手动整理文件到 Releases 目录
```

---

## 输出文件位置

### 安装版（NSIS 安装包）
- 位置: `src-tauri\target\release\bundle\nsis\`
- 文件: `SyncDock_1.0.0_x64-setup.exe`

### 便携版（独立 exe）
- 位置: `src-tauri\target\release\`
- 文件: `syncdock-desktop.exe`
- 注意: 需要系统已安装 WebView2 运行时

---

## 发布目录结构

```
Releases/
└── v1.0.0/
    ├── 安装版/
    │   └── SyncDock_1.0.0_x64-setup.exe    # NSIS 安装包
    │
    └── 便携版/
        ├── SyncDock.exe                     # 便携版 exe
        └── README.txt                       # 使用说明
```

---

## 系统要求

### 开发环境
- Node.js >= 18
- Rust >= 1.70
- Windows 10/11 SDK

### 运行环境
- Windows 10 1809+ 或 Windows 11
- Microsoft Edge WebView2 运行时
  - 下载: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

---

## 常见问题

### Q: 构建失败 "linker 'link.exe' not found"
安装 Visual Studio Build Tools，选择 "C++ 生成工具"

### Q: WebView2 相关错误
确保安装了 WebView2 SDK 或运行时

### Q: 构建时间过长
首次构建需要编译所有依赖，约 5-15 分钟。后续构建会快很多。

---

## 构建检查清单

- [ ] Node.js 已安装
- [ ] Rust/Cargo 已安装
- [ ] Visual Studio Build Tools 已安装
- [ ] WebView2 SDK 已安装（可选，用于开发）
- [ ] 项目依赖已安装 (`npm install`)
- [ ] 前端代码无错误 (`npm run build`)
- [ ] Tauri 配置正确 (`src-tauri/tauri.conf.json`)

---

*构建完成后，运行 `explorer Releases\v1.0.0` 查看产物*
