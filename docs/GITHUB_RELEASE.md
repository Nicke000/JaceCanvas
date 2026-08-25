# GitHub Release 发布计划（v4.7.3）

## Repository description

`JaceCanvas — open-source AI infinite canvas with dynamic workflow nodes, multi-server (ComfyUI / control platforms), paid API adapters, short-drama studio, AI chat and DevAgent.`

## Suggested topics

`ai`, `node-editor`, `infinite-canvas`, `react`, `electron`, `comfyui`, `workflow-nodes`, `short-drama`, `open-source`

## Release 资产

1. `JaceCanvas Setup 4.7.3.exe` — 安装版 + 内置完整开源（`resources/opensource`）。
2. 官网直链：`https://jacecomfyui.xyz/downloads/JaceCanvas-Setup-4.7.3.exe`（连字符命名）。
3. 应用内更新清单：`https://jacecomfyui.xyz/releases/latest.json`。

SHA-256（`JaceCanvas-Setup-4.7.3.exe`）：

```text
ADAFECC838B3EB586F9610B741FE5F5128E5AB3E39C17F665F044BEC52E03A69
```

## 4.7.3 变更

- 新增 **RunningHub 标准模型 API**（官方合同驱动）：图生图 / 文生图 / 视频 / 3D / 音频节点、多图顺序槽位、动态可选输出、端口类型自动配色与状态；本地图片先上传再提交（Bearer 鉴权、数组字段固化）。
- 新增 **AI Chat Skills**：用户自建 Skills 文件夹，聊天时先读取索引、再按需加载匹配的 SKILL.md；Skill 只作知识参考，最终只输出纯提示词（可加一句说明）。
- 聊天体验优化：关闭 Skills 即恢复普通问答；资产/历史/画布/本地图片都能作为视觉附件发送；区分超时、网络、HTTP 与空正文错误并使用可读提示；修复「声明流式但返回 JSON 时的重复请求」以提速。
- 新增 **官网**本地源码（`website`，独立部署、不入源码仓库）：全新风格、深/浅两主题、服务器 `/image/` 轮播、下载/更新地址与软件内置一致。
- 后端：RunningHub 不可用模型在节点库置灰（`-official` 全球端标记），不删除 registry 数据。

### 4.7.2 变更（历史）

- 修复节点离开画布视口后停止或重置。
- 缩略图只用于展示；预览、下载和下游使用原图。
- 修复上传节点多文件预览选择。
- 去除上传、裁切、局部重绘和聊天附件的隐式图片降采样。
- 设置/关于增加检查更新与更新前本地数据备份。
- 不再提供百度网盘或夸克网盘下载入口。

## Release 前检查清单

- [ ] 源码不含个人配置（`config/prompt-settings.json` 不提交，只提交 `.example.json`）。
- [ ] 不提交 `release/`、`dist/`、`node_modules/`、`opensource-resource/`、日志或数据库。
- [ ] 无 Token、API Key、密码、私有 IP 或个人信息。
- [ ] `npx tsc --noEmit` 与 `npm run build:web` 通过。依赖未安装时先执行 `npm ci`。
- [ ] 安装包 SHA-256 已生成并填入上方。
- [ ] 网站下载链接和 `latest.json` 已通过 HTTPS 验证。
- [ ] GitHub Release 附件上传完成（如需镜像 GitHub 发布）。
