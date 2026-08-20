# GitHub Release 发布计划（v4.7.2）

## Repository description

`JaceCanvas — open-source AI infinite canvas with dynamic workflow nodes, multi-server (ComfyUI / control platforms), paid API adapters, short-drama studio, AI chat and DevAgent.`

## Suggested topics

`ai`, `node-editor`, `infinite-canvas`, `react`, `electron`, `comfyui`, `workflow-nodes`, `short-drama`, `open-source`

## Release 资产

1. `JaceCanvas Setup 4.7.2.exe` — 安装版 + 内置完整开源（`resources/opensource`）。
2. 官网直链：`https://jacecomfyui.xyz/downloads/JaceCanvas-Setup-4.7.2.exe`。
3. 应用内更新清单：`https://jacecomfyui.xyz/releases/latest.json`。

SHA-256：

```text
19DBBC4D8CB4C44700D1860E5DF6BAFBA0FC2E9929F810ACFFC2D054C6A4415A
```

## 4.7.2 变更

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
- [x] `npx tsc --noEmit` 与 `npm run build:web` 通过。
- [x] 安装包 SHA-256 已生成。
- [ ] 网站下载链接和 `latest.json` 已通过 HTTPS 验证。
- [ ] GitHub Release 附件上传完成（如需镜像 GitHub 发布）。
