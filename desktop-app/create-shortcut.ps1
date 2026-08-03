# JaceCanvas - 桌面快捷方式创建工具
# 此脚本将在桌面创建启动快捷方式

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  JaceCanvas - 桌面快捷方式创建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取当前脚本目录（桌面应用目录）
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "应用目录: $AppDir" -ForegroundColor Gray

# 获取桌面路径
$DesktopPath = [Environment]::GetFolderPath("Desktop")
Write-Host "桌面路径: $DesktopPath" -ForegroundColor Gray

# 搜索可执行文件
$ExePath = $null

# 1. 先检查 release 目录中的安装版
$ReleaseDir = Join-Path $AppDir "release-v3.11.8"
if (Test-Path $ReleaseDir) {
        $ExeFiles = Get-ChildItem -Path $ReleaseDir -Recurse -Filter "JaceCanvas.exe" -ErrorAction SilentlyContinue
    if ($ExeFiles) {
        $ExePath = $ExeFiles[0].FullName
    }
}

# 2. 检查 win-unpacked 目录
if (-not $ExePath) {
    $UnpackedDir = Join-Path $ReleaseDir "win-unpacked"
    if (Test-Path $UnpackedDir) {
        $ExeFiles = Get-ChildItem -Path $UnpackedDir -Filter "*.exe" -ErrorAction SilentlyContinue
        if ($ExeFiles) {
            $ExePath = $ExeFiles[0].FullName
        }
    }
}

if (-not $ExePath) {
    Write-Host ""
    Write-Host "❌ 未找到打包好的应用程序！" -ForegroundColor Red
    Write-Host ""
    Write-Host "请先运行 build-desktop.bat 完成打包，或者使用快速启动模式。" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "是否需要创建快速启动模式的快捷方式？(使用 npx electron)" -ForegroundColor Yellow
    Write-Host "  [1] 是 - 创建快速启动快捷方式" -ForegroundColor White
    Write-Host "  [2] 否 - 退出" -ForegroundColor White
    
    $choice = Read-Host "请选择 (1/2)"
    if ($choice -eq "1") {
        # 开发目录没有正式安装包时，直接指向 Electron，避免 BAT 的命令行解析问题。
        $ElectronPath = Join-Path $AppDir "node_modules\electron\dist\electron.exe"
        if (-not (Test-Path $ElectronPath)) {
            Write-Host "❌ 未找到 Electron 可执行文件" -ForegroundColor Red
            Read-Host "按任意键退出"
            exit 1
        }
        
        $ShortcutPath = Join-Path $DesktopPath "JaceCanvas.lnk"
        $WScriptShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
        $Shortcut.TargetPath = $ElectronPath
        $Shortcut.Arguments = "--disable-gpu `"$AppDir`""
        $Shortcut.WorkingDirectory = $AppDir
        $Shortcut.Description = "JaceCanvas - AI image and video canvas"
        
        # 设置图标
        $IconPath = Join-Path $AppDir "assets\icon1.ico"
        if (Test-Path $IconPath) {
            $Shortcut.IconLocation = $IconPath
        }
        
        $Shortcut.Save()
        
        Write-Host ""
        Write-Host "✅ 快捷方式已创建（快速启动模式）！" -ForegroundColor Green
Write-Host "   位置: $ShortcutPath" -ForegroundColor Green
        Write-Host ""
        Write-Host "注意: 每次启动会自动检查并安装依赖" -ForegroundColor Yellow
        Read-Host "按任意键退出"
        exit 0
    } else {
        exit 0
    }
}

# 找到可执行文件 - 创建快捷方式
Write-Host ""
Write-Host "找到应用程序: $ExePath" -ForegroundColor Green

# 图标路径
$IconPath = Join-Path $AppDir "assets\icon1.ico"
if (-not (Test-Path $IconPath)) {
    $IconPath = $ExePath  # 使用 exe 自带的图标
}

# 创建快捷方式
$ShortcutPath = Join-Path $DesktopPath "JaceCanvas.lnk"
$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ExePath
$Shortcut.WorkingDirectory = Split-Path -Parent $ExePath
$Shortcut.Description = "JaceCanvas - AI image and video canvas"
$Shortcut.IconLocation = "$IconPath,0"
$Shortcut.WindowStyle = 1  # 正常窗口

$Shortcut.Save()

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ 桌面快捷方式创建成功！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "快捷方式位置: $ShortcutPath" -ForegroundColor White
Write-Host "应用位置:     $ExePath" -ForegroundColor Gray
Write-Host ""
Write-Host "双击桌面上的 'JaceCanvas' 图标即可启动应用。" -ForegroundColor Yellow
Write-Host ""
Write-Host "GPU 加速已自动启用，应用会使用本机显卡进行渲染。" -ForegroundColor Cyan
Write-Host ""

Read-Host "按任意键退出"
