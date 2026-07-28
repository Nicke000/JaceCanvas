@echo off
chcp 65001 >nul
setlocal
title AI无限画布 - 桌面端快速设置
cd /d "%~dp0"

echo ============================================
echo   AI 无限画布 - 桌面端快速设置
echo   不修改网页版源码和网页版 dist
echo ============================================
echo.

if not exist "src\main.tsx" (
  echo ❌ 缺少桌面端源码，请检查 desktop-app\src
  pause
  exit /b 1
)

echo [1/3] 安装桌面端依赖...
call npm install --prefer-offline
if errorlevel 1 (
  echo ❌ 依赖安装失败
  pause
  exit /b 1
)

echo [2/3] 构建桌面端前端...
call npm run build:web
if errorlevel 1 (
  echo ❌ 前端构建失败
  pause
  exit /b 1
)

echo [3/3] 准备快捷启动...
echo ✅ 设置完成。现在可以双击桌面快捷方式启动。
pause