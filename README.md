# JaceCanvas

> Electron + React + Vite 的 AI 无限画布与导演工作台。画布、节点运行时、主控 API 适配和本地项目数据服务均面向开发者开放。

[![License: MIT](https://img.shields.io/badge/source%20license-MIT-green.svg)](./LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue.svg)](#系统要求) [![Video2X](https://img.shields.io/badge/Video2X-open--source%20local%20bundle-cyan.svg)](./THIRD_PARTY_NOTICES.md)

<p align="center">
  <a href="https://github.com/Nicke000/JaceCanvas"><img src="https://img.shields.io/badge/源码-GitHub-181717?logo=github" alt="GitHub 源码"></a>
  <a href="./安装说明.md"><img src="https://img.shields.io/badge/安装版-Windows%20x64-0078D4?logo=windows" alt="Windows 安装说明"></a>
  <a href="./开源使用说明.md"><img src="https://img.shields.io/badge/本地开发-配置说明-2ea44f?logo=visualstudiocode" alt="本地开发配置说明"></a>
  <a href="./THIRD_PARTY_NOTICES.md"><img src="https://img.shields.io/badge/第三方组件-许可证-6f42c1" alt="第三方组件许可证"></a>
</p>

> **JaceCanvas** 是面向 AI 创作的无限画布与导演工作台：把工作流节点、远程 GPU 主控、视频处理和 3D 分镜工具放在一个可扩展的 Windows 桌面应用中。

### 快速入口

| 入口 | 适合谁 | 内容 |
|---|---|---|
| [Windows 安装说明](./安装说明.md) | 普通用户 | 安装、首次配置、主控连接和故障排查 |
| [本地开发与打包说明](./开源使用说明.md) | 开发者 | 源码运行、API 配置、SSH 性能检测和构建安装包 |
| [第三方组件说明](./THIRD_PARTY_NOTICES.md) | 发布者 | Video2X、FFmpeg、模型和运行库的许可证边界 |
| [贡献指南](./CONTRIBUTING.md) | 贡献者 | Issue、Pull Request 和衍生版本规范 |

### 联系我们

<p>
  <a href="https://www.facebook.com/share/1C2aPnT9N3/?mibextid=wwXIfr"><img src="https://img.shields.io/badge/Facebook-联系我们-1877F2?logo=facebook&logoColor=white" alt="Facebook 联系我们"></a>
  <a href="mailto:mikesill701@gmail.com"><img src="https://img.shields.io/badge/Email-mikesill701%40gmail.com-EA4335?logo=gmail&logoColor=white" alt="Gmail 联系我们"></a>
  <a href="mailto:qiangzh49@outlook.com"><img src="https://img.shields.io/badge/Email-qiangzh49%40outlook.com-0078D4?logo=microsoftoutlook&logoColor=white" alt="Outlook 联系我们"></a>
</p>

反馈问题时请说明系统版本、应用版本、复现步骤和错误截图；不要公开 API Key、SSH 密码、个人主控地址或数据库文件。

## 页面与功能

- **无限画布**：拖拽、连线、分组、预览、历史记录和项目本地保存。
- **动态工作流节点**：从用户自己的主控读取工作流目录和参数，不绑定某一台服务器或私有模型。
- **视频工作流**：视频生成、视频剪辑、媒体预览和结果连接。
- **Video2X 本地节点**：视频超分、补帧或超分+补帧；支持 RealESRGAN、RealCUGAN、RIFE。该节点显示“开源本地模型”提示，可能不适配所有电脑。
- **StoryAI 3D 导演台**：对象树、角色姿势、镜头构图、模型/全景导入和截图回传画布。
- **桌面体验**：Electron 独立窗口、GPU/WebGL 加速、内嵌本地服务、崩溃恢复和 Windows 安装包。

## 快速开始

```powershell
cd .\desktop-app
npm install
cd ..\server
npm install
npm run build
cd ..\desktop-app
New-Item -ItemType Directory -Force server | Out-Null
Copy-Item ..\server\dist\* server -Recurse -Force
npm run build:web
npm start
```

Windows x64 安装包：

```powershell
cd .\desktop-app
.\build-desktop.bat
```

完整配置、主控 API、Video2X 节点和构建细节见 [`开源使用说明.md`](./开源使用说明.md)。安装版说明见 [`安装说明.md`](./安装说明.md)。

## 配置概览

### 安装版

安装后打开设置，填写自己的主控 API 根地址和可选 API Key；主控服务负责提供工作流目录、节点参数和生成任务。需要远程性能监控时，再填写 SSH 主机、端口、用户名和密码。SSH 密码只保存在本机安全存储中，不要写入 README、Issue 或截图。

### 本地开发版

本地开发版需要 Node.js 18+、npm、桌面端依赖和 server 依赖；先构建 `server`，再构建 `desktop-app`。提示词优化器配置请从 `desktop-app/config/prompt-settings.example.json` 复制为本机文件，API Key 只放在本机配置中。完整命令和主控接口要求见 [`开源使用说明.md`](./开源使用说明.md)。

### 性能检测

SSH 性能检测由桌面端本机启动 Python + Paramiko，再连接远程 Linux 服务器执行只读性能命令。Windows 用户需要安装 Python 3.x，并执行 `python -m pip install paramiko`；如果系统使用 `py.exe` 启动器，应用也会自动尝试识别。服务器端应具备 SSH 权限以及可选的 `nvidia-smi`、`top`、`free`、`df` 命令。

## Video2X 超分/补帧节点

节点代码属于 JaceCanvas 画布适配层，可按本项目源码许可证修改和二次开发；Video2X 程序、模型、FFmpeg 和相关依赖仍受各自上游协议约束。来源、版权、许可证边界和分发方式见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

仓库默认不提交约 394 MB 的第三方运行时和模型。若要本地打包，请按说明将经过许可证审核的 Video2X Qt6 目录放入 `desktop-app/assets/video2x/`；不要从不明来源下载或将第三方模型误标为 JaceCanvas 自有模型。

## 开放画布二次开发

在遵守 [`LICENSE`](./LICENSE) 和第三方许可证的前提下，任何人都可以：

- 修改画布 UI、节点组件、导演台、存储和主控适配器；
- 创建自己的节点、工作流适配器和画布模板；
- 将修改后的画布用于个人、研究或商业项目，并按许可证保留版权/许可声明；
- 提交 Issue、Pull Request 或维护自己的发行版。

## 系统要求

- Windows 10/11 64 位；
- Node.js 18+，推荐 Node.js 20 LTS；
- 8 GB 内存，使用本地 Video2X 建议 16 GB+；
- 支持 WebGL 2.0 的显卡；Video2X 还需要兼容 Vulkan 的 GPU 和相应驱动。

## 安全与隐私

仓库不应包含 API Key、SSH 密码、个人主控地址、数据库、日志、个人工作流或上传素材。你提供的 GitHub 登录密码不会写入项目，也不应放进 Issue、README、脚本或 Git remote URL；请使用 GitHub Personal Access Token 或 SSH key。

## 贡献与安全报告

- 贡献流程：[`CONTRIBUTING.md`](./CONTRIBUTING.md)
- 安全问题：[`SECURITY.md`](./SECURITY.md)
- GitHub 页面/功能发布模板：[`docs/GITHUB_RELEASE.md`](./docs/GITHUB_RELEASE.md)

## 许可证

JaceCanvas 自有源码按 MIT License 发布。第三方依赖、运行时、模型、启动视频和图标不自动继承 MIT，必须分别遵守其许可证和版权声明。详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。
