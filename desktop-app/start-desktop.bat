@echo off
chcp 65001 >nul
title AI无限画布 - 启动中...
cd /d "%~dp0"

echo.
echo ============================================
echo   🎨 AI 无限画布 - 桌面应用
echo ============================================
echo.

:: 检查必要文件
if not exist "dist\index.html" (
    echo ❌ 缺少前端文件 (dist\index.html)
    echo 请先运行 setup-quick.bat 或 build-desktop.bat
    pause
    exit /b 1
)

:: 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Node.js，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查并自动安装 Electron
if not exist "node_modules\electron\dist\electron.exe" (
    echo ⚠️ Electron 尚未安装，正在自动安装（约180MB，首次需要3-5分钟）...
    echo.
    call npm install
    if errorlevel 1 (
        echo ❌ 安装失败，请检查网络连接
        pause
        exit /b 1
    )
    echo ✅ Electron 安装完成！
    echo.
)

echo 🚀 正在启动 AI无限画布...
echo 💡 当前使用软件渲染模式，优先保证窗口稳定启动
echo.

:: 启动 Electron
if not exist "node_modules\electron\dist\electron.exe" (
    echo ❌ 找不到 Electron 可执行文件
    pause
    exit /b 1
)
start "AI无限画布" /b "%~dp0node_modules\electron\dist\electron.exe" --disable-gpu "%~dp0" 1>>"%~dp0desktop-launch.log" 2>>"%~dp0desktop-launch-error.log"

if errorlevel 1 (
    echo.
    echo ============================================
    echo   ⚠️ 应用已退出
    echo ============================================
    echo.
    echo 如果遇到问题，请检查:
    echo   1. 显卡驱动是否最新
    echo   2. 是否在 NVIDIA 控制面板中设置了高性能模式
    echo   3. 查看上方错误信息
    echo.
    pause
)

exit /b 0

