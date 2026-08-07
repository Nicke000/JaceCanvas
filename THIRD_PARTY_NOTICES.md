# Third-party notices and copyright statement

## Scope

This file describes the license boundary for the JaceCanvas open-source source tree. It is not a replacement for the license shipped by any upstream project. Before redistributing a binary, verify the exact version and retain all upstream license and copyright files.

## Bundled/runtime components

The desktop build may include or use the following projects. Their individual licenses remain applicable:

- Electron and Chromium (notices are generated in the packaged application)
- FFmpeg (used for composition/editing; has its own notice under the runtime bundle)
- React, Vite, Ant Design, XYFlow, Three.js, Zustand, Dexie and other npm packages (licenses listed in their package directories and lockfile metadata)

## AI 能力与第三方服务边界

- 分镜 AI / 聊天 AI / DevAgent 调用用户自己配置的 API（OpenAI 兼容 / Gemini / Anthropic / Ollama / dashscope 等），密钥保存在用户本机，开源代码不含任何真实密钥。
- 付费 API 节点（火山、Flux、Fal、MiniMax 等）调用各厂商公开接口，密钥由用户配置，不随源码分发。
- 所有生成模型均由主控平台/厂商提供，JaceCanvas 不内置、不转售任何生成模型。

## Media, icon and model assets

The startup animation, icons, sample media and 3D assets are not automatically covered by the JaceCanvas MIT License. Do not redistribute an asset unless you own it or have a license allowing redistribution. Replace these assets with your own files for a public derivative if their rights are unclear.

## Copyright and acceptable use

JaceCanvas does not grant rights to third-party input media, generated results, models, trademarks, faces, voices or datasets. Users are responsible for copyright, trademark, portrait, privacy, publicity, export-control and other legal requirements. Do not imply that a third-party component is an original JaceCanvas model.

## Modification and canvas derivatives

Anyone may modify and further develop the JaceCanvas original canvas source, node UI and adapters under the MIT License. Derivative canvas projects may be private, public, personal, research or commercial, subject to the MIT notice and all third-party notices above. Clearly mark substantial changes and do not remove upstream notices.
