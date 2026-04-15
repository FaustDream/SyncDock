@echo off
setlocal
cd /d "%~dp0"
py -3 -m syncdock.main --silent
endlocal
