/**
 * JaceCanvas - DeepSeek Harness (DSH) 接入桥（主进程模块）
 *
 * 职责：
 * 1. MCP 画布服务桥：本地回环 HTTP bridge（127.0.0.1 随机端口）接收 DSH 侧
 *    canvas-mcp-server 的工具调用，转发到渲染进程 canvasAgent 执行器，结果返回。
 * 2. DSH 命令探测：自动定位 `dsh` 可执行文件（PATH / npm 全局 / DSH_HOME）。
 * 3. headless 任务：`dsh --profile headless "任务"` 一次性 Agent 任务，
 *    流式日志回推渲染进程，供画布 DSH 节点 / 导演台 AI / 短剧剧本分析复用。
 * 4. DSH Web 面板：探测/启动 `dsh web --port 0 --no-open`，返回可访问 URL，
 *    Electron 独立窗口加载后即「画布内 DSH」。
 * 5. MCP 配置注入：把 mcp-canvas 插件实例写入 DSH profile 的 cordis.patch.yml，
 *    使 DSH agent 原生获得 mcp__canvas__* 工具（操作画布的能力）。
 *
 * 设计约束（开源适配）：
 * - 不硬编码任何用户机器路径 / API Key / 凭据；bridge 端口文件写在 userData。
 * - dsh 与 @deepseek-ai/dsh-mcp-client 均为外部可选依赖：未安装时功能优雅降级，
 *   仅提示安装命令，不影响画布其它功能。
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { ipcMain, app, BrowserWindow } = require("electron");

const LOG_TAG = "[DSH]";
function log(...args) { console.log(LOG_TAG, ...args); }
function warn(...args) { console.warn(LOG_TAG, ...args); }

/* ============================================================
 * 1. MCP 画布服务桥（本地 HTTP → 渲染进程）
 * ============================================================ */

let mcpBridgeServer = null;
let mcpBridgePort = 0;
/** { id: { resolve, timer } }，等待渲染进程回执 */
const mcpPending = new Map();

function mcpBridgeFile() {
  return path.join(app.getPath("userData"), "mcp-bridge.json");
}

/** 启动回环 bridge，把端口文件写给 canvas-mcp-server 读取 */
async function startMcpBridge() {
  if (mcpBridgeServer) return mcpBridgePort;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/canvas/invoke") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let payload;
        try { payload = JSON.parse(body); } catch { res.writeHead(400).end(JSON.stringify({ error: "bad json" })); return; }
        const { id, action, args } = payload || {};
        if (!id || !action) { res.writeHead(400).end(JSON.stringify({ error: "missing id/action" })); return; }

        const win = require("electron").BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed());
        if (!win) {
          res.writeHead(503).end(JSON.stringify({ error: "no canvas window", ok: false, message: "画布窗口不可用" }));
          return;
        }

        const timer = setTimeout(() => {
          if (mcpPending.has(id)) { mcpPending.delete(id); }
          try { res.writeHead(504).end(JSON.stringify({ ok: false, message: "画布操作超时（90s）" })); } catch {}
        }, 90000);
        mcpPending.set(id, { resolve: (result) => {
          clearTimeout(timer);
          try {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result || { ok: false, message: "未知结果" }));
          } catch {}
        } });

        try {
          log(`MCP invoke 转发 → 渲染进程: ${action} id=${id} args=${JSON.stringify(args || {}).slice(0, 120)}`);
          win.webContents.send("canvas-mcp-invoke", { id, action, args: args || {} });
        } catch (e) {
          if (mcpPending.has(id)) mcpPending.delete(id);
          clearTimeout(timer);
          res.writeHead(500).end(JSON.stringify({ ok: false, message: `转发失败: ${String(e?.message || e)}` }));
        }
      });
    });

    server.on("error", (e) => {
      warn("bridge 启动失败:", e?.message);
      resolve(0);
    });
    server.listen(0, "127.0.0.1", () => {
      mcpBridgeServer = server;
      mcpBridgePort = server.address().port;
      try {
        fs.mkdirSync(path.dirname(mcpBridgeFile()), { recursive: true });
        fs.writeFileSync(mcpBridgeFile(), JSON.stringify({ port: mcpBridgePort, pid: process.pid, updatedAt: Date.now() }));
      } catch (e) { warn("写入 bridge 端口文件失败:", e?.message); }
      log(`MCP bridge 已启动: 127.0.0.1:${mcpBridgePort} → ${mcpBridgeFile()}`);
      resolve(mcpBridgePort);
    });
  });
}

function stopMcpBridge() {
  if (mcpBridgeServer) { try { mcpBridgeServer.close(); } catch {} mcpBridgeServer = null; }
  try { if (fs.existsSync(mcpBridgeFile())) fs.unlinkSync(mcpBridgeFile()); } catch {}
}

/* ============================================================
 * 2. dsh 命令探测
 * ============================================================ */

/**
 * 返回可 spawn 的 dsh 启动方式：{ command, args, via }
 * 优先 node + dsh 包的 lib/bin.js（跨环境稳定，无需 shell）；
 * 其次 PATH 中的 dsh.cmd / dsh。
 */
function findDshCommand() {
  // 1) DSH_HOME 下的 dsh 全局安装？npm 全局首选项
  try {
    const prefix = execFileSync("npm.cmd", ["prefix", "-g"], { encoding: "utf8", windowsHide: true, timeout: 8000 }).trim();
    if (prefix) {
      for (const sub of ["node_modules/@deepseek-ai/dsh", "node_modules/@deepseek-ai/dsh/lib"]) {
        const pkgDir = path.join(prefix, sub);
        const bin = path.join(pkgDir, "lib", "bin.js");
        if (fs.existsSync(bin)) return { command: nodeCommand(), args: [bin], via: "npm-global" };
      }
    }
  } catch {}
  // 2) PATH: where dsh
  if (process.platform === "win32") {
    try {
      const out = execFileSync("where.exe", ["dsh"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const cmd = lines.find(l => /\.cmd$/i.test(l)) || lines.find(l => /\.exe$/i.test(l)) || lines[0];
      if (cmd && fs.existsSync(cmd)) return { command: cmd, args: [], via: "path" };
    } catch {}
  } else {
    try {
      const out = execFileSync("which", ["dsh"], { encoding: "utf8", timeout: 8000 }).trim();
      if (out && fs.existsSync(out)) return { command: out, args: [], via: "path" };
    } catch {}
  }
  return null;
}

/** 跨平台解析 node 可执行命令 */
function nodeCommand() {
  if (process.platform === "win32") return "node.exe";
  return "node";
}

/** DSH profile 相关路径 */
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}
function dshProfileDir(profileName) {
  return path.join(dshHome(), "profiles", profileName || "headless");
}

/** 探测 dsh 状态（供渲染进程展示） */
function getDshStatus() {
  const found = findDshCommand();
  const profiles = {};
  for (const name of ["headless", "web"]) {
    const dir = dshProfileDir(name);
    const patchFile = path.join(dir, "cordis.patch.yml");
    let patchContent = null;
    try {
      if (fs.existsSync(patchFile)) patchContent = fs.readFileSync(patchFile, "utf8");
    } catch { /* 不可读则视为未注入 */ }
    profiles[name] = {
      exists: fs.existsSync(patchFile),
      patch: fs.existsSync(patchFile) ? patchFile : null,
      injected: !!patchContent && patchContent.includes("mcp-canvas"),
    };
  }
  return {
    available: !!found,
    command: found ? found.command : null,
    via: found ? found.via : null,
    version: found ? readDshVersion(found) : null,
    home: dshHome(),
    profiles,
    bridgePort: mcpBridgePort,
    bridgeFile: fs.existsSync(mcpBridgeFile()) ? mcpBridgeFile() : null,
  };
}

function readDshVersion(found) {
  try {
    const out = execFileSync(found.command, [...found.args, "--version"], { encoding: "utf8", timeout: 8000, windowsHide: true }).trim();
    return out.split(/\r?\n/)[0] || null;
  } catch { return null; }
}

/* ============================================================
 * 3. headless 任务（画布节点 / 导演台 / 短剧共用）
 * ============================================================ */

let taskSeq = 0;
const dshTasks = new Map(); // taskId -> { child, done: Promise, logs: [] }

function sendToRenderer(channel, payload) {
  try {
    const win = require("electron").BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed());
    if (win) win.webContents.send(channel, payload);
  } catch {}
}

/**
 * 运行 headless 任务。payload: { task, cwd?, profile? }
 * 立即返回 { ok, taskId }；进度与结果通过事件推送（dsh-task-log / dsh-task-done）。
 */
function runHeadlessTask(payload) {
  const found = findDshCommand();
  if (!found) return { ok: false, message: installHint() };
  const task = String(payload?.task || "").trim();
  if (!task) return { ok: false, message: "任务不能为空" };
  const profile = String(payload?.profile || "headless").trim();
  const cwd = String(payload?.cwd || "").trim() || undefined;

  const taskId = `dsh-${Date.now()}-${++taskSeq}`;
  const args = [...(found.args || []), "--profile", profile, task];
  let child;
  try {
    child = spawn(found.command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      shell: process.platform === "win32" && /\.cmd$/i.test(found.command) ? false : false,
    });
  } catch (e) {
    return { ok: false, message: `启动 dsh 失败: ${String(e?.message || e)}` };
  }

  const state = { child, logs: [], stdout: "", stderr: "", settled: false };
  const done = new Promise((res) => {
    child.stdout.on("data", (d) => {
      const text = d.toString();
      state.stdout += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        state.logs.push({ type: "out", line });
        sendToRenderer("dsh-task-log", { taskId, type: "out", line });
      }
    });
    child.stderr.on("data", (d) => {
      const text = d.toString();
      state.stderr += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        state.logs.push({ type: "err", line });
        sendToRenderer("dsh-task-log", { taskId, type: "err", line });
      }
    });
    child.on("error", (e) => {
      state.settled = true;
      res({ ok: false, output: "", error: `dsh 进程错误: ${String(e?.message || e)}`, code: -1 });
    });
    child.on("exit", (code) => {
      state.settled = true;
      const output = state.stdout.trim();
      res({ ok: code === 0, output, error: code === 0 ? "" : (state.stderr.trim() || `dsh 退出码 ${code}`), code });
    });
  });
  state.done = done;
  dshTasks.set(taskId, state);

  done.then((result) => {
    sendToRenderer("dsh-task-done", { taskId, ...result });
    setTimeout(() => dshTasks.delete(taskId), 60_000);
  });

  log(`headless 任务已启动 #${taskId}（profile=${profile}）`);
  return { ok: true, taskId };
}

function getDshTaskStatus(taskId) {
  const st = dshTasks.get(taskId);
  if (!st) return { found: false };
  return { found: true, settled: st.settled, logs: st.logs.slice(-200) };
}

function killDshTask(taskId) {
  const st = dshTasks.get(taskId);
  if (!st?.child) return { ok: false, message: "任务不存在" };
  try { st.child.kill(); } catch {}
  return { ok: true };
}

/* ============================================================
 * 4. MCP 配置注入（cordis.patch.yml）
 * ============================================================ */

/**
 * 把 mcp-canvas 插件条目写入 DSH profile 的 cordis.patch.yml。
 * 返回 { ok, message, profile, patch }。
 */
function injectMcpConfig(profileName) {
  const found = findDshCommand();
  if (!found) return { ok: false, message: installHint() };
  const profile = String(profileName || "headless").trim();
  const dir = dshProfileDir(profile);
  const patchFile = path.join(dir, "cordis.patch.yml");

  if (!fs.existsSync(patchFile)) {
    return {
      ok: false,
      message: `DSH profile "${profile}" 尚未初始化（缺少 ${patchFile}）。请先运行一次：dsh --profile ${profile} --help 或 dsh web，然后重试。`,
      profile,
    };
  }

  // DSH patch 层只支持「覆盖已存在 id / 向根 entry-list insert」两种形态——
  // 新增插件实例必须用 insert 型（`- insert:` + 嵌套实例），直接写 `- id: mcp-canvas`
  // 会被忽略并警告 "patch: entry mcp-canvas not found"。
  const entryLines = [
    `- insert:`,
    `    - id: mcp-canvas`,
    `      name: '@deepseek-ai/dsh-mcp-client'`,
    `      config:`,
    `        serverName: canvas`,
    `        transport: stdio`,
    `        command: ${JSON.stringify(mcpServerPath.command)}`,
    `        args: [${mcpServerPath.args.map(a => JSON.stringify(a)).join(", ")}]`,
    `        env:`,
    `          CANVAS_MCP_BRIDGE_FILE: ${JSON.stringify(bridgeFile)}`,
  ];

  const existing = fs.readFileSync(patchFile, "utf8");
  if (existing.includes("mcp-canvas")) {
    return { ok: true, message: `profile "${profile}" 已包含 mcp-canvas 配置`, profile, patch: patchFile, already: true };
  }

  // 顶部数组合并：DSH 的 cordis.patch.yml 顶层是 patch-list（block sequence）。
  // 模板默认是空 flow 数组 []；加入条目时必须转成 block sequence（顶层 - 列表），
  // 否则 DSH 的 YAML 解析器会报 "missed comma between flow collection entries"。
  let updated;
  const trimmed = existing.trimEnd();
  const blockItems = (list) => list.map(l => l).join("\n");
  if (/\[\s*\]\s*$/.test(trimmed)) {
    // 空数组 [] → 替换为纯 block sequence（去掉 flow 外壳）
    updated = trimmed.replace(/\[\s*\]\s*$/, blockItems(entryLines));
  } else if (/\{\s*\}\s*$/.test(trimmed)) {
    // 空对象（少见模板形态）→ 换成 block sequence
    updated = trimmed.replace(/\{\s*\}\s*$/, blockItems(entryLines));
  } else {
    // 已有 block 条目（顶层含 "- "）：如果结尾是 ] 说明仍是 flow 外壳，去掉外壳后追加
    const lastIdx = trimmed.lastIndexOf("]");
    const firstIdx = trimmed.indexOf("[");
    const hasBlockItems = /\n\s*- /.test(trimmed);
    if (lastIdx > -1 && firstIdx > -1 && firstIdx < lastIdx) {
      // 非空 flow 外壳（如 [\n - a\n]）→ 去掉外壳 + 追加新条目
      const inner = trimmed.slice(firstIdx + 1, lastIdx).trim();
      updated = trimmed.slice(0, firstIdx).trimEnd() + "\n" + (inner ? inner + "\n" : "") + blockItems(entryLines);
    } else if (hasBlockItems && lastIdx === -1) {
      // 已经是纯 block sequence → 直接追加
      updated = trimmed + "\n" + blockItems(entryLines);
    } else {
      return {
        ok: false,
        message: `profile "${profile}" 的 cordis.patch.yml 含无法自动合并的非标准内容，请手动把以下片段加入文件末尾：\n${entryLines.join("\n")}`,
        profile,
      };
    }
  }

  try {
    fs.writeFileSync(patchFile, updated, "utf8");
  } catch (e) {
    return { ok: false, message: `写入 ${patchFile} 失败: ${String(e?.message || e)}`, profile };
  }
  log(`已注入 mcp-canvas 到 ${patchFile}`);
  return { ok: true, message: `已把 mcp-canvas 注入 profile "${profile}"（${patchFile}）。重启 DSH 后 agent 将获得 mcp__canvas__* 工具。`, profile, patch: patchFile };
}

/** 定位 canvas-mcp-server 启动入口（node + 脚本路径） */
function mcpServerEntryPath() {
  // 开发版与打包版：脚本随应用分发；打包时通过 extraResources 或 app 目录放置
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, "mcp-server", "canvas-mcp-server.cjs")
      : path.join(__dirname, "mcp-server", "canvas-mcp-server.cjs"),
    path.join(__dirname, "mcp-server", "canvas-mcp-server.cjs"),
  ];
  const script = candidates.find(p => fs.existsSync(p));
  if (!script) return null;
  return { command: nodeCommand(), args: [script] };
}

/** 用户可读的安装提示 */
function installHint() {
  return "未检测到 dsh（DeepSeek Harness）。请先全局安装：npm install -g @deepseek-ai/dsh，然后重启应用。";
}

/* ============================================================
 * 5. DSH Web 面板（独立进程，Electron 窗口加载）
 * ============================================================ */

let dshWebProcess = null;
let dshWebUrl = null;

function probeRunningWeb(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); res.once("end", () => resolve(res.statusCode === 200)); });
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

/**
 * 确保 dsh web 在运行：优先复用本机已在跑的 dsh web（3080 等常见端口探测），
 * 否则 spawn `dsh web --port 0 --no-open` 并解析打印的 URL。
 * 返回 { ok, url, started, message }
 */
async function ensureDshWeb() {
  if (dshWebUrl) return { ok: true, url: dshWebUrl, started: false };
  // 1) 常见端口探测
  for (const port of [3080, 3081, 3082]) {
    try {
      if (await probeRunningWeb(`http://127.0.0.1:${port}/`)) {
        dshWebUrl = `http://127.0.0.1:${port}`;
        log(`复用已运行的 dsh web: ${dshWebUrl}`);
        return { ok: true, url: dshWebUrl, started: false };
      }
    } catch {}
  }
  // 2) 启动新实例
  const found = findDshCommand();
  if (!found) return { ok: false, message: installHint() };
  return new Promise((resolve) => {
    const args = [...(found.args || []), "web", "--port", "0", "--no-open"];
    let child;
    try {
      child = spawn(found.command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    } catch (e) {
      resolve({ ok: false, message: `启动 dsh web 失败: ${String(e?.message || e)}` });
      return;
    }
    dshWebProcess = child;
    const timer = setTimeout(() => {
      resolve({ ok: false, message: "dsh web 启动超时（60s），请检查 DSH 配置", started: true });
    }, 60_000);
    const onData = (buf) => {
      const text = buf.toString();
      const m = text.match(/https?:\/\/127\.0\.0\.1:\d+/);
      if (m) {
        clearTimeout(timer);
        dshWebUrl = m[0];
        log(`dsh web 已启动: ${dshWebUrl}`);
        resolve({ ok: true, url: dshWebUrl, started: true });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, message: `dsh web 进程错误: ${String(e?.message || e)}`, started: true }); });
    child.on("exit", () => { clearTimeout(timer); if (!dshWebUrl) resolve({ ok: false, message: "dsh web 进程退出", started: true }); });
  });
}

function stopDshWeb() {
  if (dshWebProcess && !dshWebProcess.killed) { try { dshWebProcess.kill(); } catch {} }
  dshWebProcess = null;
  dshWebUrl = null;
  if (dshPanelWindow && !dshPanelWindow.isDestroyed()) { try { dshPanelWindow.destroy(); } catch {} }
  dshPanelWindow = null;
}

let dshPanelWindow = null;

/**
 * 在独立 Electron 窗口中打开 DSH Web 面板（若 dsh web 未运行则先启动）。
 * 返回 { ok, url, started, message }；窗口已在时聚焦返回。
 */
async function openDshPanel() {
  const r = await ensureDshWeb();
  if (!r.ok) return r;
  if (dshPanelWindow && !dshPanelWindow.isDestroyed()) {
    if (dshPanelWindow.isMinimized()) dshPanelWindow.restore();
    dshPanelWindow.focus();
    return { ok: true, url: r.url, started: r.started, focused: true };
  }
  dshPanelWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "DeepSeek Harness · DSH",
    backgroundColor: "#0f0f0f",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
    },
  });
  dshPanelWindow.loadURL(r.url);
  dshPanelWindow.on("closed", () => { dshPanelWindow = null; });
  // 面板内再弹外部 http 链接 → 系统浏览器
  dshPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
  return { ok: true, url: r.url, started: r.started, focused: false };
}

/* ============================================================
 * IPC 注册
 * ============================================================ */

function registerIpc() {
  ipcMain.handle("dsh-get-status", () => getDshStatus());
  ipcMain.handle("dsh-inject-mcp", (_e, opts) => injectMcpConfig(opts?.profile));
  ipcMain.handle("dsh-run-task", (_e, payload) => runHeadlessTask(payload));
  ipcMain.handle("dsh-task-status", (_e, taskId) => getDshTaskStatus(taskId));
  ipcMain.handle("dsh-task-kill", (_e, taskId) => killDshTask(taskId));
  ipcMain.handle("dsh-open-web", async () => ensureDshWeb());
  ipcMain.handle("dsh-open-panel", async () => openDshPanel());
  ipcMain.handle("dsh-stop-web", () => { stopDshWeb(); return true; });
  // 渲染进程回执：MCP 工具调用结果
  ipcMain.handle("canvas-mcp-result", (_e, { id, ok, message }) => {
    const pending = mcpPending.get(id);
    log(`MCP 回执: ${id} ok=${!!ok} msg=${String(message ?? "").slice(0, 80)}`);
    if (pending) { mcpPending.delete(id); pending.resolve({ ok: !!ok, message: String(message ?? "") }); }
    return true;
  });
}

/** 初始化入口：app ready 后调用一次 */
async function initDshBridge() {
  registerIpc();
  await startMcpBridge();
  // 启动清理钩子
  app.on("before-quit", () => {
    stopMcpBridge();
    stopDshWeb();
    for (const st of dshTasks.values()) { try { st.child?.kill(); } catch {} }
  });
  return { bridgePort: mcpBridgePort };
}

module.exports = { initDshBridge, getDshStatus, runHeadlessTask, injectMcpConfig, ensureDshWeb, openDshPanel, mcpBridgePort };