@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在创建桌面快捷方式...
powershell -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
pause
