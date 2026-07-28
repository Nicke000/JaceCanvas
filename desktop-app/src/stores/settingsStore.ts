import { create } from 'zustand';

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  concurrency: number;
  optimizerProvider: 'openai' | 'gemini' | 'anthropic' | 'ollama';
  optimizerBaseUrl: string;
  optimizerApiKey: string;
  optimizerModel: string;
  storyboardSystemPrompt: string;
  comfyUrl: string;
  sshHost: string; sshPort: number; sshUsername: string; sshPassword: string;
  gpuAcceleration: boolean;
}

const DEFAULT: ApiSettings = {
  // 开源版不绑定任何个人主控；用户需要在设置中填写自己的地址。
  baseUrl: '',
  apiKey: '',
  timeout: 600000,
  concurrency: 3,
  optimizerProvider: 'openai',
  optimizerBaseUrl: 'https://api.openai.com/v1',
  optimizerApiKey: '',
  optimizerModel: 'gpt-4o-mini',
  storyboardSystemPrompt: '',
  comfyUrl: '',
  sshHost: '', sshPort: 22, sshUsername: '', sshPassword: '',
  gpuAcceleration: true,
};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

const STORAGE_KEY = 'ai-canvas-settings';

function load(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const injected = (window as any).electronAPI?.promptSettings || {};
    const loaded = { ...DEFAULT, ...(raw ? JSON.parse(raw) : {}), ...injected };
    // 旧版本可能保存过错误的 generate 路径，统一迁移到服务根地址。
    if (loaded.baseUrl.endsWith('/api/workflow/generate')) loaded.baseUrl = DEFAULT.baseUrl;
    return loaded;
  } catch { return DEFAULT; }
}

function save(s: ApiSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface SettingsStore extends ApiSettings {
  setBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setTimeout: (t: number) => void;
  setConcurrency: (n: number) => void;
  setOptimizerProvider: (provider: ApiSettings['optimizerProvider']) => void;
  setOptimizerBaseUrl: (url: string) => void;
  setOptimizerApiKey: (key: string) => void;
  setOptimizerModel: (model: string) => void;
  setStoryboardSystemPrompt: (prompt: string) => void;
  setComfyUrl: (url: string) => void;
  setSsh: (value: Pick<ApiSettings,'sshHost'|'sshPort'|'sshUsername'|'sshPassword'>) => void;
  reset: () => void;
  getSettings: () => ApiSettings;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  ...load(),
  setBaseUrl: (url) => { const baseUrl = normalizeUrl(url); set({ baseUrl }); save({ ...get(), baseUrl }); },
  setApiKey: (key) => { set({ apiKey: key }); save({ ...get(), apiKey: key }); },
  setTimeout: (t) => { set({ timeout: t }); save({ ...get(), timeout: t }); },
  setConcurrency: (n) => { set({ concurrency: n }); save({ ...get(), concurrency: n }); },
  setOptimizerProvider: (optimizerProvider) => { set({ optimizerProvider }); save({ ...get(), optimizerProvider }); },
  setOptimizerBaseUrl: (optimizerBaseUrl) => { set({ optimizerBaseUrl }); save({ ...get(), optimizerBaseUrl }); },
  setOptimizerApiKey: (optimizerApiKey) => { set({ optimizerApiKey }); save({ ...get(), optimizerApiKey }); },
  setOptimizerModel: (optimizerModel) => { set({ optimizerModel }); save({ ...get(), optimizerModel }); },
  setStoryboardSystemPrompt: (storyboardSystemPrompt) => { set({ storyboardSystemPrompt }); save({ ...get(), storyboardSystemPrompt }); },
  setComfyUrl: (comfyUrl) => { set({ comfyUrl }); save({ ...get(), comfyUrl }); },
  setSsh: (value) => { set(value); save({ ...get(), ...value }); },
  reset: () => { set(DEFAULT); save(DEFAULT); },
  getSettings: () => ({ baseUrl: get().baseUrl, apiKey: get().apiKey, timeout: get().timeout, concurrency: get().concurrency, optimizerProvider: get().optimizerProvider, optimizerBaseUrl: get().optimizerBaseUrl, optimizerApiKey: get().optimizerApiKey, optimizerModel: get().optimizerModel, storyboardSystemPrompt:get().storyboardSystemPrompt, comfyUrl: get().comfyUrl, sshHost:get().sshHost,sshPort:get().sshPort,sshUsername:get().sshUsername,sshPassword:get().sshPassword, gpuAcceleration:get().gpuAcceleration }),
}));
