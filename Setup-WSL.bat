@echo off
setlocal
title Qibox WSL Setup
cd /d "%~dp0"
where.exe node.exe >nul 2>&1
if errorlevel 1 (
    echo Install Node.js 24 for Windows, then run this file again.
    pause
    exit /b 1
)
node.exe "%~dp0src\cli.mjs" setup
set "setupExit=%errorlevel%"
pause
exit /b %setupExit%
