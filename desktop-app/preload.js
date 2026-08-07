/**
 * AI 无限画布 - Electron 预加载脚本
 * 通过 contextBridge 安全地暴露 API 给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let promptSettings = null;
try {
  const configPath = path.join(__dirname, 'config', 'prompt-settings.json');
  if (fs.existsSync(configPath)) promptSettings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {}

contextBridge.exposeInMainWorld('electronAPI', {
  // 源码沙盒（AI Agent 修改源码的安全机制）
  sourceApi: {
    listVersions: () => ipcRenderer.invoke('source-list-versions'),
    createBranch: (payload) => ipcRenderer.invoke('source-create-branch', payload),
    readFile: (payload) => ipcRenderer.invoke('source-read-file', payload),
    writeFile: (payload) => ipcRenderer.invoke('source-write-file', payload),
    buildTest: (payload) => ipcRenderer.invoke('source-build-test', payload),
    markUsable: (payload) => ipcRenderer.invoke('source-mark-usable', payload),
    deleteVersion: (payload) => ipcRenderer.invoke('source-delete-version', payload),
    openPath: (dir) => ipcRenderer.invoke('source-open-path', dir),
    package: (payload) => ipcRenderer.invoke('source-package', payload),
    packageStatus: (payload) => ipcRenderer.invoke('source-package-status', payload),
    runCommand: (payload) => ipcRenderer.invoke('source-run-command', payload),
  },

  // 平台信息
  platform: process.platform,
  isElectron: true,
  promptSettings,

  // 获取服务器端口
  getServerPort: () => ipcRenderer.invoke('get-server-port'),

  // 获取应用信息
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  chooseProjectFolder: () => ipcRenderer.invoke('choose-project-folder'),
  saveProjectFile: (payload) => ipcRenderer.invoke('save-project-file', payload),
  openProjectFile: () => ipcRenderer.invoke('open-project-file'),
  sshPerformance: (config) => ipcRenderer.invoke('ssh-performance', config),
  saveSshPassword: (password) => ipcRenderer.invoke('save-ssh-password', password),
  getSshPassword: () => ipcRenderer.invoke('get-ssh-password'),
  getCrashCount: () => ipcRenderer.invoke('get-crash-count'),
  getCrashLogs: () => ipcRenderer.invoke('get-crash-logs'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  logRenderError: (entry) => ipcRenderer.invoke('log-render-error', entry),
  saveGpuSetting: (enabled) => ipcRenderer.invoke('save-gpu-setting', enabled),
  saveLocalAsset: (payload) => ipcRenderer.invoke('save-local-asset', payload),
  cacheMedia: (payload) => ipcRenderer.invoke('cache-media', payload),
  cleanupCache: () => ipcRenderer.invoke('cleanup-cache'),
  promoteCache: (payload) => ipcRenderer.invoke('promote-cache', payload),
  loadMediaB64: (payload) => ipcRenderer.invoke('load-media-b64', payload),
  proxyFetch: (payload) => ipcRenderer.invoke('proxy-fetch', payload),
  ffmpegTrimVideo: (payload) => ipcRenderer.invoke('ffmpeg-trim-video', payload),
  ffmpegCompose: (payload) => ipcRenderer.invoke('ffmpeg-compose', payload),
  video2xProcess: (payload) => ipcRenderer.invoke('video2x-process', payload),

  // 窗口控制
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.send('toggle-maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  onWindowStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window-state-changed', listener);
    return () => ipcRenderer.removeListener('window-state-changed', listener);
  },
  openDevTools: () => ipcRenderer.send('open-devtools'),
});
