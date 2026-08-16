# JaceCanvas - AI 创意画布桌面应用

> AI 无限画布 + 动态工作流节点的 Windows 桌面应用（Electron + React 19 + @xyflow/react）。
> 图像 / 视频 / 音频 / 3D 生成、短剧工作流、聊天助手、AI 改码，一站集成。

<p>
  <a href="https://github.com/Nicke000/JaceCanvas"><img src="https://img.shields.io/badge/Source-GitHub-181717?logo=github" alt="GitHub 源码"></a>
  <a href="mailto:mikesill701@gmail.com"><img src="https://img.shields.io/badge/Email-Contact-EA4335?logo=gmail&logoColor=white" alt="邮件联系"></a>
  <a href="https://www.facebook.com/share/1C2aPnT9N3/?mibextid=wwXIfr"><img src="https://img.shields.io/badge/Facebook-Contact-1877F2?logo=facebook&logoColor=white" alt="Facebook 联系我们"></a>
</p>

JaceCanvas 的工作流节点由你配置的**主控平台**动态提供（不同账号节点数量、名称、参数、模型可以完全不同），也支持本地 ComfyUI、多个厂商付费 API（文生图 / 图生图 / 文生视频 / 图生视频 / 配音等）以及纯本地生成。

---

## ✨ 功能特点

| 功能 | 说明 |
|------|------|
| 🎨 **无限画布** | 拖拽框选、多选对齐、备注、Frame 分组、快捷键、命令面板（Ctrl+K） |
| 🔌 **动态节点** | 节点库跟随服务器/主控平台动态加载，每个服务器独立缓存 |
| 💰 **付费 API 节点** | 火山、Flux、Fal、Google、OpenAI、MiniMax 等，文生图/图生图/视频/配音 |
| 🏠 **本地 ComfyUI** | 直接填 `http://127.0.0.1:8188` 即可作为一台服务器使用 |
| 🎬 **短剧工作室** | 剧本 → 分镜 → 图片 → 视频 → 配音 → 合成 六步流程，一键生成 |
| 💬 **AI 聊天** | 全窗口聊天 + 画布聊天节点，暖白简约编辑器，流式输出不卡顿 |
| 🤖 **DevAgent** | 画布内 AI 代码助手：改源码走沙盒安全模式（版本分支 + 构建校验） |
| 🌐 **多服务器** | 顶栏一键切换，每台服务器独立节点库/缓存/健康状态 |
| 📦 **三版本发布** | 纯开源 zip / 纯安装版 / 安装+内置开源版 |
| 🛡️ **可靠** | 自动保存 + 版本快照 + 崩溃恢复 + 崩溃日志 |
| 🗂️ **素材管理** | 自动保存生成素材到本地、自定义保存路径、按天数/大小自动清理、历史默认隐藏失败记录 |
| ⭐ **提示词库** | 顶部收藏常用提示词：置顶/排序/改名/删除，一键发送到画布 |
| 🎨 **多主题** | 13 套主题（9 深色 + 4 亮色：明亮白/暖白纸/薄荷青/蜜桃粉），容器全面适配 |
| ⚡ **性能优化** | GPU 轮询/进度回调节流、连线默认边常量、历史懒加载、拖线磁吸（48px） |
| 🔌 **负面提示词端口** | ComfyUI 工作流导入自动拆分正面/负面提示词两个输入口 |

---

## 💻 系统要求

| 项目 | 最低要求 | 推荐配置 |
|------|----------|----------|
| 操作系统 | Windows 10 (64位) | Windows 11 |
| 内存 | 8 GB | 16 GB+ |
| 显卡 | 支持 WebGL 2.0 | NVIDIA GTX 1060+ / AMD RX580+ |
| 磁盘空间 | 1 GB | 5 GB+（含缓存与素材） |
| Node.js | 仅**纯开源版**需要 v18+（安装版不需要） | v20 LTS |

---

## 🚀 快速开始（三个版本）

发布包提供三个版本，按需选择：

| 版本 | 内容 | 适合 |
|------|------|------|
| **纯安装版** `JaceCanvas Setup 4.7.1-pure.exe` | 应用本体（无内置源码） | 普通用户，体积小 |
| **安装+内置开源** `JaceCanvas Setup 4.7.1.exe` | 应用 + `resources/opensource` 完整源码（含 node_modules） | 需要应用内 DevAgent 改码的用户 |
| **纯开源** `JaceCanvas-4.7.1-opensource.zip` | 完整源码（不含 node_modules） | 开发者二次开发 |

安装版均为向导式安装（可选安装目录）。**安装版数据目录独立**（`%APPDATA%\JaceCanvas`），与开发版互不干扰，重装不残留旧数据；如需回到全新状态，设置 → 关于 →「清空所有本地数据」。

### 下载渠道

- **百度网盘（推荐，国内速度快）：** <https://pan.baidu.com/s/5W1UlxGpbdd8LN0MgGLB7yQ>
- **GitHub Releases：** <https://github.com/Nicke000/JaceCanvas/releases>

---

## 🏗️ 从源码构建

### 前置条件

- Node.js v18+（推荐 v20 LTS）
- 在 `desktop-app` 目录安装依赖：

```batch
cd desktop-app
npm install
```

### 构建打包

```batch
cd desktop-app
npm run build:web     # Vite 构建前端 → dist/
npm run build         # electron-builder → release-v4.7.1/（内置 opensource，方案 B）
```

- `npm run build` 会先自动生成 `opensource-resource`（完整源码 + node_modules）并作为 `resources/opensource` 打进安装包，安装版用户可用 DevAgent 改码。
- 纯安装版（不含开源）使用独立配置：`npx electron-builder --win nsis --config build.pure-install.json`（输出 `release-pure-install/`）。
- 开发调试（免打包）：`npm run dev` 或 `start-desktop.bat`。

---

## 🔌 服务器与主控平台

### 添加服务器

设置 → 服务器管理 → 添加服务器：

| 字段 | 说明 |
|------|------|
| 名称 | 任意名称（如「本地 ComfyUI」「主控」） |
| 服务器类型 | ComfyUI 直连 / 主控服务器（工作流 API）/ 自定义 |
| 地址 | 节点与生成请求使用的地址 |
| 性能检测地址（可选） | **主控服务器专用**：节点地址与性能检测地址不同时填第二个链接。例：节点填 `https://uu...westd.seetacloud.com:8443`（有节点），性能检测填 `https://u...westd.seetacloud.com:8443`（有性能数据） |
| API 密钥 | 有鉴权才需要 |

### 主控接口要求

| 接口 | 用途 |
|---|---|
| `GET /api/workflow/list` | 返回当前用户可用工作流目录 |
| `GET /api/workflow/config/{id}` | 返回工作流模板和动态参数 |
| `POST /api/workflow/generate` | 提交生成任务 |
| `GET /api/workflow/result?prompt_id=...` | 查询任务结果 |
| `POST /api/comfy/upload/file` | 上传图片、视频或音频 |

### 多服务器

顶栏服务器下拉可一键切换；每台服务器的节点库、工作流缓存、健康状态独立。节点也可单独绑定服务器（节点右键 → 绑定服务器）。

---

## 🎬 短剧工作室

顶部「短剧工作室」打开六步流程工作台（剧本 → 分镜 → 图片 → 视频 → 配音 → 合成）：

- 左侧项目栏：项目进度 + 分镜列表；中央当前步骤工作区；右侧 AI 助手
- 一键生成：自动串联全流程
- **分镜 AI 独立配置**：步骤 1 的「分镜 AI 设置」使用独立 API（与聊天 AI 完全隔离，互不清空）；未配置时回退「设置 → 提示词 AI」，再回退聊天 AI
- 配音使用 MiniMax（设置 → 付费 API 配置）
- **角色卡**：名字 + 外貌描述 + 参考图，分镜生成自动注入对应角色（人物一致）
- **三轨混音**：对白 + 每镜音效 + 全局 BGM（FFmpeg amix，BGM 自动压低音量）
- **套路模板库**：霸总逆袭/穿越重生/带货种草/悬疑反转/都市情感/古风虐恋，一键填充剧本
- **变体矩阵**：每镜可生成 1-4 个变体，确认时缩略图对比挑选
- **数字人口播**：成片对口型（ComfyUI lipsync 工作流），支持下载/替换成片
- **主控/非主控分开**：图片/视频/音频各自可选生成服务器；视频支持首图 / 首尾图生视频
- **分镜衔接**：自动带上上一镜尾帧提示词 + 上一镜图作参考，镜头更连贯

---

## 💬 AI 聊天

顶部「聊天」打开全窗口聊天（暖白简约编辑器）：

- 模型选择、附件（本地/资产/画布/历史）、发送选中文本到画布
- 流式输出独立渲染，历史消息零重渲，滚动流畅
- 聊天节点（画布内）与全窗口聊天共用「设置 → 聊天 AI」配置

---

## 🔒 数据与隐私

| 数据 | 位置 |
|------|------|
| 安装版配置/资产/历史/缓存 | `%APPDATA%\JaceCanvas` |
| 开发版配置 | `%APPDATA%\ai-canvas-desktop-dev` |
| 项目文件 | 用户自选目录，`.jacecanvas.json`（自动保存 + 版本快照） |
| 服务器缓存 | localStorage（按服务器分 key） |

> ⚠️ 不要把 API Key、SSH 密码、GitHub 凭据、私有主控地址写入公开文档、截图或日志。开源时请阅读 [OPEN_SOURCE_GUIDE.md](./OPEN_SOURCE_GUIDE.md)。

---

## 📁 目录结构

```
desktop-app/
├── main.js                  # Electron 主进程（GPU 加速 + 崩溃防护 + 沙盒 IPC）
├── preload.js               # 预加载脚本（安全桥接）
├── src/                     # React 源码
│   ├── components/          # 画布、聊天、短剧工作室、DevAgent、设置…
│   ├── stores/              # Zustand 状态（画布 / 设置 / 主题）
│   ├── services/            # 主控 / ComfyUI / 付费 API / 聊天 / 分镜服务
│   └── config/              # 节点配置、离线兜底工作流、模板
├── server/                  # 内嵌 Express 后端（数据库 / 上传 / 代理）
├── scripts/                 # 构建与打包脚本（prepare-opensource 等）
├── assets/                  # 图标、素材
├── config/                  # 提示词配置（.example.json 为开源模板）
└── release-v4.7.1/          # 打包输出
```

---

## ❓ 常见问题

**Q: 双击没反应 / 闪退？**
A: 先运行 `start-desktop.bat` 看控制台错误。内置崩溃恢复最多重试 3 次；持续崩溃请更新显卡驱动，或移除 main.js 中 `disable-gpu-sandbox` 开关。

**Q: 有节点但性能检测不显示？**
A: 这是主控服务器双地址问题。在服务器编辑里，把「性能检测地址」填成能返回性能数据的那个链接（节点地址与性能地址分开填）。

**Q: 短剧工作室的分镜 AI 是不是只能用 GPT？**
A: 不是。步骤 1 →「分镜 AI 设置」可自由选择提供商/模型（OpenAI 兼容 / Gemini / Anthropic / Ollama），且该配置独立保存，不影响聊天 AI。

**Q: 聊天/分镜 AI 调不通？**
A: 先到设置确认 `baseUrl` / `apiKey` 已填写并**正常退出应用**保存（强杀进程会导致配置丢失）；分镜 AI 未单独配置时会自动回退聊天 AI。

**Q: 数据和设置保存在哪？**
A: 安装版 `%APPDATA%\JaceCanvas`；开发版 `%APPDATA%\ai-canvas-desktop-dev`。清空数据：设置 → 关于 → 数据管理。

**Q: 能跨平台吗？**
A: 当前仅 Windows x64。如需 macOS/Linux，修改 package.json 的 build 配置添加目标。

---

## 📝 更新日志

### v4.7.1（最新）
- **导演台（3D 白模）大升级**：模型复制、无人机式 FPV 运镜录制（鼠标转向 + 键盘移动）、录制运镜同时采样模型/骨骼、关键帧删除后时间轴自动归一化、运镜速度/灯光/关键帧/机位退出持久化
- **视频与媒体**：视频拖入画布不再被识别成封面图片（按 URL 扩展名修正类型）、视频缩略图封面显示优化
- **付费 API**：补齐百炼 qwen-image-3.0/3.0-pro/2.0-pro、wan2.7 多图参考/视频编辑、happyhorse 1.1 系列等最新模型
- **素材持久化**：修复素材保存目录切换（跨盘迁移、显示刷新）、素材不再误存 48h 缓存目录
- **ComfyUI 直连端口**：修复 403/400 错误掩码、图片上传走主进程、带冒号子节点 id 的参数识别与提示词字段识别
- **打包**：修复安装包桌面快捷方式图标与窗口图标不一致（ICO 损坏项剔除）

### v4.6.9（已并入 v4.7.1）
- **短剧工作室大升级**：角色卡管理、BGM/音效三轨混音、套路模板库、变体矩阵、数字人口播（对口型）、主控/非主控服务器分开、首图/首尾图生视频、分镜衔接上下文统一、退出不丢失（自动保存工作区）
- **素材持久化**：设置 → 素材管理（自动保存/保存路径/清理天数/大小上限）、上传节点落盘本地 file://、历史默认隐藏失败记录
- **UI/交互**：顶部提示词库、拖出自动生成预览/对比节点、连接磁吸、宽高常用尺寸快捷、执行列表点画布自动收起、历史卡片布局修复
- **主题**：新增暖白纸/薄荷青/蜜桃粉 3 个亮色主题，容器与节点全面 token 化（硬编码色 181→144）
- **付费 API 修复**：OpenAI b64_json、Stability 双前缀、Runway 域名与任务端点、MiniMax 图像分支/域名、Google Gemini 图片格式
- **聊天修复**：Ollama 流式兼容、Anthropic 图片附件、DevAgent 独立厂商解析、deep 模式超时放宽
- **画布修复**：预览节点可连下游（多图/任意媒体）、负面提示词独立端口、主控性能优先 perfUrl、节点下载统一、启动恢复不丢项目、ConfigPanel 崩溃修复
- **可靠性**：修复卸载保存回滚、项目 id 不同步、弹窗打开时误删画布、素材 0 值被覆盖等 60+ 项

最新版本：**v4.7.1**。更新内容见 GitHub Releases。

---

## 👥 贡献者

- [Nicke000](https://github.com/Nicke000)（原作者与维护者）
- [DeepSeek](https://www.deepseek.com)（AI 开发助手，参与本版功能开发与测试）
- [OpenAI](https://openai.com)（AI 开发助手，参与代码整理、文档维护与发布准备）

---

## 📄 许可证

MIT License（第三方组件保留各自许可证与版权声明，详见 [OPEN_SOURCE_GUIDE.md](./OPEN_SOURCE_GUIDE.md)）。

**如有问题，请查看控制台输出的错误信息进行排查。**
