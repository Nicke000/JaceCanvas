# JaceCanvas - 桌面应用程序

> 将 AI 无限画布网页应用打包为 Windows 桌面应用程序，支持 GPU 硬件加速。

---

## 📋 目录

- [功能特点](#功能特点)
- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [构建打包](#构建打包)
- [桌面快捷方式](#桌面快捷方式)
- [GPU 加速说明](#gpu-加速说明)
- [目录结构](#目录结构)
- [常见问题](#常见问题)
- [开源与动态节点](#开源与动态节点)

---

## ✨ 功能特点

| 功能 | 说明 |
|------|------|
| 🚀 **GPU 硬件加速** | 自动启用本机显卡加速 (WebGL/WebGPU/视频编解码) |
| 🛡️ **崩溃防护** | 渲染进程崩溃自动恢复（最多3次），异常全局捕获 |
| 📦 **独立运行** | 无需浏览器，双击即可运行，内嵌后端服务 |
| 🖥️ **原生体验** | 独立窗口、桌面快捷方式、开始菜单集成 |
| 🔒 **安全隔离** | contextIsolation + preload 沙箱安全模式 |

---

## 💻 系统要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 操作系统 | Windows 10 (64位) | Windows 11 |
| 内存 | 8 GB | 16 GB+ |
| 显卡 | 支持 WebGL 2.0 | NVIDIA GTX 1060+ / AMD RX580+ |
| 磁盘空间 | 1 GB | 5 GB+ (含缓存) |
| Node.js | v18+ | v20 LTS |

---

## 🚀 快速开始

### 方式一：快速测试（推荐先用这个验证）

```batch
# 双击运行
start-desktop.bat
```

这会使用 Electron 直接加载应用，无需完整打包。

### 方式二：完整打包为安装程序

```batch
# 双击运行（需要5-10分钟）
build-desktop.bat
```

完成后在 `release/` 目录中会生成安装程序 `AI无限画布 Setup x.x.x.exe`。

---

## 📦 构建打包

### 构建流程说明

`build-desktop.bat` 脚本会自动完成以下步骤：

```
步骤 1/5: 构建前端 (Vite)
  └─ 编译 React/TypeScript → web/dist/

步骤 2/5: 构建后端 (TypeScript)  
  └─ 编译 Express 服务器 → server/dist/

步骤 3/5: 复制构建产物
  ├─ web/dist/ → desktop-app/dist/
  ├─ server/dist/ → desktop-app/server/
   └─ icon1.ico → desktop-app/assets/

步骤 4/5: 安装 Electron 依赖
  └─ npm install electron electron-builder

步骤 5/5: 打包 Windows 应用
  └─ electron-builder → release/AI无限画布 Setup.exe
```

### 前置条件

在运行构建之前，确保以下目录已安装依赖：

```batch
# 在项目根目录
cd E:\AIhuabu
npm run install:all
```

### 手动构建

如果需要手动控制构建过程：

```powershell
# 1. 构建前端
cd web
npx vite build

# 2. 构建后端
cd ..\server
npx tsc

# 3. 复制文件到 desktop-app
# 手动复制 web/dist → desktop-app/dist
# 手动复制 server/dist → desktop-app/server

# 4. 安装和打包
cd ..\desktop-app
npm install
npx electron-builder --win
```

---

## 🔗 桌面快捷方式

### 自动创建

```batch
# 双击运行
create-shortcut.bat
```

或在 PowerShell 中手动运行：

```powershell
.\create-shortcut.ps1
```

### 手动创建

1. 右键桌面 → 新建 → 快捷方式
2. 浏览到 `release\win-unpacked\AI无限画布.exe`
3. 命名为 "AI无限画布"
4. （可选）右键快捷方式 → 属性 → 更改图标

### 快捷方式类型

| 类型 | 说明 |
|------|------|
| 安装版 | 指向安装后的 `AI无限画布.exe` |
| 快速启动版 | 指向 `start-desktop.bat`，适合开发测试 |

---

## 🔥 GPU 加速说明

### 已启用的 GPU 加速功能

桌面应用已在 Electron 主进程中配置以下 Chromium GPU 开关：

| 开关 | 作用 |
|------|------|
| `enable-gpu-rasterization` | GPU 光栅化渲染 |
| `enable-zero-copy` | 零拷贝纹理传输 |
| `ignore-gpu-blacklist` | 跳过 GPU 黑名单检查 |
| `enable-accelerated-video-decode` | 硬件视频解码 |
| `enable-accelerated-video-encode` | 硬件视频编码 |
| `enable-webgl` / `enable-webgl2` | WebGL 图形加速 |
| `enable-unsafe-webgpu` | WebGPU 支持 |
| `force_high_performance_gpu` | 强制使用高性能独显 |
| `disable-gpu-sandbox` | 提升 GPU 访问性能 |

### 验证 GPU 加速

1. 启动桌面应用
2. 查看控制台输出，会显示 GPU 设备信息
3. 或在应用中打开开发者工具 (Ctrl+Shift+I)，在 Console 中输入：
   ```javascript
   // 检查 WebGL
   document.createElement('canvas').getContext('webgl2')
   
   // 检查 GPU 信息
   navigator.gpu  // WebGPU 支持
   ```

### 故障排除

如果遇到 GPU 相关问题：

1. **更新显卡驱动**到最新版本
2. **切换显卡**：在 NVIDIA 控制面板中将应用设置为"高性能 NVIDIA 处理器"
3. **禁用问题开关**：如果崩溃，移除 `disable-gpu-sandbox` 开关
4. **使用软件渲染**（性能较低）：
   - 在 `main.js` 中注释掉 GPU 开关
   - 或添加 `app.commandLine.appendSwitch('disable-gpu')`

---

## 📁 目录结构

```
desktop-app/
├── main.js                  # Electron 主进程（GPU加速+崩溃防护）
├── preload.js               # 预加载脚本（安全桥接）
├── package.json             # 桌面应用配置 + electron-builder
├── build-desktop.bat        # 🔧 一键构建打包脚本
├── start-desktop.bat        # 🚀 快速启动脚本（测试用）
├── create-shortcut.bat      # 🔗 桌面快捷方式创建
├── create-shortcut.ps1      # PowerShell 快捷方式脚本
├── README.md                # 📖 本文档
├── assets/
│   └── icon1.ico             # 应用图标
├── dist/                    # 前端构建产物（从 web/dist 复制）
│   ├── index.html
│   └── assets/
├── server/                  # 后端构建产物（从 server/dist 复制）
│   ├── index.js
│   ├── db/
│   ├── routes/
│   └── services/
├── node_modules/            # Electron 等依赖
└── release/                 # 📦 打包输出目录
    └── AI无限画布 Setup x.x.x.exe
```

---

## ❓ 常见问题

### Q: 双击应用没反应？
**A:** 先运行 `start-desktop.bat` 查看控制台错误信息。常见原因：
- 缺少 `dist/` 目录 → 运行 `build-desktop.bat`
- Electron 未安装 → 自动安装或手动 `npm install`

### Q: 应用崩溃/闪退？
**A:** 应用内置崩溃恢复机制，会自动尝试恢复最多3次。如果持续崩溃：
1. 更新显卡驱动
2. 尝试在 `main.js` 中移除 `disable-gpu-sandbox` 行
3. 检查系统内存是否充足

### Q: GPU 加速没有生效？
**A:** 
1. 检查是否有独立显卡（集成显卡也能加速，但效果有限）
2. 更新显卡驱动到最新版本
3. 在 NVIDIA 控制面板 / AMD Adrenalin 中将应用设为高性能模式

### Q: API 连接失败？
**A:** 桌面应用与网页版使用相同的远程 API 地址，请确保：
- 在设置中配置了正确的 API 地址
- 网络可以访问远程 GPU 服务器
- API 密钥已正确配置

## 🔌 开源与动态节点

JaceCanvas 的工作流节点由用户配置的主控平台动态提供，不同用户的节点数量、名称、参数和模型可以不同。应用启动后会优先读取主控的工作流目录；添加节点时再读取该工作流的最新参数配置，因此公共源码不需要也不应该包含某个用户的私有节点清单。

节点流程如下：

1. 请求主控的 `GET /api/workflow/list` 获取工作流目录。
2. 添加工作流时请求 `GET /api/workflow/config/{workflow_id}` 获取参数和默认值。
3. 生成时提交 `workflow_id`、动态参数以及画布上游节点的媒体输入。

`src/config` 下的工作流目录和参数文件只是离线兜底，用于旧画布兼容和开发调试；在线主控可用时，以主控返回内容为准。开源时请不要提交 API Key、SSH 密码、个人主控地址、私有工作流 JSON、数据库或调试文档。详细说明见 [`OPEN_SOURCE_GUIDE.md`](./OPEN_SOURCE_GUIDE.md)，配置模板见 [`config/prompt-settings.example.json`](./config/prompt-settings.example.json)。

主控至少需要兼容以下接口：

```text
GET  /api/workflow/list
GET  /api/workflow/config/{id}
POST /api/workflow/generate
GET  /api/workflow/result?prompt_id=...
POST /api/comfy/upload/file
```

### Q: 数据和设置保存在哪里？
**A:** 
- 前端设置(API地址等): Electron 的 localStorage（`%APPDATA%/AI无限画布/`）
- 画布数据: 本地 SQLite 数据库（`server/data/canvas.db`）

### Q: 如何卸载？
**A:** 
- 如果使用了安装程序：通过"控制面板 → 程序和功能"卸载
- 如果使用快速启动模式：直接删除 `desktop-app` 文件夹

### Q: 能在 macOS/Linux 上运行吗？
**A:** 当前配置仅支持 Windows。如需其他平台：
- 修改 `package.json` 中的 `build` 配置
- 添加 `mac` 和 `linux` 构建目标

---

## 📝 更新日志

### v1.0.0 (2026-07)
- ✅ 初始桌面版本
- ✅ GPU 硬件加速支持
- ✅ 崩溃自动恢复
- ✅ 内嵌后端服务
- ✅ 桌面快捷方式

---

## 📄 许可证

MIT License

---

**如有问题，请查看控制台输出的错误信息进行排查。**
