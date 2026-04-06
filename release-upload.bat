@echo off
chcp 65001 >nul
echo ========================================
echo   SyncDock v1.0.0 GitHub Release 上传
echo ========================================
echo.

REM 检查是否安装了 GitHub CLI
where gh >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [方式1] 使用 GitHub CLI 上传...
    echo.
    
    REM 创建 tag
    git tag v1.0.0
    git push origin v1.0.0
    
    REM 创建 Release
    gh release create v1.0.0 ^
        "Releases\v1.0.0\安装版\SyncDock_1.0.0_x64-setup.exe" ^
        "Releases\v1.0.0\便携版\SyncDock.exe" ^
        "Releases\v1.0.0\便携版\README.txt" ^
        --title "SyncDock v1.0.0" ^
        --notes "## SyncDock v1.0.0 首个正式版本

### 功能特性
- 多 Git 仓库批量同步
- 智能状态检测与可视化
- 定时自动同步
- 分组管理
- 中英文支持

### 下载说明
- **安装版**: 双击安装，支持开机自启
- **便携版**: 解压即用，需安装 WebView2 运行时

### 系统要求
- Windows 10 1809+ 或 Windows 11
- Microsoft Edge WebView2 运行时"
    
    echo.
    echo Release 创建成功！
    pause
    exit /b 0
)

echo [方式2] GitHub CLI 未安装，请手动上传
echo.
echo 步骤：
echo 1. 打开浏览器访问：
echo    https://github.com/FaustDream/SyncDock/releases/new
echo.
echo 2. 填写信息：
echo    - Tag: v1.0.0
echo    - Title: SyncDock v1.0.0
echo.
echo 3. 上传以下文件：
echo    - 安装版\SyncDock_1.0.0_x64-setup.exe
echo    - 便携版\SyncDock.exe
echo    - 便携版\README.txt
echo.
echo 4. 点击 "Publish release"
echo.

REM 打开发布页面
start https://github.com/FaustDream/SyncDock/releases/new

REM 打开本地文件目录
explorer "Releases\v1.0.0"

pause
