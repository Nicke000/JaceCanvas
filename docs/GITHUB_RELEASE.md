# GitHub repository and Release page plan

## Repository description

`JaceCanvas — open-source AI infinite canvas, workflow nodes, StoryAI director desk, and optional local Video2X super-resolution/frame interpolation.`

## Suggested topics

`ai`, `node-editor`, `infinite-canvas`, `react`, `electron`, `comfyui`,
`video-upscaling`, `frame-interpolation`, `video2x`, `director-tools`, `open-source`

## README page layout

1. Project title and badges.
2. Short product statement and screenshot/GIF supplied by the maintainer.
3. Feature cards: canvas, dynamic nodes, director desk, startup animation,
   Video2X local node and Windows desktop packaging.
4. Quick install and source build.
5. A dedicated Video2X license/third-party warning block.
6. Canvas modification and contribution statement.
7. System requirements and troubleshooting.
8. License and security links.

## Release checklist

- Build the source without private configuration.
- Verify `npm run build:web` for desktop-app.
- Verify the packaged app contains `app.asar` and, when distributed,
  `resources/video2x/video2x.exe` plus all upstream notices.
- Attach SHA256 checksums for installers.
- Do not upload passwords, API keys, databases, logs, `node_modules`, or
  unreviewed third-party models.
- State clearly whether a Release is a source-only build, portable build or
  installer with bundled third-party runtime.

## Safe GitHub authentication

Do not use an account password in a remote URL or script. Use GitHub CLI login,
a fine-grained Personal Access Token, or an SSH key. Revoke any password that
has been shared in chat or stored in shell history.