# GitHub Release 上传指南

## 已完成
✅ 代码已推送到: https://github.com/FaustDream/SyncDock
✅ 标签 v1.0.0 已创建

---

## 方式一：手动上传（推荐）

### 步骤：

1. **打开发布页面**
   ```
   https://github.com/FaustDream/SyncDock/releases/new
   ```

2. **填写信息**
   - Choose a tag: `v1.0.0` (选择已存在的标签)
   - Release title: `SyncDock v1.0.0`

3. **编写说明**
   ```markdown
   ## SyncDock v1.0.0 首个正式版本

   ### 功能特性
   - 多 Git 仓库批量同步
   - 智能状态检测与可视化
   - 定时自动同步
   - 分组管理
   - 中英文支持

   ### 下载说明
   | 文件 | 说明 |
   |------|------|
   | `SyncDock_1.0.0_x64-setup.exe` | 安装版，双击安装 |
   | `SyncDock.exe` | 便携版，解压即用 |

   ### 系统要求
   - Windows 10 1809+ 或 Windows 11
   - Microsoft Edge WebView2 运行时

   ### 更新日志
   - 首个正式发布版本
   ```

4. **上传文件**
   从 `Releases\v1.0.0` 目录上传：
   - `安装版\SyncDock_1.0.0_x64-setup.exe`
   - `便携版\SyncDock.exe`
   - `便携版\README.txt`

5. **点击 "Publish release"**

---

## 方式二：使用 GitHub CLI

### 安装 GitHub CLI
```powershell
winget install GitHub.cli
# 或下载: https://cli.github.com/
```

### 登录并上传
```powershell
# 登录 GitHub
gh auth login

# 创建 Release 并上传文件
gh release create v1.0.0 ^
    "Releases\v1.0.0\安装版\SyncDock_1.0.0_x64-setup.exe" ^
    "Releases\v1.0.0\便携版\SyncDock.exe" ^
    --title "SyncDock v1.0.0" ^
    --notes-file RELEASE_NOTES.md
```

---

## 文件位置

```
E:\gitHub\SyncDock\Releases\v1.0.0\
├── 安装版\
│   └── SyncDock_1.0.0_x64-setup.exe    (1.52 MB)
└── 便携版\
    ├── SyncDock.exe                     (5.20 MB)
    └── README.txt
```

---

## 快速链接

- 仓库地址: https://github.com/FaustDream/SyncDock
- 创建发布: https://github.com/FaustDream/SyncDock/releases/new
- 查看标签: https://github.com/FaustDream/SyncDock/tags
