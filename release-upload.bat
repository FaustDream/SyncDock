@echo off
chcp 65001 >nul
setlocal

set VERSION=2.0.0
set RELEASE_ROOT=Releases\v%VERSION%

echo ========================================
echo   SyncDock v%VERSION% Release Upload
echo ========================================
echo.

where gh >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo GitHub CLI not found. Please upload files manually.
  echo Release files:
  echo   %RELEASE_ROOT%\installer
  echo   %RELEASE_ROOT%\SyncDock_%VERSION%_x64_portable.zip
  exit /b 0
)

gh release create v%VERSION% ^
  "%RELEASE_ROOT%\installer\*" ^
  "%RELEASE_ROOT%\SyncDock_%VERSION%_x64_portable.zip" ^
  --title "SyncDock v%VERSION%" ^
  --notes "SyncDock v%VERSION% Windows release package."

endlocal
