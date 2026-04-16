@echo off
setlocal
cd /d "%~dp0"
py -3 -m syncdock.main --silent
set "exit_code=%errorlevel%"
if not "%exit_code%"=="0" (
    pause
)
endlocal & exit /b %exit_code%
