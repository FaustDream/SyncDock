@echo off
chcp 65001 >nul
setlocal

set VERSION=2.0.0
set RELEASE_ROOT=Releases\v%VERSION%
set INSTALLER_DIR=%RELEASE_ROOT%\installer
set PORTABLE_DIR=%RELEASE_ROOT%\portable
set PORTABLE_NAME=SyncDock_%VERSION%_x64_portable.zip

echo ========================================
echo   SyncDock v%VERSION% Release Build
echo ========================================
echo.

if exist "dist" rmdir /s /q "dist"
if exist "src-tauri\target" rmdir /s /q "src-tauri\target"

if exist "%INSTALLER_DIR%" rmdir /s /q "%INSTALLER_DIR%"
if exist "%PORTABLE_DIR%" rmdir /s /q "%PORTABLE_DIR%"
if not exist "%INSTALLER_DIR%" mkdir "%INSTALLER_DIR%"
if not exist "%PORTABLE_DIR%" mkdir "%PORTABLE_DIR%"

echo [1/4] Building desktop application...
call npm run tauri build
if %ERRORLEVEL% neq 0 exit /b 1

echo [2/4] Copying installer package...
for %%f in (src-tauri\target\release\bundle\nsis\*.exe) do copy "%%f" "%INSTALLER_DIR%\" >nul

echo [3/4] Preparing portable package...
if exist "src-tauri\target\release\SyncDock.exe" (
  copy "src-tauri\target\release\SyncDock.exe" "%PORTABLE_DIR%\SyncDock.exe" >nul
) else (
  copy "src-tauri\target\release\syncdock-desktop.exe" "%PORTABLE_DIR%\SyncDock.exe" >nul
)
(
echo SyncDock v%VERSION% portable package
echo.
echo 1. Ensure Microsoft Edge WebView2 Runtime is installed.
echo 2. Run SyncDock.exe directly.
echo 3. User data is stored in the local application data directory.
) > "%PORTABLE_DIR%\README.txt"

powershell -NoProfile -Command "if (Test-Path '%RELEASE_ROOT%\%PORTABLE_NAME%') { Remove-Item '%RELEASE_ROOT%\%PORTABLE_NAME%' -Force }; Compress-Archive -Path '%PORTABLE_DIR%\*' -DestinationPath '%RELEASE_ROOT%\%PORTABLE_NAME%' -Force"
if %ERRORLEVEL% neq 0 exit /b 1

echo [4/4] Release build completed.
echo Installer: %INSTALLER_DIR%
echo Portable: %RELEASE_ROOT%\%PORTABLE_NAME%
echo.

endlocal
