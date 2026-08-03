import { create } from 'zustand';
import type { BailianRegion } from '@/services/bailianTextToImage.service';
import { PAID_PROVIDER_IDS, type PaidProviderId } from '@/config/paidApiAdapters';

export type ProviderType = 'openai' | 'gemini' | 'anthropic' | 'ollama';

export interface PaidApiProfile {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  selectedModel: string;
}

export type PaidApiNodeKind = 'paidTextToImage' | 'paidImageToImage' | 'paidTextToVideo' | 'paidImageToVideo' | 'paidCapability';

export interface PaidApiNodeSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  models: string[];
  selectedModel: string;
  modelsPath?: string;
  imagePath?: string;
  videoPath?: string;
  taskPath?: string;
  capabilityPath?: string;
  authMode?: 'bearer' | 'x-api-key' | 'query-key' | 'none';
  /** 仅 custom/gateway 使用：用户明确声明该接口可用的扩展能力。 */
  enabledCapabilities?: string[];
  selectedCapability?: string;
}

export interface PaidApiProviderSettings {
  provider: PaidProviderId;
  apiKey: string;
  baseUrl: string;
  region?: BailianRegion;
  workspaceId?: string;
  models: string[];
  selectedModel?: string;
}

export interface BailianTextToImageSettings {
  apiKey: string;
  region: BailianRegion;
  workspaceId: string;
  baseUrl: string;
}

export const PAID_API_NODE_KINDS: PaidApiNodeKind[] = ['paidTextToImage', 'paidImageToImage', 'paidTextToVideo', 'paidImageToVideo', 'paidCapability'];

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  concurrency: number;
  optimizerProvider: ProviderType;
  optimizerBaseUrl: string;
  optimizerApiKey: string;
  optimizerModel: string;
  optimizerModels: string[];
  optimizerPromptOverrides: Partial<Record<string, string>>;
  storyboardSystemPrompt: string;
  comfyUrl: string;
  sshCommand: string; sshHost: string; sshPort: number; sshUsername: string; sshPassword: string;
  gpuAcceleration: boolean;
  chatProvider: ProviderType;
  chatBaseUrl: string;
  chatApiKey: string;
  chatModel: string;
  chatModels: string[];
  chatSystemPrompt: string;
  chatThinkingMode: 'auto' | 'fast' | 'deep';
  /** 付费 API 配置（统一在设置中管理，节点只引用） */
  paidApiProvider: string;
  paidApiKey: string;
  paidApiBaseUrl: string;
  paidApiModels: string[];
  paidApiSelectedModel: string;
  paidApiAspectRatio: string;
  paidApiWidth: number;
  paidApiHeight: number;
  paidApiProfiles: PaidApiProfile[];
  paidApiNodes: Record<PaidApiNodeKind, PaidApiNodeSettings>;
  paidApiProviders: Record<PaidProviderId, PaidApiProviderSettings>;
  bailianTextToImage: BailianTextToImageSettings;
}

const EMPTY_PAID_NODE = (): PaidApiNodeSettings => ({ provider: '', apiKey: '', baseUrl: '', models: [], selectedModel: '', modelsPath: '', imagePath: '', videoPath: '', taskPath: '', capabilityPath: '', authMode: 'bearer', enabledCapabilities: [], selectedCapability: '' });
const DEFAULT_PAID_PROVIDERS = Object.fromEntries(PAID_PROVIDER_IDS.map(provider => [provider, { provider, apiKey: '', baseUrl: '', models: [] as string[], selectedModel: '' }])) as unknown as Record<PaidProviderId, PaidApiProviderSettings>;

const DEFAULT: ApiSettings = {
  baseUrl: '',
  apiKey: '',
  timeout: 600000,
  concurrency: 1,
  optimizerProvider: 'openai',
  optimizerBaseUrl: 'https://api.openai.com/v1',
  optimizerApiKey: '',
  optimizerModel: 'gpt-4o-mini',
  optimizerModels: [],
  optimizerPromptOverrides: {},
  storyboardSystemPrompt: '',
  comfyUrl: '',
  sshCommand: '', sshHost: '', sshPort: 22, sshUsername: '', sshPassword: '',
  gpuAcceleration: true,
  chatProvider: 'openai', chatBaseUrl: 'https://api.openai.com/v1', chatApiKey: '', chatModel: 'gpt-4o-mini', chatModels: [], chatSystemPrompt: '你是一个专业、可靠的创作助手。', chatThinkingMode: 'auto',
  paidApiProvider: '', paidApiKey: '', paidApiBaseUrl: '', paidApiModels: [], paidApiSelectedModel: '', paidApiAspectRatio: '1:1', paidApiWidth: 1024, paidApiHeight: 1024, paidApiProfiles: [], paidApiProviders: DEFAULT_PAID_PROVIDERS,
  paidApiNodes: {
    paidTextToImage: EMPTY_PAID_NODE(), paidImageToImage: EMPTY_PAID_NODE(),
    paidTextToVideo: EMPTY_PAID_NODE(), paidImageToVideo: EMPTY_PAID_NODE(), paidCapability: EMPTY_PAID_NODE(),
  },
  bailianTextToImage: { apiKey: '', region: 'cn-beijing', workspaceId: '', baseUrl: '' },
};

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** 将云服务器提供的 ssh 命令安全地解析为连接参数，不执行用户输入。 */
export function parseSshCommand(command: string): { host: string; port: number; username: string } | null {
  const input = command.trim().replace(/^['"]|['"]$/g, '');
  if (!input) return null;
  const tokens = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(item => item.replace(/^['"]|['"]$/g, '')) || [];
  if (tokens[0]?.toLowerCase() === 'ssh') tokens.shift();
  let port = 22;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === '-p' || tokens[index] === '--port') {
      const parsed = Number(tokens[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
      port = parsed;
      tokens.splice(index, 2);
      index -= 1;
    }
  }
  const target = tokens.find(item => !item.startsWith('-') && item.includes('@')) || tokens.find(item => !item.startsWith('-'));
  if (!target) return null;
  const [userPart, hostPart] = target.includes('@') ? target.split(/@(.+)/, 2) : ['', target];
  const host = (hostPart || '').trim();
  const username = (userPart || '').trim();
  if (!host || !/^[a-zA-Z0-9_.:[\]-]+$/.test(host) || (username && !/^[\w.-]+$/.test(username))) return null;
  return { host, port, username };
}

const STORAGE_KEY = 'ai-canvas-settings';
const SETTINGS_VERSION_KEY = 'ai-canvas-settings-version';
const SETTINGS_VERSION = '4.6.3';

function load(): ApiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const injected = (window as any).electronAPI?.promptSettings || {};
    // prompt-settings.json 只作为首次启动默认值；用户在设置页保存的值必须优先。
    const loaded = { ...DEFAULT, ...injected, ...(raw ? JSON.parse(raw) : {}) };
    // 4.5.2 的默认并发数是 3，升级到 4.6.0 时将未主动调整过的旧默认值迁移为 1。
    if (localStorage.getItem(SETTINGS_VERSION_KEY) !== SETTINGS_VERSION && loaded.concurrency === 3) loaded.concurrency = 1;
    localStorage.setItem(SETTINGS_VERSION_KEY, SETTINGS_VERSION);
    if (loaded.baseUrl.endsWith('/api/workflow/generate')) loaded.baseUrl = DEFAULT.baseUrl;
    if (!Array.isArray(loaded.chatModels)) loaded.chatModels = [];
    if (!Array.isArray(loaded.optimizerModels)) loaded.optimizerModels = [];
    if (!loaded.optimizerPromptOverrides || typeof loaded.optimizerPromptOverrides !== 'object') loaded.optimizerPromptOverrides = {};
    if (!Array.isArray(loaded.paidApiModels)) loaded.paidApiModels = [];
    if (!Array.isArray(loaded.paidApiProfiles)) loaded.paidApiProfiles = [];
    if (!loaded.paidApiProfiles.length && loaded.paidApiProvider) loaded.paidApiProfiles = [{ id:'default', name:'默认付费 API', provider:loaded.paidApiProvider, apiKey:loaded.paidApiKey || '', baseUrl:loaded.paidApiBaseUrl || '', models:loaded.paidApiModels, selectedModel:loaded.paidApiSelectedModel || '' }];
    const legacyPaid: PaidApiNodeSettings = { provider: loaded.paidApiProvider || '', apiKey: loaded.paidApiKey || '', baseUrl: loaded.paidApiBaseUrl || '', models: Array.isArray(loaded.paidApiModels) ? loaded.paidApiModels : [], selectedModel: loaded.paidApiSelectedModel || '' };
    const loadedNodes = loaded.paidApiNodes && typeof loaded.paidApiNodes === 'object' ? loaded.paidApiNodes : {};
    loaded.paidApiNodes = Object.fromEntries(PAID_API_NODE_KINDS.map(kind => {
      const node = loadedNodes[kind] && typeof loadedNodes[kind] === 'object' ? loadedNodes[kind] : {};
      return [kind, { ...EMPTY_PAID_NODE(), ...legacyPaid, ...node, models: Array.isArray(node.models) ? node.models : legacyPaid.models }];
    })) as ApiSettings['paidApiNodes'];
    loaded.paidApiProviders = Object.fromEntries(PAID_PROVIDER_IDS.map(provider => {
      const current = loaded.paidApiProviders?.[provider];
      return [provider, { ...DEFAULT_PAID_PROVIDERS[provider], ...(current && typeof current === 'object' ? current : {}) }];
    })) as ApiSettings['paidApiProviders'];
    loaded.bailianTextToImage = {
      apiKey: String(loaded.bailianTextToImage?.apiKey || ''),
      region: ['cn-beijing', 'ap-southeast-1', 'custom'].includes(loaded.bailianTextToImage?.region)
        ? loaded.bailianTextToImage.region
        : 'cn-beijing',
      workspaceId: String(loaded.bailianTextToImage?.workspaceId || ''),
      baseUrl: String(loaded.bailianTextToImage?.baseUrl || ''),
    };
    if (!loaded.chatThinkingMode) loaded.chatThinkingMode = 'auto';
    if (!loaded.sshCommand && loaded.sshHost) loaded.sshCommand = `ssh -p ${loaded.sshPort || 22} ${loaded.sshUsername ? `${loaded.sshUsername}@` : ''}${loaded.sshHost}`;
    if (!loaded.paidApiAspectRatio) loaded.paidApiAspectRatio = '1:1';
    if (!loaded.paidApiWidth) loaded.paidApiWidth = 1024;
    if (!loaded.paidApiHeight) loaded.paidApiHeight = 1024;
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
  setOptimizerModels: (models: string[]) => void;
  setOptimizerPromptOverrides: (value: Partial<Record<string, string>>) => void;
  setStoryboardSystemPrompt: (prompt: string) => void;
  setComfyUrl: (url: string) => void;
  setSsh: (value: Pick<ApiSettings,'sshCommand'|'sshHost'|'sshPort'|'sshUsername'|'sshPassword'>) => void;
  setChat: (value: Partial<Pick<ApiSettings,'chatProvider'|'chatBaseUrl'|'chatApiKey'|'chatModel'|'chatModels'|'chatSystemPrompt'|'chatThinkingMode'>>) => void;
  setPaidApi: (value: Partial<Pick<ApiSettings,'paidApiProvider'|'paidApiKey'|'paidApiBaseUrl'|'paidApiModels'|'paidApiSelectedModel'>>) => void;
  setPaidApiNode: (kind: PaidApiNodeKind, value: Partial<PaidApiNodeSettings>) => void;
  setPaidApiProvider: (provider: PaidProviderId, value: Partial<PaidApiProviderSettings>) => void;
  setBailianTextToImage: (value: Partial<BailianTextToImageSettings>) => void;
  setPaidApiProfiles: (profiles: PaidApiProfile[]) => void;
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
  setOptimizerModels: (optimizerModels) => { set({ optimizerModels }); save({ ...get(), optimizerModels }); },
  setOptimizerPromptOverrides: (optimizerPromptOverrides) => { set({ optimizerPromptOverrides }); save({ ...get(), optimizerPromptOverrides }); },
  setStoryboardSystemPrompt: (storyboardSystemPrompt) => { set({ storyboardSystemPrompt }); save({ ...get(), storyboardSystemPrompt }); },
  setComfyUrl: (comfyUrl) => { set({ comfyUrl }); save({ ...get(), comfyUrl }); },
  setSsh: (value) => { set(value); save({ ...get(), ...value }); },
  setChat: (value) => { set(value as any); save({ ...get(), ...value }); },
  setPaidApi: (value) => { set(value as any); save({ ...get(), ...value }); },
  setPaidApiNode: (kind, value) => { const paidApiNodes = { ...get().paidApiNodes, [kind]: { ...get().paidApiNodes[kind], ...value } }; set({ paidApiNodes }); save({ ...get(), paidApiNodes }); },
  setPaidApiProvider: (provider, value) => { const paidApiProviders = { ...get().paidApiProviders, [provider]: { ...get().paidApiProviders[provider], ...value, provider } }; set({ paidApiProviders }); save({ ...get(), paidApiProviders }); },
  setBailianTextToImage: (value) => { const bailianTextToImage = { ...get().bailianTextToImage, ...value }; set({ bailianTextToImage }); save({ ...get(), bailianTextToImage }); },
  setPaidApiProfiles: (paidApiProfiles) => { set({ paidApiProfiles }); save({ ...get(), paidApiProfiles }); },
  reset: () => { set(DEFAULT); save(DEFAULT); },
  getSettings: () => ({ ...get() }),
}));
