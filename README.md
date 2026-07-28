# JaceCanvas

> Electron + React + Vite 的 AI 无限画布与导演工作台。画布、节点运行时、主控 API 适配和本地项目数据服务均面向开发者开放。

[![License: MIT](https://img.shields.io/badge/source%20license-MIT-green.svg)](./LICENSE) [![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue.svg)](#系统要求) [![Video2X](https://img.shields.io/badge/Video2X-open--source%20local%20bundle-cyan.svg)](./THIRD_PARTY_NOTICES.md)

## 页面与功能

- **无限画布**：拖拽、连线、分组、预览、历史记录和项目本地保存。
- **动态工作流节点**：从用户自己的主控读取工作流目录和参数，不绑定某一台服务器或私有模型。
- **视频工作流**：视频生成、视频剪辑、媒体预览和结果连接。
- **Video2X 本地节点**：视频超分、补帧或超分+补帧；支持 RealESRGAN、RealCUGAN、RIFE。该节点显示“开源本地模型”提示，可能不适配所有电脑。
- **StoryAI 3D 导演台**：对象树、角色姿势、镜头构图、模型/全景导入和截图回传画布。
- **启动动画**：黑底 2560×1440、60fps Logo 视频，约 7 秒后渐隐，主界面在动画期间后台加载。
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
