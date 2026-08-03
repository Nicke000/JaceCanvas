import { create } from 'zustand';

export interface CanvasTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

const themes: CanvasTheme[] = [
  { id: 'midnight', name: '深空紫', colors: { primary: '#7c6df2', bg: '#090b12', surface: '#111522', panel: '#151a2a', input: '#0c101b', border: '#262d40', text: '#e8e8f0', muted: '#8888aa', edge: '#7c6df2' } },
  { id: 'ocean', name: '海洋青', colors: { primary: '#06b6d4', bg: '#071217', surface: '#0c2028', panel: '#102d36', input: '#081a20', border: '#1d4853', text: '#e2f8fb', muted: '#83b4bd', edge: '#22d3ee' } },
  { id: 'forest', name: '森林绿', colors: { primary: '#34d399', bg: '#08120f', surface: '#102019', panel: '#153026', input: '#0b1b15', border: '#24513f', text: '#e2f7ec', muted: '#86b5a0', edge: '#34d399' } },
  { id: 'warm', name: '暖橙', colors: { primary: '#fb923c', bg: '#160d09', surface: '#261711', panel: '#352116', input: '#1d100a', border: '#5a3825', text: '#fff1e5', muted: '#c69b7b', edge: '#fb923c' } },
  { id: 'light', name: '明亮白', colors: { primary: '#635bdb', bg: '#eef1f7', surface: '#ffffff', panel: '#f7f8fc', input: '#ffffff', border: '#d4d9e6', text: '#202638', muted: '#687188', edge: '#635bdb' } },
  { id: 'sakura', name: '樱花粉', colors: { primary: '#f472b6', bg: '#160b13', surface: '#201420', panel: '#2a1926', input: '#190d16', border: '#482a3d', text: '#fce7f3', muted: '#c08ba6', edge: '#fb7185' } },
  { id: 'graphite', name: '石墨灰', colors: { primary: '#94a3b8', bg: '#0b0d10', surface: '#14171c', panel: '#1a1e24', input: '#0e1114', border: '#2c323b', text: '#e2e8f0', muted: '#8a94a3', edge: '#64748b' } },
  { id: 'neon', name: '赛博霓虹', colors: { primary: '#22d3ee', bg: '#05010f', surface: '#0d0620', panel: '#150a2e', input: '#090313', border: '#2f1d5e', text: '#e9f7ff', muted: '#9a86c9', edge: '#f472b6' } },
];

const STORAGE_KEY = 'jacecanvas-theme-v1';
const CUSTOM_KEY = 'jacecanvas-theme-custom-v1';

function readString(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function readCustom() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

/** 4.6.8 外观偏好：界面圆角、密度、动画、毛玻璃、字体、网格等。全部本地持久化。 */
export type UIRadius = 'small' | 'standard' | 'large';
export type UIDensity = 'cozy' | 'compact';
export type UIMotion = 'full' | 'reduced';
export type UIGridStyle = 'dots' | 'lines' | 'cross';

export interface UIPreferences {
  radius: UIRadius;
  density: UIDensity;
  motion: UIMotion;
  glass: boolean;
  ambient: boolean;
  fontScale: 'small' | 'standard' | 'large';
  gridStyle: UIGridStyle;
  /** 强调色强度 0.6 ~ 1.4，1 表示完全使用主题强调色。 */
  accentIntensity: number;
}

const PREFERENCES_KEY = 'jacecanvas-ui-preferences-v1';
export const DEFAULT_PREFERENCES: UIPreferences = {
  radius: 'standard',
  density: 'cozy',
  motion: 'full',
  glass: true,
  ambient: true,
  fontScale: 'standard',
  gridStyle: 'dots',
  accentIntensity: 1,
};

function readPreferences(): UIPreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Partial<UIPreferences>;
    return { ...DEFAULT_PREFERENCES, ...raw };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

/** 把外观偏好写入根节点的 data-* 与 CSS 变量，供全局样式消费。 */
function applyPreferences(prefs: UIPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.uiRadius = prefs.radius;
  root.dataset.uiDensity = prefs.density;
  root.dataset.uiMotion = prefs.motion;
  root.dataset.uiGlass = prefs.glass ? 'on' : 'off';
  root.dataset.uiAmbient = prefs.ambient ? 'on' : 'off';
  root.dataset.uiGrid = prefs.gridStyle;
  root.dataset.uiFontScale = prefs.fontScale;
  const radiusPx = prefs.radius === 'small' ? '8px' : prefs.radius === 'large' ? '18px' : '12px';
  root.style.setProperty('--ui-radius', radiusPx);
  root.style.setProperty('--radius', radiusPx);
  root.style.setProperty('--ui-font-scale', prefs.fontScale === 'small' ? '0.92' : prefs.fontScale === 'large' ? '1.06' : '1');
  root.style.setProperty('--ui-accent-strength', String(prefs.accentIntensity));
  const primary = getComputedStyle(root).getPropertyValue('--theme-primary').trim();
  if (primary) {
    // 强调色强度：>1 提亮，<1 压暗，1 保持原色。
    let accent = primary;
    if (prefs.accentIntensity >= 1.001) {
      accent = `color-mix(in srgb, ${primary} ${Math.round((2 - prefs.accentIntensity) * 100)}%, #ffffff)`;
    } else if (prefs.accentIntensity <= 0.999) {
      accent = `color-mix(in srgb, ${primary} ${Math.round(prefs.accentIntensity * 100)}%, #16161f)`;
    }
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-glow', `color-mix(in srgb, ${primary} 27%, transparent)`);
  }
}

/** 主题切换时短暂启用颜色过渡，让界面平滑换肤。 */
function flashThemeTransition() {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.add('theme-transitioning');
  window.setTimeout(() => html.classList.remove('theme-transitioning'), 420);
}

function applyTheme(theme: CanvasTheme, custom: Record<string, string>) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const colors = { ...theme.colors, ...custom };
  root.dataset.canvasTheme = theme.id;
  Object.entries(colors).forEach(([key, value]) => root.style.setProperty(`--theme-${key}`, value));
  // 兼容项目早期样式变量，让主题真正覆盖旧版面板、节点和控件颜色。
  const aliases: Record<string, string> = {
    '--bg-primary': colors.bg,
    '--bg-secondary': colors.surface,
    '--bg-tertiary': colors.panel,
    '--bg-input': colors.input,
    '--border': colors.border,
    '--border-hover': colors.primary,
    '--text-primary': colors.text,
    '--text-secondary': colors.muted,
    '--text-muted': colors.muted,
    '--accent': colors.primary,
    '--accent-glow': `${colors.primary}44`,
    '--edge-color': colors.edge,
    '--theme-grid': `${colors.border}66`,
  };
  Object.entries(aliases).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.setProperty('color-scheme', theme.id === 'light' ? 'light' : 'dark');
}

interface ThemeState {
  themes: CanvasTheme[];
  themeId: string;
  custom: Record<string, string>;
  preferences: UIPreferences;
  setTheme: (id: string) => void;
  setCustom: (key: string, value: string) => void;
  resetCustom: () => void;
  setPreference: (patch: Partial<UIPreferences>) => void;
  resetPreferences: () => void;
}

const initialId = readString(STORAGE_KEY, 'midnight');
const initialTheme = themes.find(item => item.id === initialId) || themes[0];
const initialCustom = readCustom();
const initialPreferences = readPreferences();
applyTheme(initialTheme, initialCustom);
applyPreferences(initialPreferences);

export const useThemeStore = create<ThemeState>((set, get) => ({
  themes,
  themeId: initialTheme.id,
  custom: initialCustom,
  preferences: initialPreferences,
  setTheme: (id) => {
    const theme = themes.find(item => item.id === id);
    if (!theme) return;
    localStorage.setItem(STORAGE_KEY, id);
    applyTheme(theme, get().custom);
    applyPreferences(get().preferences);
    flashThemeTransition();
    set({ themeId: id });
  },
  setCustom: (key, value) => {
    const custom = { ...get().custom, [key]: value };
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    const theme = themes.find(item => item.id === get().themeId) || themes[0];
    applyTheme(theme, custom);
    applyPreferences(get().preferences);
    set({ custom });
  },
  resetCustom: () => {
    localStorage.removeItem(CUSTOM_KEY);
    const theme = themes.find(item => item.id === get().themeId) || themes[0];
    applyTheme(theme, {});
    applyPreferences(get().preferences);
    set({ custom: {} });
  },
  setPreference: (patch) => {
    const preferences = { ...get().preferences, ...patch };
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    applyPreferences(preferences);
    set({ preferences });
  },
  resetPreferences: () => {
    localStorage.removeItem(PREFERENCES_KEY);
    const preferences = { ...DEFAULT_PREFERENCES };
    applyPreferences(preferences);
    set({ preferences });
  },
}));