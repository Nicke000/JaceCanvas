@echo off
chcp 65001 >nul
setlocal
title AI无限画布 - 桌面端构建
cd /d "%~dp0"

echo ============================================
echo   AI 无限画布 - 桌面端构建
echo   仅使用 desktop-app 专用源码，不修改网页版
echo ============================================
echo.

echo [1/4] 构建桌面端前端...
call npm run build:web
if errorlevel 1 (
  echo ❌ 桌面端前端构建失败
  pause
  exit /b 1
)

echo.
echo [2/4] 构建后端...
pushd "%~dp0..\server"
if not exist "node_modules\.bin\tsc.cmd" (
  echo 正在安装后端依赖...
  call npm install --include=dev
  if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 (
  echo ❌ 后端构建失败
  popd
  pause
  exit /b 1
)
popd

echo.
echo [3/4] 更新桌面端内嵌后端和图标...
if exist "%~dp0server" rmdir /s /q "%~dp0server"
xcopy /e /i /y "%~dp0..\server\dist\*" "%~dp0server\" >nul
if exist "%~dp0..\server\data" xcopy /e /i /y "%~dp0..\server\data\*" "%~dp0server\data\" >nul 2>&1
if not exist "%~dp0assets" mkdir "%~dp0assets"
copy /y "%~dp0..\icon1.ico" "%~dp0assets\icon1.ico" >nul

echo.
echo [4/4] 生成 Windows 安装包...
call npx electron-builder --win --x64
if errorlevel 1 (
  echo ❌ 安装包构建失败
  pause
  exit /b 1
)

echo.
echo   输出目录：%~dp0release-v4.6.8
pause