@echo off
chcp 65001 >nul
echo ========================================
echo   SyncDock v1.0.0 打包脚本
echo ========================================
echo.

REM 设置版本号
set VERSION=1.0.0
set RELEASE_DIR=Releases\v%VERSION%

REM 创建发布目录
echo [1/4] 创建发布目录...
if not exist "%RELEASE_DIR%\安装版" mkdir "%RELEASE_DIR%\安装版"
if not exist "%RELEASE_DIR%\便携版" mkdir "%RELEASE_DIR%\便携版"

REM 执行 Tauri 构建
echo [2/4] 执行 Tauri 构建（这可能需要几分钟）...
call npm run tauri build

if %ERRORLEVEL% neq 0 (
    echo 构建失败！
    pause
    exit /b 1
)

echo [3/4] 整理安装版文件...
REM 复制 NSIS 安装包到安装版目录
for %%f in (src-tauri\target\release\bundle\nsis\*.exe) do (
    copy "%%f" "%RELEASE_DIR%\安装版\" >nul
    echo   - %%~nxf
)

echo [4/4] 整理便携版文件...
REM 复制编译后的 exe 文件作为便携版
copy "src-tauri\target\release\syncdock-desktop.exe" "%RELEASE_DIR%\便携版\SyncDock.exe" >nul
echo   - SyncDock.exe（便携版，需安装 WebView2）

REM 创建便携版说明文件
echo SyncDock v%VERSION% 便携版 > "%RELEASE_DIR%\便携版\README.txt"
echo. >> "%RELEASE_DIR%\便携版\README.txt"
echo 使用说明： >> "%RELEASE_DIR%\便携版\README.txt"
echo 1. 确保已安装 Microsoft Edge WebView2 运行时 >> "%RELEASE_DIR%\便携版\README.txt"
echo 2. 双击 SyncDock.exe 即可运行 >> "%RELEASE_DIR%\便携版\README.txt"
echo 3. 数据存储在 %%USERPROFILE%%\.syncdock 目录 >> "%RELEASE_DIR%\便携版\README.txt"
echo. >> "%RELEASE_DIR%\便携版\README.txt"
echo 下载 WebView2: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ >> "%RELEASE_DIR%\便携版\README.txt"

echo.
echo ========================================
echo   构建完成！
echo ========================================
echo.
echo 文件位置：
echo   安装版: %RELEASE_DIR%\安装版\
echo   便携版: %RELEASE_DIR%\便携版\
echo.

REM 打开发布目录
explorer "%RELEASE_DIR%"

pause
