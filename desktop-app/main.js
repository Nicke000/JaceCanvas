/**
 * JaceCanvas - Electron 主进程
 * 
 * 功能：
 * - GPU 硬件加速渲染
 * - 内嵌后端 API 服务器
 * - 崩溃防护与自动恢复
 * - 本地文件加载（无需网络）
 */

const { app, BrowserWindow, shell, dialog, ipcMain, safeStorage } = require("electron");
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
if (!gpuAcceleration) app.disableHardwareAcceleration();

// ============================================================
// 🔥 GPU 加速配置
// ============================================================
// 启用 GPU 硬件加速（Chromium 渲染引擎）
// 用户手动关闭时保留软件渲染回退，避免部分旧显卡驱动导致黑屏。
if (!gpuAcceleration) app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blacklist");
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-accelerated-video-encode");
app.commandLine.appendSwitch("enable-features", "VaapiVideoDecoder,CanvasOopRasterization");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
app.commandLine.appendSwitch("enable-gpu-memory-buffer-video-frames");

// WebGL 相关优化
app.commandLine.appendSwitch("enable-webgl");
app.commandLine.appendSwitch("enable-webgl2");
app.commandLine.appendSwitch("enable-unsafe-webgpu");

// 禁用可能干扰的 Chromium 特性
app.commandLine.appendSwitch("disable-features", "UseChromeOSDirectVideoDecoder");

// 强制使用独立 GPU（如果有双显卡）
app.commandLine.appendSwitch("force_high_performance_gpu");

// 禁用 GPU 沙箱以获得更好的 GPU 访问权限
app.commandLine.appendSwitch("disable-gpu-sandbox");

// ============================================================
// 应用配置
// ============================================================
const APP_NAME = "JaceCanvas";
const SERVER_PORT = 3001;

// 单实例保护：避免多次双击后留下无窗口的 Electron 子进程。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let serverProcess = null;
let isQuitting = false;
let crashCount = 0;
const MAX_CRASH_RECOVERY = 3;

function findParamikoPython(){const candidates=[];const add=(command,args=[])=>{if(typeof command==="string"&&command.trim())candidates.push({command:command.trim(),args})};add(process.env.AI_CANVAS_PYTHON);if(process.env.LOCALAPPDATA){const root=path.join(process.env.LOCALAPPDATA,"Programs","Python");try{for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(entry.isDirectory()&&/^Python3\d+$/i.test(entry.name))add(path.join(root,entry.name,"python.exe"))}}catch{}}if(process.platform==="win32"){add("py.exe",["-3"]);for(const command of ["python.exe","python3.exe"]){try{String(execFileSync("where.exe",[command],{encoding:"utf8",windowsHide:true})).split(/\r?\n/).forEach(value=>add(value))}catch{}}}else{add("python3");add("python")}const unique=[...new Map(candidates.map(candidate=>[`${candidate.command}\0${candidate.args.join("\0")}`,candidate])).values()];for(const candidate of unique){if(path.isAbsolute(candidate.command)&&!fs.existsSync(candidate.command))continue;try{execFileSync(candidate.command,[...candidate.args,"-c","import paramiko"],{stdio:"ignore",windowsHide:true,timeout:5000});return candidate}catch{}}return null}

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
    const python=findParamikoPython(); if(!python){reject(new Error("未找到可用的 Python + Paramiko。请安装 Python 3.11，并执行：python -m pip install paramiko"));return;}
    const child = spawn(python.command, [...python.args, "-c", script], { windowsHide:true, stdio: ["pipe", "pipe", "pipe"] });
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

  const indexPath = path.join(__dirname, "dist", "index.html");
  
  console.log(`[App] 加载页面: ${indexPath}`);
  
  if (fs.existsSync(indexPath)) {
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
    if (isQuitting) return;
    crashCount++;
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

  console.log("[GPU] GPU 加速已启用");

  const serverStarted = await startServer();
  if (!serverStarted) {
    console.warn("[App] 后端服务未启动，部分功能可能不可用");
  }

  createWindow();

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
app.on("before-quit", () => { isQuitting = true; stopServer(); });
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

function findFfmpeg() {
  const candidates = [
    path.join(process.resourcesPath || __dirname, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    path.join(__dirname, "assets", "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ];
  return candidates.find(candidate => candidate === "ffmpeg.exe" || candidate === "ffmpeg" || fs.existsSync(candidate)) || null;
}

function localMediaPath(value) {
  if (typeof value !== "string" || !value) throw new Error("视频路径为空");
  if (/^file:/i.test(value)) return fileURLToPath(value);
  if (/^https?:/i.test(value)) throw new Error("FFmpeg 剪辑需要本地视频文件，请先将视频保存到素材库");
  return path.resolve(value);
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
  const root = app.isPackaged ? path.join(process.resourcesPath, "video2x") : path.join(__dirname, "assets", "video2x");
  const binary = path.join(root, process.platform === "win32" ? "video2x.exe" : "video2x");
  if (!fs.existsSync(binary)) throw new Error("未找到应用内置的 Video2X Qt6。请重新安装包含本地模型的版本。");
  return { root, binary };
}
function runVideo2x(binary, cwd, args) { return new Promise((resolve, reject) => { const child=spawn(binary,args,{cwd,windowsHide:true}); let stderr=""; child.stderr.on("data",d=>{stderr+=String(d)}); child.on("error",reject); child.on("close",code=>code===0?resolve():reject(new Error(stderr.trim().split(/\r?\n/).slice(-1)[0]||`Video2X 退出码 ${code}`))); }); }
ipcMain.handle("video2x-process", async (_event, payload) => {
  const input=localMediaPath(payload?.input); if(!fs.existsSync(input)) throw new Error("输入视频文件不存在"); const {root,binary}=findBundledVideo2x();
  const mode=["upscale","interpolate","both"].includes(payload?.mode)?payload.mode:"upscale"; const scale=Math.max(2,Math.min(4,Number(payload?.scale)||2)); const mul=[2,4].includes(Number(payload?.frameRateMul))?Number(payload.frameRateMul):2; const model=String(payload?.model||"realesr-animevideov3"); const outDir=path.join(app.getPath("userData"),"video2x-output"); fs.mkdirSync(outDir,{recursive:true}); const id=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`; const first=path.join(outDir,`${id}-upscaled.mp4`); const output=path.join(outDir,`${id}.mp4`);
  if(mode==="upscale"||mode==="both"){const args=["-i",input,"-o",mode==="both"?first:output,"-p",model==="realcugan"?"realcugan":"realesrgan","-s",String(scale),"--no-progress"];if(model==="realcugan")args.push("--realcugan-model","models-se");await runVideo2x(binary,root,args)} if(mode==="interpolate"||mode==="both") await runVideo2x(binary,root,["-i",mode==="both"?first:input,"-o",output,"-p","rife","-m",String(mul),"--rife-model",model.startsWith("rife-")?model:"rife-v4.26","--no-progress"]);
  return {path:output,url:pathToFileURL(output).toString(),filename:path.basename(output)};
});

ipcMain.handle("ffmpeg-trim-video", async (_event, payload) => {
  const binary = findFfmpeg();
  if (!binary) throw new Error("未找到 FFmpeg。请安装 FFmpeg 并加入 PATH，或将 ffmpeg.exe 放入应用 assets\\ffmpeg 目录");
  const input = localMediaPath(payload?.input);
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

ipcMain.on("minimize-window", () => {
  if (mainWindow) mainWindow.minimize();
});

// ============================================================
// ⚠️ 未捕获异常处理（全局安全网）
// ============================================================
process.on("uncaughtException", (error) => {
  console.error("[Fatal] 未捕获异常:", error);
  if (!isQuitting) {
    dialog.showErrorBox("应用错误", `发生了意外错误:\n${error.message}\n\n应用将继续运行，但建议保存工作并重启。`);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[Fatal] 未处理的 Promise 拒绝:", reason);
});
