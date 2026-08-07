/**
 * JaceCanvas - Electron 主进程
 * 
 * 功能：
 * - GPU 硬件加速渲染
 * - 内嵌后端 API 服务器
 * - 崩溃防护与自动恢复
 * - 本地文件加载（无需网络）
 */

const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage, Menu } = require("electron");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const { pathToFileURL, fileURLToPath } = require("url");

function loadRuntimeSettings() {
  try {
    const file = path.join(app.getPath("userData"), "runtime-settings.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return {}; }
}
const runtimeSettings = loadRuntimeSettings();

// 默认启用 Electron/Chromium GPU；只有用户明确关闭时才回退到软件渲染。
// 生成任务仍由远程服务器 GPU 执行，桌面端 GPU 主要用于 Three.js/WebGL 预览。
const gpuAcceleration = runtimeSettings.gpuAcceleration !== false;

// ============================================================
// 🔥 GPU 加速配置
// ============================================================
// 启用 GPU 硬件加速（Chromium 渲染引擎）。不要强制打开实验性 GPU
// 开关：部分 Windows 驱动会因此让渲染进程崩溃，最终表现为黑屏。
// Chromium 会根据驱动黑名单自行选择 WebGL/GPU 路径；用户关闭时使用软件渲染。
if (!gpuAcceleration) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-software-rasterizer");
} else {
  app.commandLine.appendSwitch("enable-accelerated-video-decode");
  app.commandLine.appendSwitch("enable-accelerated-video-encode");
}

// ============================================================
// 应用配置
// ============================================================
const APP_NAME = "JaceCanvas";
const SERVER_PORT = 3001;

// 开发版与安装版共用 userData 会冲突单实例锁（同 productName），
// 开发模式使用独立数据目录，保证两者可同时运行。
if (!app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), "ai-canvas-desktop-dev"));
} else {
  // 安装版独立数据目录（4.6.8 起）：与旧版数据隔离，新装即干净；
  // 旧数据保留在 %APPDATA%\ai-canvas-desktop（不删除，需要时手动找回）。
  app.setPath("userData", path.join(app.getPath("appData"), "JaceCanvas"));
}

// 单实例保护：避免多次双击后留下无窗口的 Electron 子进程。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;
let crashCount = Number(loadRuntimeSettings().crashCount) || 0;
const MAX_CRASH_RECOVERY = 3;

// ===== 崩溃/错误日志（写 userData/logs/error.log，1MB 轮转） =====
const LOG_MAX_BYTES = 1024 * 1024;
function getLogDir() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function logCrash(entry) {
  try {
    const file = path.join(getLogDir(), "error.log");
    const line = JSON.stringify({ t: Date.now(), ...entry }) + "\n";
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) {
      try { fs.renameSync(file, file + ".old"); } catch { /* 忽略 */ }
    }
    fs.appendFileSync(file, line);
  } catch { /* 日志失败不阻塞主流程 */ }
}
ipcMain.handle("get-crash-logs", () => {
  try {
    const file = path.join(getLogDir(), "error.log");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-50).map(line => {
      try { return JSON.parse(line); } catch { return { t: 0, raw: line }; }
    });
  } catch { return []; }
});
ipcMain.handle("open-log-folder", async () => {
  try { await shell.openPath(getLogDir()); } catch { /* 忽略 */ }
  return true;
});
ipcMain.handle("log-render-error", (_event, entry) => { logCrash({ source: "renderer", ...(entry || {}) }); return true; });

// 崩溃计数持久化：主进程整体崩溃后下次启动仍能感知，用于渲染端恢复提示
function persistCrashCount() {
  try {
    const file = path.join(app.getPath("userData"), "runtime-settings.json");
    fs.writeFileSync(file, JSON.stringify({ ...loadRuntimeSettings(), crashCount }));
  } catch { /* 忽略 */ }
}

function findParamikoPython() {
  // Keep the executable and its arguments separate: on Windows `py -3` is
  // a launcher command, not a path that can be passed to spawn().
  const candidates = [];
  const add = (command, args = []) => {
    if (typeof command === "string" && command.trim()) candidates.push({ command: command.trim(), args });
  };
  add(process.env.AI_CANVAS_PYTHON);
  if (process.env.LOCALAPPDATA) {
    const pythonRoot = path.join(process.env.LOCALAPPDATA, "Programs", "Python");
    try {
      for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Python3\d+$/i.test(entry.name)) add(path.join(pythonRoot, entry.name, "python.exe"));
      }
    } catch {}
  }
  if (process.platform === "win32") {
    add("py.exe", ["-3"]);
    for (const command of ["python.exe", "python3.exe"]) {
      try { String(execFileSync("where.exe", [command], { encoding: "utf8", windowsHide: true })).split(/\r?\n/).forEach(value => add(value)); } catch {}
    }
  } else {
    add("python3");
    add("python");
  }
  const unique = [...new Map(candidates.map(candidate => [`${candidate.command}\0${candidate.args.join("\0")}`, candidate])).values()];
  for (const candidate of unique) {
    if (path.isAbsolute(candidate.command) && !fs.existsSync(candidate.command)) continue;
    try {
      execFileSync(candidate.command, [...candidate.args, "-c", "import paramiko"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
      return candidate;
    } catch {}
  }
  return null;
}

function collectSshPerformance(config) {
  return new Promise((resolve, reject) => {
    const script = [
      "import json,sys,paramiko,re",
      "c=json.loads(sys.stdin.read())",
      "s=paramiko.SSHClient(); s.set_missing_host_key_policy(paramiko.AutoAddPolicy()); s.connect(c['host'],int(c.get('port',22)),username=c['username'],password=c['password'],timeout=12,banner_timeout=12,auth_timeout=12)",
      "cmd='nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits; echo __CPU__; top -bn1 | grep -E \"Cpu\(s\)|%Cpu\" | head -1; echo __MEM__; free -b; echo __DISK__; df -BG /'",
      "_,o,e=s.exec_command(cmd,timeout=20); out=o.read().decode('utf8','replace'); err=e.read().decode('utf8','replace'); s.close()",
      "print(json.dumps({'out':out,'err':err},ensure_ascii=False))"
    ].join("\n");
    const python = findParamikoPython();
    if (!python) { reject(new Error("未找到 Python。请安装 Python 3.11，并安装 paramiko：python -m pip install paramiko")); return; }
    const child = spawn(python.command, [...python.args, "-c", script], { windowsHide:true, stdio:["pipe","pipe","pipe"] });
    let stdout="", stderr=""; child.stdout.on("data", d=>stdout+=d); child.stderr.on("data", d=>stderr+=d);
    const timer=setTimeout(()=>{try{child.kill()}catch{};reject(new Error("SSH 性能采集超时（请检查主机、端口、防火墙和网络）"))},35000);
    child.on("error", e=>{clearTimeout(timer);reject(e)}); child.on("close", code=>{clearTimeout(timer); if(code!==0)return reject(new Error(stderr||"SSH 性能采集失败")); try{resolve(JSON.parse(stdout.trim()))}catch{reject(new Error("SSH 返回格式错误"))}});
    child.stdin.end(JSON.stringify(config));
  });
}

// ============================================================
// 🖥️ 后端服务器管理
// ============================================================
async function startServer() {
  return new Promise((resolve) => {
    // 打包后 extraResources 位于 resources 目录，不能从 app.asar 内直接
    // 作为 Node 子进程入口启动；开发环境仍使用 desktop-app/server。
    const serverRoot = app.isPackaged
      ? path.join(process.resourcesPath, "server")
      : path.join(__dirname, "server");
    const serverJsPath = path.join(serverRoot, "index.js");
    
    if (!fs.existsSync(serverJsPath)) {
      console.warn("[Server] 后端服务器文件不存在，跳过启动");
      console.warn(`[Server] 期望路径: ${serverJsPath}`);
      resolve(false);
      return;
    }

    console.log("[Server] 正在启动后端服务...");
    
    // 尝试多种方式启动服务器
    const nodePaths = ["node", process.execPath];
    
    for (const nodePath of nodePaths) {
      try {
        serverProcess = spawn(nodePath, [serverJsPath], {
          // Electron 的可执行文件只有在该标志下才会按 Node.js 运行。
          // 这样即使用户没有单独安装 Node.js，打包版也能启动内嵌后端。
          env: {
            ...process.env,
            PORT: String(SERVER_PORT),
            ...(nodePath === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        break; // 成功创建进程
      } catch (e) {
        console.warn(`[Server] 无法使用 ${nodePath} 启动: ${e.message}`);
      }
    }
    
    if (!serverProcess) {
      console.warn("[Server] 无法启动后端服务进程");
      resolve(false);
      return;
    }

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        console.warn("[Server] 启动超时，继续加载应用");
        resolve(false);
      }
    }, 10000);

    serverProcess.stdout.on("data", (data) => {
      const msg = data.toString().trim();
      console.log(`[Server] ${msg}`);
      if (msg.includes("已启动") || msg.includes("running") || msg.includes("listening")) {
        started = true;
        clearTimeout(timeout);
        console.log("[Server] ✅ 后端服务启动成功");
        resolve(true);
      }
    });

    serverProcess.stderr.on("data", (data) => {
      console.error(`[Server Error] ${data.toString().trim()}`);
    });

    serverProcess.on("error", (err) => {
      console.error(`[Server] 启动失败: ${err.message}`);
      clearTimeout(timeout);
      resolve(false);
    });

    serverProcess.on("exit", (code) => {
      console.log(`[Server] 进程退出，退出码: ${code}`);
      if (!started) {
        clearTimeout(timeout);
        resolve(false);
      }
    });
  });
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    console.log("[Server] 正在停止后端服务...");
    serverProcess.kill("SIGTERM");
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }, 5000);
  }
}

// ============================================================
// 🪟 窗口管理
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0f0f0f",
    // Windows 原生标题栏覆盖到应用顶部栏，避免出现白色系统区域；
    // 右侧最小化/最大化/关闭按钮仍由系统提供。
    // 完全使用应用自己的主题化标题栏，避免系统按钮覆盖右侧配置面板。
    frame: false,
    show: false,
    icon: path.join(__dirname, "assets", "icon1.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const sendWindowState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("window-state-changed", { maximized: mainWindow.isMaximized() });
    }
  };
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.webContents.once("did-finish-load", sendWindowState);
  const indexPath = path.join(__dirname, "dist", "index.html");
  const devServerUrl = process.env.AI_CANVAS_DEV_SERVER_URL || "http://127.0.0.1:5173";
  const useDevServer = !app.isPackaged && (process.env.AI_CANVAS_DEV_SERVER === "1" || process.argv.includes("--dev-server"));

  console.log(`[App] 鍔犺浇椤甸潰: ${useDevServer ? devServerUrl : indexPath}`);

  if (useDevServer) {
    mainWindow.loadURL(devServerUrl).catch((error) => {
      console.error(`[App] Vite 鏀€鍏崇鍔犺浇澶辫触: ${error.message}`);
      mainWindow.loadFile(indexPath);
    });
    mainWindow.webContents.openDevTools();
  } else if (fs.existsSync(indexPath)) {
    mainWindow.loadFile(indexPath).catch((error) => {
      console.error(`[App] 页面加载失败: ${error.message}`);
      mainWindow.loadURL(`data:text/html;charset=utf-8,<html><body style="font-family:sans-serif;background:#0f0f1a;color:#eee;padding:40px"><h2>AI 无限画布加载失败</h2><p>${encodeURIComponent(error.message)}</p><p>请关闭所有窗口后重新启动。</p></body></html>`);
    });
  } else if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL("data:text/html;charset=utf-8,<html><body style=font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#1a1a2e;color:#eee;><div style=text-align:center><h1>⚠️ 应用文件缺失</h1><p>找不到前端构建文件</p><p>请重新运行构建脚本</p></div></body></html>");
  }

  // 某些显卡驱动/首次启动时 ready-to-show 可能迟迟不触发，不能因此让应用“后台启动”。
  const forceShowTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn("[App] 页面加载较慢，强制显示主窗口");
      mainWindow.show();
    }
  }, 8000);

  mainWindow.once("ready-to-show", () => {
    clearTimeout(forceShowTimer);
    mainWindow.show();
  });

  mainWindow.webContents.once("did-finish-load", () => {
    clearTimeout(forceShowTimer);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[App] 页面加载失败 ${errorCode}: ${errorDescription} (${validatedURL})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // ============================================================
  // 💥 崩溃防护
  // ============================================================
  mainWindow.webContents.on("render-process-gone", (event, details) => {
    console.error("[Crash] 渲染进程崩溃:", details);
    logCrash({ source: "renderer", type: "render-process-gone", reason: details?.reason, exitCode: details?.exitCode });
    if (isQuitting) return;
    crashCount++;
    persistCrashCount();
    if (crashCount <= MAX_CRASH_RECOVERY) {
      console.log(`[Crash] 尝试自动恢复 (${crashCount}/${MAX_CRASH_RECOVERY})...`);
      const crashedWindow = mainWindow;
      mainWindow = null;
      try { crashedWindow.destroy(); } catch {}
      setTimeout(() => { createWindow(); }, 1000);
    } else {
      dialog.showMessageBox({
        type: "error", title: "应用错误",
        message: "AI 无限画布遇到了不可恢复的错误",
        detail: ["渲染进程已崩溃 ", crashCount, " 次。", "", "可能原因：GPU 驱动不兼容、内存不足、系统资源耗尽", "", "建议：重启应用或更新显卡驱动。"].join("\n"),
        buttons: ["重新启动", "退出应用"], defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) { crashCount = 0; createWindow(); }
        else { app.quit(); }
      });
    }
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.warn("[App] 页面无响应");
    logCrash({ source: "renderer", type: "unresponsive" });
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ============================================================
// 🚀 应用启动
// ============================================================
app.whenReady().then(async () => {
  console.log("========================================");
  console.log(`  ${APP_NAME} v${app.getVersion()}`);
  console.log(`  Electron: ${process.versions.electron}`);
  console.log("========================================");

  // 原生英文菜单栏会在 Windows 上创建白色区域；应用内顶部栏提供实际功能菜单。
  Menu.setApplicationMenu(null);
  console.log("[GPU] GPU acceleration enabled");

  const serverStarted = await startServer();
  if (!serverStarted) {
    console.warn("[App] 后端服务未启动，部分功能可能不可用");
  }

  createWindow();

  // 生成结果缓存：启动清理一次，之后每 6 小时清理超过 48 小时未保存的文件
  try { cleanupGeneratedCache(); } catch { /* 忽略 */ }
  logCrash({ source: "main", type: "app-start", version: app.getVersion() });
  setInterval(() => { try { cleanupGeneratedCache(); } catch { /* 忽略 */ } }, 6 * 60 * 60 * 1000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      crashCount = 0;
      createWindow();
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// ============================================================
// 🛑 应用退出
// ============================================================
app.on("window-all-closed", () => { isQuitting = true; stopServer(); app.quit(); });
app.on("before-quit", () => { isQuitting = true; stopServer(); crashCount = 0; persistCrashCount(); logCrash({ source: "main", type: "app-quit" }); });
app.on("quit", () => { stopServer(); });

// ============================================================
// 📡 IPC 通信
// ============================================================
ipcMain.handle("get-server-port", () => SERVER_PORT);

ipcMain.handle("get-app-info", () => ({
  name: APP_NAME,
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle("choose-project-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "选择项目保存文件夹", properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("save-project-file", async (_event, payload) => {
  if (!payload || typeof payload.folder !== "string" || typeof payload.name !== "string") throw new Error("项目保存参数不完整");
  const folder = path.resolve(payload.folder); fs.mkdirSync(folder, { recursive: true });
  const safeName = path.basename(payload.name).replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名项目";
  const target = path.join(folder, `${safeName}.jacecanvas.json`);
  fs.writeFileSync(target, JSON.stringify({ format: "jacecanvas", version: 1, savedAt: Date.now(), name: safeName, nodes: payload.nodes || [], edges: payload.edges || [] }, null, 2), "utf8");
  return { path: target, name: safeName };
});

ipcMain.handle("open-project-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: "打开 JaceCanvas 项目", properties: ["openFile"], filters: [{ name: "JaceCanvas 项目", extensions: ["json"] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0]; return { path: file, data: JSON.parse(fs.readFileSync(file, "utf8")) };
});

ipcMain.handle("ssh-performance", async (_event, config) => {
  if (!config || typeof config.host !== "string" || typeof config.username !== "string" || typeof config.password !== "string") throw new Error("SSH 配置不完整");
  const result = await collectSshPerformance({ host:config.host, port:Number(config.port)||22, username:config.username, password:config.password });
  const lines=String(result.out||'').split(/\r?\n/); const gpuLine=lines.find(x=>x.includes(',')&&!x.startsWith('__'))||''; const gpu=gpuLine.split(',').map(x=>x.trim());
  const ci=lines.indexOf('__CPU__'), mi=lines.indexOf('__MEM__'), di=lines.indexOf('__DISK__'); const cpuLine=lines.slice(ci+1,mi).find(Boolean)||''; const cpuMatch=cpuLine.match(/(\d+(?:\.\d+)?)\s*us/); const mem=lines.slice(mi+1,di).find(x=>x.startsWith('Mem:'))?.trim().split(/\s+/)||[]; const disk=lines.slice(di+1).find(x=>x.includes('/'))?.trim().split(/\s+/)||[];
  return { source:'ssh', gpuName:gpu[0], gpuUsage:Number(gpu[1]), gpuMemoryUsed:Number(gpu[2]), gpuMemoryTotal:Number(gpu[3]), temperature:Number(gpu[4]), cpuUsage:cpuMatch?Number(cpuMatch[1]):undefined, memoryTotal:Number(mem[1])/1024/1024/1024, memoryUsed:Number(mem[2])/1024/1024/1024, memoryPercent:Number(mem[2])/Number(mem[1])*100, diskTotal:Number(disk[1]?.replace('G','')), diskUsed:Number(disk[2]?.replace('G','')), online:true };
});

ipcMain.handle("save-ssh-password", (_event, password) => {
  if (typeof password !== "string") throw new Error("SSH 密码格式错误");
  const file = path.join(app.getPath("userData"), "ssh-password.bin");
  if (!password) { try { fs.rmSync(file, { force: true }); } catch {} return true; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("系统暂不支持安全存储");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(password));
  return true;
});

ipcMain.handle("get-crash-count", () => crashCount);

  ipcMain.handle("get-ssh-password", () => {
  const file = path.join(app.getPath("userData"), "ssh-password.bin");
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file)) return "";
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch { return ""; }
});

ipcMain.handle("save-gpu-setting", (_event, enabled) => {
  const file = path.join(app.getPath("userData"), "runtime-settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...loadRuntimeSettings(), gpuAcceleration: Boolean(enabled) }));
  return true;
});

// 素材二进制由 Electron 写入本机 userData，渲染进程只保留路径元数据，避免把大文件塞进 localStorage。
ipcMain.handle("save-local-asset", async (_event, payload) => {
  if (!payload || typeof payload.name !== "string" || !payload.data) throw new Error("素材数据不完整");
  const root = path.join(app.getPath("userData"), "assets");
  const folder = String(payload.folder || "未分类").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "未分类";
  const safeName = path.basename(payload.name).replace(/[\\/:*?"<>|]/g, "_");
  const targetDir = path.join(root, folder);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, `${Date.now()}-${safeName}`);
  const source = payload.data instanceof ArrayBuffer
    ? new Uint8Array(payload.data)
    : ArrayBuffer.isView(payload.data)
      ? new Uint8Array(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength)
      : Buffer.from(String(payload.data), "base64");
  const bytes = Buffer.from(source);
  fs.writeFileSync(target, bytes);
  return { path: target, url: pathToFileURL(target).toString(), folder };
});

// ===== 生成结果缓存：自动下载 + 48 小时未保存自动清理 =====
// Flux 等签名 URL 仅 10 分钟有效，生成后自动下载到本地缓存供节点预览；
// 用户未主动保存（复制到素材库永久区）的文件超过 48 小时自动删除。
const GENERATED_CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48 小时
function getGeneratedCacheDir() {
  const dir = path.join(app.getPath("userData"), "cache", "media");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanupGeneratedCache() {
  const dir = getGeneratedCacheDir();
  const now = Date.now();
  let removed = 0;
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    try {
      const st = fs.statSync(full);
      if (st.isFile() && now - st.mtimeMs > GENERATED_CACHE_TTL_MS) { fs.unlinkSync(full); removed += 1; }
    } catch { /* 忽略单文件错误 */ }
  }
  return removed;
}
// 下载远程媒体到本地缓存，返回 file:// URL（渲染进程无文件系统权限，由主进程落盘）
ipcMain.handle("cache-media", async (_event, { url }) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("仅支持 http(s) 媒体地址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = String(res.headers.get("content-type") || "");
    let ext = (String(url).split("?")[0].match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase() || "";
    if (!/^(jpg|jpeg|png|webp|gif|mp4|webm|mov|mkv)$/.test(ext)) {
      const m = contentType.match(/^\s*(?:image|video)\/([a-z0-9.+-]+)/i);
      ext = m ? m[1].replace("jpeg", "jpg").split("+")[0] : "bin";
    }
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const target = path.join(getGeneratedCacheDir(), name);
    fs.writeFileSync(target, buffer);
    return { path: target, url: pathToFileURL(target).toString(), size: buffer.length };
  } finally {
    clearTimeout(timer);
  }
});
// 立即清理过期的生成缓存（主进程定时 + 渲染端手动均可调用）
ipcMain.handle("cleanup-cache", async () => ({ removed: cleanupGeneratedCache() }));

// 通用代理请求：渲染进程受 CORS 限制的 API（如 ElevenLabs TTS）由主进程转发
ipcMain.handle("proxy-fetch", async (_event, { url, method, headers, body }) => {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("仅支持 http(s) 地址");
  const res = await fetch(url, { method: String(method || "POST"), headers: { "Content-Type": "application/json", ...(headers || {}) }, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(buf.toString("utf8")); msg = j.message || j.error?.message || msg; } catch { /* keep status */ }
    throw new Error(String(msg));
  }
  return { b64: buf.toString("base64"), text: buf.toString("utf-8"), mime: String(res.headers.get("content-type") || "application/octet-stream") };
});

// 读取媒体文件为 base64（3D 模型预览等）：file:// 限 userData 内；http(s) 由主进程下载规避 CORS
ipcMain.handle("load-media-b64", async (_event, { url }) => {
  if (typeof url !== "string" || !url) throw new Error("参数错误");
  if (/^file:/i.test(url)) {
    const p = path.resolve(fileURLToPath(url));
    const userData = path.resolve(app.getPath("userData"));
    if (p !== userData && !p.startsWith(userData + path.sep)) throw new Error("仅允许读取应用数据目录内的文件");
    const ext = path.extname(p).toLowerCase();
    const mime = ext === ".glb" || ext === ".gltf" ? "model/gltf-binary" : ext === ".obj" ? "model/obj" : "application/octet-stream";
    return { b64: fs.readFileSync(p).toString("base64"), mime };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("仅支持 http(s) 或本地文件地址");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { b64: buf.toString("base64"), mime: String(res.headers.get("content-type") || "model/gltf-binary") };
  } finally { clearTimeout(timer); }
});
// 把缓存文件复制到素材库永久区（用户"主动保存"），避免 48 小时后被清理
ipcMain.handle("promote-cache", async (_event, { url, folder, name }) => {
  const cacheDir = getGeneratedCacheDir();
  const src = path.resolve(fileURLToPath(String(url)));
  if (src !== cacheDir && !src.startsWith(cacheDir + path.sep)) throw new Error("仅支持缓存目录中的文件");
  const root = path.join(app.getPath("userData"), "assets");
  const safeFolder = String(folder || "未分类").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "未分类";
  const base = path.basename(src);
  let safeName = String(name || base).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || base;
  if (!path.extname(safeName) && path.extname(base)) safeName += path.extname(base);
  const targetDir = path.join(root, safeFolder);
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, `${Date.now()}-${safeName}`);
  fs.copyFileSync(src, target);
  return { path: target, url: pathToFileURL(target).toString(), folder: safeFolder };
});

function findFfmpeg() {
  const candidates = [
    path.join(process.resourcesPath || __dirname, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    path.join(__dirname, "assets", "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ];
  return candidates.find(candidate => candidate === "ffmpeg.exe" || candidate === "ffmpeg" || fs.existsSync(candidate)) || null;
}

async function localMediaPath(value) {
  if (typeof value !== "string" || !value) throw new Error("视频路径为空");
  if (/^file:/i.test(value)) {
    const p = path.resolve(fileURLToPath(value));
    const userData = path.resolve(app.getPath("userData"));
    if (p !== userData && !p.startsWith(userData + path.sep)) throw new Error("仅允许处理应用数据目录内的文件");
    return p;
  }
  if (/^https?:/i.test(value)) {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`无法下载输入视频（HTTP ${response.status}）`);
    const sourceDir = path.join(app.getPath("userData"), "ffmpeg-input");
    fs.mkdirSync(sourceDir, { recursive: true });
    const rawName = decodeURIComponent(value.split("/").pop()?.split("?")[0] || "input.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${/\.[a-z0-9]{2,5}$/i.test(rawName) ? rawName : "input.mp4"}`;
    const local = path.join(sourceDir, filename);
    fs.writeFileSync(local, Buffer.from(await response.arrayBuffer()));
    return local;
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error("输入视频文件不存在");
  return resolved;
}

function runFfmpeg(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", data => { stderr += String(data); });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.trim().split(/\r?\n/).slice(-1)[0] || `FFmpeg 退出码 ${code}`)));
  });
}

// Video2X 必须使用应用随附的完整目录，禁止回退到 PATH 或系统安装目录。
function findBundledVideo2x() {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "video2x")
    : path.join(__dirname, "assets", "video2x");
  const binary = path.join(root, process.platform === "win32" ? "video2x.exe" : "video2x");
  if (!fs.existsSync(binary)) throw new Error("未找到应用内置的 Video2X Qt6。请重新安装包含本地模型的版本。");
  return { root, binary };
}

function runVideo2x(binary, cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", data => { stdout += String(data); });
    child.stderr?.on("data", data => { stderr += String(data); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) return resolve();
      const output = `${stderr}\n${stdout}`.trim();
      reject(new Error(output.split(/\r?\n/).filter(Boolean).slice(-1)[0] || `Video2X 退出码 ${code}`));
    });
  });
}

async function resolveVideo2xInput(value) {
  if (typeof value !== "string" || !value) throw new Error("视频路径为空");
  if (/^file:/i.test(value)) return fileURLToPath(value);
  if (!/^https?:/i.test(value)) {
    const local = path.resolve(value);
    if (!fs.existsSync(local)) throw new Error("输入视频文件不存在");
    return local;
  }
  // 上游 ComfyUI 结果通常是远程 URL，Video2X 只能读取本地文件。
  // 下载到用户数据目录后再交给本地 Video2X，避免要求用户手动另存视频。
  const response = await fetch(value);
  if (!response.ok) throw new Error(`无法下载输入视频 (HTTP ${response.status})`);
  const sourceDir = path.join(app.getPath("userData"), "video2x-input");
  fs.mkdirSync(sourceDir, { recursive: true });
  const rawName = decodeURIComponent(value.split("/").pop()?.split("?")[0] || "input.mp4").replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${/\.[a-z0-9]{2,5}$/i.test(rawName) ? rawName : "input.mp4"}`;
  const local = path.join(sourceDir, filename);
  fs.writeFileSync(local, Buffer.from(await response.arrayBuffer()));
  return local;
}

ipcMain.handle("ffmpeg-trim-video", async (_event, payload) => {
  const binary = findFfmpeg();
  if (!binary) throw new Error("未找到 FFmpeg。请安装 FFmpeg 并加入 PATH，或将 ffmpeg.exe 放入应用 assets\\ffmpeg 目录");
  const input = await localMediaPath(payload?.input);
  if (!fs.existsSync(input)) throw new Error("输入视频文件不存在");
  const fps = Math.max(1, Number(payload?.fps) || 30);
  const startFrame = Math.max(0, Math.round(Number(payload?.startFrame) || 0));
  const endFrame = Math.max(startFrame + 1, Math.round(Number(payload?.endFrame) || startFrame + 1));
  const start = startFrame / fps;
  const duration = Math.max(1 / fps, (endFrame - startFrame) / fps);
  const firstTime = start;
  const lastTime = Math.max(start, (endFrame - 1) / fps);
  const outDir = path.join(app.getPath("userData"), "video-edits");
  fs.mkdirSync(outDir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clip = path.join(outDir, `${id}-clip.mp4`);
  const first = path.join(outDir, `${id}-first.png`);
  const last = path.join(outDir, `${id}-last.png`);
  await runFfmpeg(binary, ["-y", "-ss", String(start), "-i", input, "-t", String(duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", clip]);
  await runFfmpeg(binary, ["-y", "-ss", String(firstTime), "-i", input, "-frames:v", "1", first]);
  await runFfmpeg(binary, ["-y", "-ss", String(lastTime), "-i", input, "-frames:v", "1", last]);
  return { clip: pathToFileURL(clip).toString(), firstFrame: pathToFileURL(first).toString(), lastFrame: pathToFileURL(last).toString(), clipPath: clip, firstPath: first, lastPath: last };
});

// 时间线合成：分镜视频（+配音）按顺序合成为完整成片
ipcMain.handle("ffmpeg-compose", async (_event, payload) => {
  const binary = findFfmpeg();
  if (!binary) throw new Error("未找到 FFmpeg。请安装 FFmpeg 并加入 PATH，或将 ffmpeg.exe 放入应用 assets\\ffmpeg 目录");
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) throw new Error("没有可合成的片段");
  const outDir = path.join(app.getPath("userData"), "video-edits");
  fs.mkdirSync(outDir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const segments = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] || {};
    const videoPath = await localMediaPath(item.video);
    if (!fs.existsSync(videoPath)) throw new Error(`第 ${i + 1} 段视频文件不存在`);
    const audioPath = item.audio ? await localMediaPath(item.audio) : null;
    const merged = path.join(outDir, `${id}-seg${String(i + 1).padStart(2, "0")}.mp4`);
    const tStart = (item.trim && Number(item.trim.start) > 0) ? Number(item.trim.start) : 0;
    const tEnd = (item.trim && Number(item.trim.end) > 0) ? Number(item.trim.end) : 0;
    const trimArgs = [];
    if (tStart > 0) trimArgs.push("-ss", String(tStart));
    if (tEnd > tStart) trimArgs.push("-t", String(tEnd - tStart));
    // -ss/-t 必须在对应 -i 之前（输入 seek），视频与音频同步裁剪
    const args = ["-y", ...trimArgs, "-i", videoPath];
    if (audioPath) args.push(...trimArgs, "-i", audioPath);
    else if (item.hasAudio) { /* 视频自带音轨：不额外加音频输入 */ }
    else args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
    const mapArgs = (item.hasAudio && !audioPath) ? ["-map", "0:v:0", "-map", "0:a:0?"] : ["-map", "0:v:0", "-map", "1:a:0"];
    args.push(...mapArgs, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", merged);
    await runFfmpeg(binary, args);
    segments.push(merged);
  }
  const concatList = path.join(outDir, `${id}-list.txt`);
  fs.writeFileSync(concatList, segments.map(s => `file '${String(s).replace(/'/g, "'\\''")}'`).join("\n"));
  const output = path.join(outDir, `${id}-final.mp4`);
  await runFfmpeg(binary, ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", output]);
  return { url: pathToFileURL(output).toString(), path: output };
});

ipcMain.on("minimize-window", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("toggle-maximize-window", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});

ipcMain.on("close-window", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.on("open-devtools", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.openDevTools({ mode: "detach" });
});

// ============================================================
// ⚠️ 未捕获异常处理（全局安全网）
// ============================================================
process.on("uncaughtException", (error) => {
  console.error("[Fatal] 未捕获异常:", error);
  logCrash({ source: "main", type: "uncaughtException", message: error?.message || String(error), stack: error?.stack });
  if (!isQuitting) {
    dialog.showErrorBox("应用错误", `发生了意外错误:\n${error.message}\n\n应用将继续运行，但建议保存工作并重启。`);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[Fatal] 未处理的 Promise 拒绝:", reason);
  logCrash({ source: "main", type: "unhandledRejection", reason: String(reason) });
});

const SANDBOX_ROOT = () => path.join(app.getPath("userData"), "source-sandbox");
const META_FILE = () => path.join(SANDBOX_ROOT(), "meta.json");
// 主源码根 = 当前运行的 desktop-app（main.js 所在目录）
const MAIN_SOURCE_ROOT = __dirname;
/** 基准源码根（方案 B）：安装版（app.asar 内）从安装目录 resources/opensource 取内置开源版本；
 *  开发版直接取当前源码目录。 */
function baseSourceRoot() {
  if (String(__dirname).includes("app.asar")) {
    const bundled = path.join(process.resourcesPath || "", "opensource");
    if (fs.existsSync(path.join(bundled, "package.json"))) return bundled;
  }
  return MAIN_SOURCE_ROOT;
}
const COPY_SKIP = new Set(["node_modules", "dist", ".git", ".vite"]);

function readSandboxMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE(), "utf8")); } catch { return { versions: [] }; }
}
function writeSandboxMeta(meta) {
  fs.mkdirSync(SANDBOX_ROOT(), { recursive: true });
  fs.writeFileSync(META_FILE(), JSON.stringify(meta, null, 2), "utf8");
}
/** 沙盒内路径校验：拒绝一切逃逸（path traversal） */
function safeSandboxPath(relPath) {
  const root = path.resolve(SANDBOX_ROOT());
  const full = path.resolve(root, String(relPath || "").replace(/^[/\\]+/, ""));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("路径超出沙盒范围，已拒绝: " + relPath);
  return full;
}
function copyDir(src, dst, opts = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (COPY_SKIP.has(entry.name) && !(opts.withNodeModules && entry.name === "node_modules")) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      if (entry.isSymbolicLink()) {
        // junction 符号链接：解析真实目标复制（打包资源时需要真实依赖）
        try { const real = fs.realpathSync(s); copyDir(real, d, opts); } catch { try { fs.symlinkSync(s, d, "junction"); } catch {} }
      } else copyDir(s, d, opts);
    } else fs.copyFileSync(s, d);
  }
}
/** 沙盒内 node_modules 用 junction 指向基准源依赖（省空间、构建直接可用） */
function linkNodeModules(sandboxDir) {
  const src = path.join(baseSourceRoot(), "node_modules");
  const dst = path.join(sandboxDir, "node_modules");
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    try { fs.symlinkSync(src, dst, "junction"); } catch { /* 失败则跳过（构建时可能慢） */ }
  }
}
function usableCount(meta) {
  // v0 永远可用；build-ok / available 视为可用候选
  return 1 + meta.versions.filter(v => v.id !== "v0" && (v.status === "available" || v.status === "build-ok")).length;
}

/* ---------- 打包安装版本（DevAgent 快捷指令） ---------- */
function makePackageBuildField(dir) {
  const build = {
    appId: "com.jacecanvas.app",
    productName: "JaceCanvas",
    directories: { output: "dist-installer", buildResources: "build" },
    files: ["dist/**", "main.js", "preload.js", "package.json", "node_modules/**"],
    asar: true,
    win: { target: [{ target: "nsis", arch: ["x64"] }] },
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
    electronDownload: { mirror: "https://npmmirror.com/mirrors/electron/" },
  };
  // 方案 B：把完整开源版本（含依赖）打进安装包 resources/opensource，安装版 AI 可改码
  const resDir = path.join(dir, "opensource-resource");
  try {
    fs.rmSync(resDir, { recursive: true, force: true });
    copyDir(dir, resDir, { withNodeModules: true });
    build.extraResources = [{ from: resDir, to: "opensource" }];
  } catch (err) {
    console.error("生成 opensource 资源失败（安装版将无法改码）:", err);
  }
  return build;
}
const packageRunning = new Map();

/* ---------- 沙盒终端（DevAgent 受限命令执行） ---------- */
// 白名单：只允许开发/构建/查询类命令；参数黑名单拦截破坏性操作
const SHELL_WHITELIST = ["npm", "npx", "node", "git", "tsc", "vite", "dir", "ls", "echo", "type", "cat", "findstr", "grep"];
const SHELL_BLACKLIST = /(rm\s+-rf|del\s+\/|format|shutdown|taskkill|rd\s+\/|mkfs|dd\s+of=|:>|\|\s*format|powershell[^|]*remove|remove-item|rmdir\s+\/s)/i;
const SHELL_TIMEOUT = 60000;

ipcMain.handle("source-run-command", async (_event, { versionId, command }) => {
  const meta = readSandboxMeta();
  const v = meta.versions.find(x => x.id === versionId);
  if (!v) throw new Error("版本不存在: " + versionId);
  if (v.id === "v0") throw new Error("终端命令只能在沙盒分支版本中执行（主版本只读）");
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("命令为空");
  // 白名单前缀
  const allowed = SHELL_WHITELIST.some(w => cmd === w || cmd.startsWith(w + " ") || cmd.startsWith(w + "."));
  if (!allowed) throw new Error("命令不在白名单内（仅允许 npm/npx/node/git/tsc/vite/dir/echo/type 等开发命令）");
  if (SHELL_BLACKLIST.test(cmd)) throw new Error("命令包含危险操作，已拒绝");
  // 在沙盒目录内执行（cwd 固定），带超时与输出截断
  return await new Promise((resolve) => {
    let out = "";
    let killed = false;
    const finish = (ok, extra) => resolve({ ok, output: (out + (extra || "")).slice(-4000), code: ok ? 0 : 1 });
    const child = spawn(cmd, { cwd: v.path, shell: true, windowsHide: true });
    const timer = setTimeout(() => { killed = true; try { child.kill(); } catch {} finish(false, "\n[命令超时，已终止（60s）]"); }, SHELL_TIMEOUT);
    child.stdout.on("data", d => { out += String(d); if (out.length > 6000 && !killed) { killed = true; try { child.kill(); } catch {} finish(false, "\n[输出过长，已终止]"); } });
    child.stderr.on("data", d => { out += String(d); });
    child.on("close", code => { clearTimeout(timer); if (!killed) finish(code === 0, ""); });
    child.on("error", e => { clearTimeout(timer); if (!killed) finish(false, "\n启动失败: " + String(e.message)); });
  });
});

ipcMain.handle("source-package", async (_event, { versionId } = {}) => {
  const meta = readSandboxMeta();
  const v = versionId && versionId !== "v0" ? meta.versions.find(x => x.id === versionId) : null;
  const dir = v ? v.path : MAIN_SOURCE_ROOT;
  if (!v) throw new Error("请指定沙盒版本（v0 主版本不打包）");
  if (packageRunning.get(versionId)) return { started: true, message: "该版本已在打包中，请稍后查询状态" };
  const logFile = path.join(dir, "package.log");
  const log = (m) => { try { fs.appendFileSync(logFile, m + "\n"); } catch {} };
  log("=== 打包开始 " + new Date().toISOString() + " ===");
  packageRunning.set(versionId, { status: "running", startedAt: Date.now(), logFile });
  const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    child.stdout.on("data", d => log(String(d)));
    child.stderr.on("data", d => log(String(d)));
    child.on("close", code => (code === 0 ? resolve() : reject(new Error("退出码 " + code))));
    child.on("error", reject);
  });
  void (async () => {
    try {
      // 1) 沙盒 package.json 注入 build 字段（不影响主版本）
      const pkgPath = path.join(dir, "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      pkg.build = makePackageBuildField(dir);
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
      log("build 字段已注入（含 opensource 开源版本资源，安装版可改码）");
      // 2) 构建 web 产物
      log("vite build 开始…");
      await run("npx", ["vite", "build"], dir);
      log("vite build 完成");
      // 3) 确保 electron-builder 可用（junction 共享主版本 node_modules）
      const hasBuilder = fs.existsSync(path.join(MAIN_SOURCE_ROOT, "node_modules", "electron-builder"));
      if (!hasBuilder) { log("安装 electron-builder（首次需联网，较慢）…"); await run("npm", ["install", "--no-save", "-D", "electron-builder"], MAIN_SOURCE_ROOT); }
      // 4) 打包 nsis 安装版
      log("electron-builder 打包中（首次会下载 Electron 二进制，可能需要几分钟）…");
      await run("npx", ["electron-builder", "--win", "nsis"], dir);
      const out = path.join(dir, "dist-installer");
      const exes = fs.existsSync(out) ? fs.readdirSync(out).filter(f => f.endsWith(".exe")) : [];
      log("=== 打包完成：安装包位于 " + out + (exes.length ? "，文件: " + exes.join(", ") : "") + " ===");
      log("说明：安装包已内置 opensource 开源版本（含依赖），安装版用户也可用 DevAgent 修改源码。");
      packageRunning.set(versionId, { status: "done", doneAt: Date.now(), logFile, output: out, exes });
    } catch (err) {
      log("=== 打包失败: " + String(err.message || err) + " ===");
      packageRunning.set(versionId, { status: "failed", doneAt: Date.now(), logFile, error: String(err.message || err).slice(0, 400) });
    }
  })();
  return { started: true, message: "打包已在后台开始（首次需下载 Electron 二进制，可能较慢）。完成后安装包在 " + path.join(dir, "dist-installer") + "，可随时查询状态。" };
});

ipcMain.handle("source-package-status", (_event, { versionId }) => {
  const info = packageRunning.get(versionId);
  if (!info) return { status: "unknown" };
  let tail = "";
  try { tail = fs.readFileSync(info.logFile, "utf8").split("\n").slice(-25).join("\n"); } catch {}
  return { ...info, tail };
});

ipcMain.handle("source-open-path", async (_event, dir) => {
  // 打开沙盒目录（shell.openPath，安全：只读打开路径，不执行命令）
  try { await shell.openPath(String(dir || "")); return true; } catch { return false; }
});

ipcMain.handle("source-list-versions", () => {
  const meta = readSandboxMeta();
  return {
    root: SANDBOX_ROOT(),
    mainRoot: MAIN_SOURCE_ROOT,
    versions: [
      { id: "v0", tag: "主版本（原始）", status: "available", createdAt: 0, path: MAIN_SOURCE_ROOT, deletable: false },
      ...meta.versions.map(v => ({ ...v, deletable: v.id !== "v0" })),
    ],
  };
});

/** 复制一份最新源码为新版本（原版本不动）。若用户已存在沙盒目录则在此基础上复制。 */
ipcMain.handle("source-create-branch", (_event, { fromId, tag } = {}) => {
  const meta = readSandboxMeta();
  // 来源：默认从主版本复制；也可从指定版本（从该版本目录复制）
  const from = fromId && fromId !== "v0" ? meta.versions.find(v => v.id === fromId) : null;
  const src = from ? from.path : baseSourceRoot();
  const id = "v" + (Date.now());
  const dir = path.join(SANDBOX_ROOT(), id);
  copyDir(src, dir);
  linkNodeModules(dir);
  meta.versions.push({ id, createdAt: Date.now(), fromId: from ? from.id : "v0", tag: tag || "未命名修改", status: "created", path: dir });
  writeSandboxMeta(meta);
  return { id, path: dir, fromId: from ? from.id : "v0" };
});

ipcMain.handle("source-read-file", (_event, { versionId, path: relPath }) => {
  const meta = readSandboxMeta();
  const v = meta.versions.find(x => x.id === versionId);
  if (!v) throw new Error("版本不存在: " + versionId);
  const full = safeSandboxPath(path.join(v.path, relPath));
  return fs.readFileSync(full, "utf8");
});

ipcMain.handle("source-write-file", (_event, { versionId, path: relPath, content }) => {
  const meta = readSandboxMeta();
  const v = meta.versions.find(x => x.id === versionId);
  if (!v) throw new Error("版本不存在: " + versionId);
  if (v.id === "v0") throw new Error("不能修改主版本！请先创建分支副本。");
  const full = safeSandboxPath(path.join(v.path, relPath));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  // 标记状态：有改动后不再是全新副本
  const idx = meta.versions.findIndex(x => x.id === versionId);
  if (meta.versions[idx].status === "created") meta.versions[idx].status = "modified";
  writeSandboxMeta(meta);
  return { ok: true, path: relPath };
});

/** 在沙盒版本内跑构建校验（tsc --noEmit + vite build），成功标记 build-ok */
ipcMain.handle("source-build-test", async (_event, { versionId }) => {
  const meta = readSandboxMeta();
  const v = meta.versions.find(x => x.id === versionId);
  if (!v || v.id === "v0") throw new Error("请指定一个沙盒分支版本");
  const cmd = "npx";
  const run = (args) => new Promise((resolve, reject) => {
    // Windows 上 npx 是 .cmd，需要 shell 展开（args 为固定数组，无用户输入，安全）
    const child = spawn(cmd, args, { cwd: v.path, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (out += d));
    child.on("close", code => (code === 0 ? resolve(out) : reject(new Error(out.slice(-800) || "构建失败"))));
    child.on("error", reject);
  });
  try {
    const tsc = await run(["tsc", "--noEmit"]);
    const idx = meta.versions.findIndex(x => x.id === versionId);
    meta.versions[idx].status = "build-ok";
    meta.versions[idx].lastBuildAt = Date.now();
    writeSandboxMeta(meta);
    return { ok: true, status: "build-ok", log: "tsc --noEmit 通过" + (tsc ? "" : "") };
  } catch (err) {
    return { ok: false, status: "build-failed", log: String(err.message || err).slice(0, 1200) };
  }
});

/** 用户测试通过 → 标记 available（纳入删除保护计数） */
ipcMain.handle("source-mark-usable", (_event, { versionId, note }) => {
  const meta = readSandboxMeta();
  const idx = meta.versions.findIndex(x => x.id === versionId);
  if (idx === -1) throw new Error("版本不存在: " + versionId);
  meta.versions[idx].status = "available";
  if (note) meta.versions[idx].note = note;
  writeSandboxMeta(meta);
  return { ok: true, status: "available" };
});

/** 删除版本：强制保留 ≥2 个可用版本；v0 永不可删；删除不可恢复 */
ipcMain.handle("source-delete-version", (_event, { versionId }) => {
  const meta = readSandboxMeta();
  const v = meta.versions.find(x => x.id === versionId);
  if (!v) throw new Error("版本不存在: " + versionId);
  if (v.id === "v0") throw new Error("主版本不可删除");
  // 删除保护：至少保留 2 个版本；若删除的是可用版本（available/build-ok），删除后可用版本数（v0 恒可用）必须 ≥2
  const remaining = meta.versions.filter(x => x.id !== versionId);
  if (remaining.length + 1 < 2) throw new Error("删除被拒绝：至少保留 2 个源码版本。");
  const targetUsable = v.status === "available" || v.status === "build-ok";
  const usableAfter = 1 + remaining.filter(x => x.status === "available" || x.status === "build-ok").length;
  if (targetUsable && usableAfter < 2) throw new Error("删除被拒绝：规则要求始终保留 2 个可用版本（删除后仅剩 " + usableAfter + " 个）。请先让另一个版本可用或通过构建校验。");
  try { fs.rmSync(v.path, { recursive: true, force: true }); } catch { /* 目录可能已被手动删除 */ }
  writeSandboxMeta({ versions: remaining });
  return { ok: true, message: "已删除版本 " + versionId + "（不可恢复）" };
});

