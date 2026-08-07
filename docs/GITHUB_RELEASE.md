# GitHub Release 发布计划（v4.6.8）

## Repository description

`JaceCanvas — open-source AI infinite canvas with dynamic workflow nodes, multi-server (ComfyUI / control platforms), paid API adapters, short-drama studio, AI chat and DevAgent.`

## Suggested topics

`ai`, `node-editor`, `infinite-canvas`, `react`, `electron`, `comfyui`, `workflow-nodes`, `short-drama`, `open-source`

## Release 资产（三版本）

1. `JaceCanvas-4.6.8-pure-install.exe` — 纯安装版（应用本体）
2. `JaceCanvas-4.6.8-install-with-opensource.exe` — 安装版 + 内置完整开源（resources/opensource）
3. `JaceCanvas-4.6.8-opensource.zip` — 纯开源源码包（不含 node_modules）

## Release 前检查清单

- [ ] 源码不含个人配置（config/prompt-settings.json 不提交，只提交 .example.json）
- [ ] 不提交 release/dist/node_modules/opensource-resource/日志/数据库
- [ ] 无真实域名、IP、Token、API Key
- [ ] 无 Video2X 残留（本地 assets/video2x 已移除）
- [ ] `npm run build:web` 通过；`npm run lint:tokens` 通过
- [ ] 安装包 SHA256 校验和随 Release 发布
- [ ] 干净 Windows（无 Node.js）安装测试通过
- [ ] 文档（README / 安装说明 / 开源使用说明 / THIRD_PARTY_NOTICES）与当前版本一致
