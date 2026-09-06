/**
 * JaceCanvas - MCP 画布服务（DSH 侧 stdio server）
 *
 * DeepSeek Harness 的 dsh-mcp-client 插件会 spawn 本脚本（stdio 传输），
 * 把 MCP 工具注册为 mcp__canvas__* 暴露给 DSH agent。
 *
 * 本脚本自身不直接访问画布 —— 画布状态在 Electron 渲染进程：
 *  - 启动时读取 CANVAS_MCP_BRIDGE_FILE 指向的 bridge 端口文件（由主进程写入）；
 *  - 每次 callTool 通过回环 HTTP POST http://127.0.0.1:<port>/canvas/invoke
 *    把 {id, action, args} 转发给主进程 → 渲染进程 canvasAgent 执行器。
 *
 * 零依赖：按 MCP stdio 协议（JSON-RPC 2.0 over stdio）实现最小子集：
 * initialize / notifications/initialized / tools/list / tools/call / ping。
 * 开源版无需安装任何额外 npm 包即可被 DSH 调用。
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const BRIDGE_FILE = process.env.CANVAS_MCP_BRIDGE_FILE || "";

/* ---------------- MCP 工具定义（与画布 canvasAgent 执行器对齐） ---------------- */

const TOOLS = [
  { name: "list_nodes", description: "列出画布所有节点（id/名称/类型/状态/错误）", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "node_types", description: "列出可添加到画布的节点类型", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "add_node", description: "添加节点到画布中心", inputSchema: { type: "object", properties: { type: { type: "string", description: "节点类型（用 node_types 查询）" }, label: { type: "string", description: "可选自定义名" }, config: { type: "object", description: "可选初始配置" } }, required: ["type"], additionalProperties: false } },
  { name: "connect", description: "连接两个节点（需正确端口名）", inputSchema: { type: "object", properties: { source: { type: "string" }, target: { type: "string" }, sourceHandle: { type: "string" }, targetHandle: { type: "string" } }, required: ["source", "target"], additionalProperties: false } },
  { name: "set_config", description: "修改节点配置", inputSchema: { type: "object", properties: { node: { type: "string" }, key: { type: "string" }, value: {}, config: { type: "object" } }, required: ["node"], additionalProperties: false } },
  { name: "run", description: "从指定节点开始执行（含下游链路）", inputSchema: { type: "object", properties: { node: { type: "string" } }, required: ["node"], additionalProperties: false } },
  { name: "read_errors", description: "检查画布所有报错节点及原因", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_node", description: "查看单个节点详情（配置/状态/结果）", inputSchema: { type: "object", properties: { node: { type: "string" } }, required: ["node"], additionalProperties: false } },
  { name: "delete_node", description: "删除节点（谨慎）", inputSchema: { type: "object", properties: { node: { type: "string" } }, required: ["node"], additionalProperties: false } },
  { name: "select_node", description: "在画布中选中并定位节点", inputSchema: { type: "object", properties: { node: { type: "string" } }, required: ["node"], additionalProperties: false } },
  { name: "source_list_versions", description: "列出源码沙盒版本（DevAgent 源码修改）", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "source_read_file", description: "读沙盒内源码文件", inputSchema: { type: "object", properties: { version: { type: "string" }, path: { type: "string" } }, required: ["version", "path"], additionalProperties: false } },
  { name: "source_build_test", description: "沙盒 tsc 校验", inputSchema: { type: "object", properties: { version: { type: "string" } }, required: ["version"], additionalProperties: false } },
  { name: "source_package", description: "沙盒版本打包安装版（后台）", inputSchema: { type: "object", properties: { version: { type: "string" } }, required: ["version"], additionalProperties: false } },
  { name: "source_package_status", description: "查询打包进度", inputSchema: { type: "object", properties: { version: { type: "string" } }, required: ["version"], additionalProperties: false } },
  { name: "source_run_command", description: "沙盒目录内受限命令（npm/npx/node/git/tsc 等白名单）", inputSchema: { type: "object", properties: { version: { type: "string" }, command: { type: "string" } }, required: ["version", "command"], additionalProperties: false } },
];

/* ---------------- bridge 转发 ---------------- */

let bridgePort = 0;

function readBridgeFile() {
  try {
    const data = JSON.parse(fs.readFileSync(BRIDGE_FILE, "utf8"));
    bridgePort = Number(data.port) || 0;
    return bridgePort;
  } catch {
    // 主进程可能刚启动还没写好；调用时再试
    return 0;
  }
}

function invokeCanvas(action, args) {
  return new Promise((resolve) => {
    if (!bridgePort) readBridgeFile();
    if (!bridgePort) {
      resolve({ ok: false, message: `无法连接画布桥（CANVAS_MCP_BRIDGE_FILE=${BRIDGE_FILE || "(未设置)"}）。请确认 JaceCanvas 正在运行。` });
      return;
    }
    const id = `mcp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const body = JSON.stringify({ id, action, args: args || {} });
    const req = http.request({
      host: "127.0.0.1",
      port: bridgePort,
      path: "/canvas/invoke",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 95000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data || "{}")); }
        catch { resolve({ ok: false, message: `画布桥返回格式错误: ${String(data).slice(0, 200)}` }); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, message: "画布桥请求超时" }); });
    req.on("error", (e) => resolve({ ok: false, message: `画布桥请求失败: ${String(e?.message || e)}` }));
    req.end(body);
  });
}

/* ---------------- MCP stdio 协议 ---------------- */

// MCP SDK（@modelcontextprotocol/sdk 1.x）的 stdio 传输采用
// 「一行 JSON + \n」换行分隔帧（shared/stdio.js 的 serializeMessage），
// 不是 LSP 的 Content-Length 帧。必须按行写，否则 SDK 解析失败、握手超时。
function sendMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function textContent(text) {
  return { content: [{ type: "text", text }] };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== "object" || !msg.method) return;

  // 调试日志（stderr，避免污染协议流）：记录每个请求与响应片段
  process.stderr.write(`[canvas-mcp-server] <= ${msg.method}${msg.id !== undefined ? " id=" + msg.id : ""}\n`);

  switch (msg.method) {
    case "initialize":
      sendMessage({
        jsonrpc: "2.0", id: msg.id,
        result: {
          protocolVersion: msg.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "jacecanvas-canvas", version: "1.0.0" },
        },
      });
      break;
    case "notifications/initialized":
    case "notifications/tools/list_changed":
      break; // 无操作
    case "ping":
      sendMessage({ jsonrpc: "2.0", id: msg.id, result: {} });
      break;
    case "tools/list":
      sendMessage({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
      break;
    case "tools/call": {
      const { name, arguments: args } = msg.params || {};
      const tool = TOOLS.find(t => t.name === name);
      if (!tool) {
        sendMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `未知工具: ${name}` } });
        break;
      }
      invokeCanvas(name, args || {}).then((result) => {
        sendMessage({
          jsonrpc: "2.0", id: msg.id,
          result: {
            content: [{ type: "text", text: result.message || "" }],
            isError: !result.ok,
            structuredContent: result,
          },
        });
      }).catch((e) => {
        sendMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(e?.message || e) } });
      });
      break;
    }
    default:
      sendMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `不支持的方法: ${msg.method}` } });
  }
}

rl.on("line", handleMessage);
rl.on("close", () => process.exit(0));

// 启动日志（stdout 会被 MCP 客户端当作协议流，日志走 stderr）
process.stderr.write(`[canvas-mcp-server] ready, bridgeFile=${BRIDGE_FILE || "(未设置)"}\n`);
