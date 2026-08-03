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
  saveGpuSetting: (enabled) => ipcRenderer.invoke('save-gpu-setting', enabled),
  saveLocalAsset: (payload) => ipcRenderer.invoke('save-local-asset', payload),
  ffmpegTrimVideo: (payload) => ipcRenderer.invoke('ffmpeg-trim-video', payload),
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
