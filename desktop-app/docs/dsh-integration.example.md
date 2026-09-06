# JaceCanvas × DeepSeek Harness（DSH）接入参考
# ===============================================
# 本文件是「把 JaceCanvas 画布能力注册给 DSH」的配置参考（英文注释版见 README 章节）。
# 实际使用时请通过应用内「设置 → DSH 集成 → 注入 MCP 配置」自动完成，
# 它会探测你的 dsh 安装位置与 bridge 端口并写入对应 profile，无需手改。
#
# 以下片段等效于自动注入写入 `~/.dsh/profiles/<profile>/cordis.patch.yml` 的内容
# （profile 为 headless / web，按需注入）。供手动排查或离线配置时参考：
#
#   # ===== cordis.patch.yml 追加内容 =====
#   - insert:
#       - id: mcp-canvas
#         name: '@deepseek-ai/dsh-mcp-client'
#         config:
#           serverName: canvas
#           transport: stdio
#           command: "node.exe"
#           args: ["<JaceCanvas 安装目录>/resources/app.asar.unpacked/mcp-server/canvas-mcp-server.cjs"]
#           env:
#             CANVAS_MCP_BRIDGE_FILE: "<JaceCanvas userData>/mcp-bridge.json"
#   # ========================================
#
# 关键点（实测踩坑记录）：
# 1. 新增插件实例必须用 insert 型（`- insert:` 嵌套实例），直接写 `- id: mcp-canvas`
#    会被 DSH 忽略并警告 `patch: entry "mcp-canvas" not found`。
# 2. 顶层 patch-list 必须是 block sequence（`- ` 列表），不要用 `[ ... ]` flow 外壳
#    包裹 block 条目，否则 DSH 报 `missed comma between flow collection entries`。
# 3. MCP SDK（@modelcontextprotocol/sdk ≥1.x）stdio 传输是「一行 JSON + 换行」帧，
#    不是 LSP 的 Content-Length 帧；canvas-mcp-server 已按此实现。
# 4. bridge 端口文件由 JaceCanvas 主进程启动时写入 userData（mcp-bridge.json），
#    路径随安装版 / 开发版不同：开发版为 %APPDATA%\ai-canvas-desktop-dev\，
#    安装版为 %APPDATA%\JaceCanvas\。
#
# 工具清单（注入后 DSH 获得 mcp__canvas__* 工具）：
#   list_nodes / node_types / add_node / connect / set_config / run / read_errors /
#   get_node / delete_node / select_node /
#   source_list_versions / source_read_file / source_build_test / source_package /
#   source_package_status / source_run_command
#   其中 source_write_file / request_source_access / source_delete_version 需画布内
#   人工确认，DSH 外部调用会被拒绝（安全边界）。