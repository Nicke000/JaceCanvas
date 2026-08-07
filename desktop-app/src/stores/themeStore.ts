import { create } from 'zustand';

export interface CanvasTheme {
  id: string;
  name: string;
  /** dark | light | high-contrast */
  family: 'dark' | 'light' | 'high-contrast';
  /** 方向一句话（P1 原则：先定方向再写代码） */
  direction: string;
  colors: Record<string, string>;
}

/* ============ 主题包：9 个主题，每个只保留 1 个品牌色，其余为中性灰阶 ============ */
const themes: CanvasTheme[] = [
  { id: 'midnight', name: '深空紫', family: 'dark', direction: '深色中性底 + 靛紫品牌色，克制的导演台氛围', colors: { primary: '#7c6df2', bg: '#0a0b10', surface: '#14161c', panel: '#1a1c24', input: '#0e1015', border: '#2a2d38', text: 'var(--theme-text)', muted: '#8a8fa3', edge: '#7c6df2' } },
  { id: 'ocean', name: '海洋青', family: 'dark', direction: '中性深海底 + 单一青色品牌色', colors: { primary: '#22b8cf', bg: '#0a0d10', surface: '#14171b', panel: '#1a1e23', input: '#0e1115', border: '#2a3038', text: '#e6eef2', muted: '#8b9aa3', edge: '#22b8cf' } },
  { id: 'forest', name: '森林绿', family: 'dark', direction: '中性深绿底 + 单一翠绿品牌色', colors: { primary: '#34c98c', bg: '#0a0e0c', surface: '#141a16', panel: '#1a221d', input: '#0e1310', border: '#2a3730', text: '#e6f0ea', muted: '#8ba396', edge: '#34c98c' } },
  { id: 'warm', name: '暖橙', family: 'dark', direction: '中性暖灰底 + 单一橙品牌色', colors: { primary: '#f59e5b', bg: '#0f0d0b', surface: '#191512', panel: '#201b16', input: '#120f0c', border: '#342c24', text: '#f2ece6', muted: '#a8998a', edge: '#f59e5b' } },
  { id: 'light', name: '明亮白', family: 'light', direction: '高亮中性底 + 单一靛紫品牌色，克制无装饰', colors: { primary: '#5b55d1', bg: '#f1f3f7', surface: '#ffffff', panel: '#f7f8fb', input: '#ffffff', border: '#d8dce6', text: '#23283a', muted: '#6b7389', edge: '#5b55d1' } },
  { id: 'sakura', name: '樱花粉', family: 'dark', direction: '中性深底 + 单一粉品牌色', colors: { primary: '#ec6ba8', bg: '#0d0b0e', surface: '#171318', panel: '#1e1920', input: '#100d11', border: '#332a30', text: '#f2e8ee', muted: '#a3909a', edge: '#ec6ba8' } },
  { id: 'graphite', name: '石墨灰', family: 'dark', direction: '全中性灰阶 + 钢蓝品牌色', colors: { primary: '#8ea0b5', bg: '#0c0d0f', surface: '#15171a', panel: '#1b1e22', input: '#0f1113', border: '#2c3036', text: '#e4e8ee', muted: '#8d959f', edge: '#8ea0b5' } },
  { id: 'black', name: '纯黑', family: 'dark', direction: '纯黑底 + 单一淡紫品牌色', colors: { primary: '#9d8bf5', bg: '#000000', surface: '#0b0b0d', panel: '#121215', input: '#060608', border: '#26262c', text: '#ececf1', muted: '#8a8a93', edge: '#9d8bf5' } },
  { id: 'neon', name: '赛博霓虹', family: 'dark', direction: '中性深底 + 单一青色品牌色（霓虹只留一处大胆）', colors: { primary: '#2dd4ee', bg: '#07070b', surface: '#101016', panel: '#16161e', input: '#0a0a0f', border: '#2c2c38', text: '#e8f2f7', muted: '#8d9aa3', edge: '#2dd4ee' } },
];

const STORAGE_KEY = 'jacecanvas-theme-v1';
const CUSTOM_KEY = 'jacecanvas-theme-custom-v1';

function readString(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function readCustom() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') as Record<string, string>; } catch { return {}; }
}

/* ============ 颜色工具：hex → rgb / 混合 / rgba（用于派生令牌，JS 计算保证 lint 可校验） ============ */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** weight = 第一个颜色的占比（0~1） */
function mix(hex1: string, hex2: string, weight: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const w = Math.max(0, Math.min(1, weight));
  const r = Math.round(r1 * w + r2 * (1 - w));
  const g = Math.round(g1 * w + g2 * (1 - w));
  const b = Math.round(b1 * w + b2 * (1 - w));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function isLightFamily(theme: CanvasTheme): boolean {
  return theme.family === 'light';
}

/** 由原子色派生全部语义令牌（P0 主题工厂核心） */
function deriveTokens(theme: CanvasTheme, custom: Record<string, string>): Record<string, string> {
  const c = { ...theme.colors, ...custom };
  const light = isLightFamily(theme);
  const primary = c.primary;
  return {
    ...c,
    // 层级
    'bg-elev': mix(c.bg, c.surface, 0.55),          // 画布浮层（节点/卡片下更亮层）
    'surface-2': mix(c.surface, c.panel, 0.6),      // 内嵌卡片
    'text-2': mix(c.text, c.muted, 0.42),           // 次要文字
    'text-3': mix(c.text, c.muted, 0.62),           // 弱文字/占位
    'border-strong': mix(c.border, c.text, 0.22),   // hover/焦点边框
    // 品牌色派生
    'accent-hover': light ? mix(primary, '#000000', 0.92) : mix(primary, '#ffffff', 0.86),
    'accent-active': light ? mix(primary, '#000000', 0.82) : mix(primary, '#000000', 0.82),
    'accent-soft': rgba(primary, 0.12),
    'accent-border': rgba(primary, 0.38),
    // 状态色（仅图标/边框，不做大面积背景）
    success: '#22c55e', warning: '#f59e0b', error: '#ef4444',
    'success-soft': 'rgba(34, 197, 94, 0.14)', 'warning-soft': 'rgba(245, 158, 11, 0.14)', 'error-soft': 'rgba(239, 68, 68, 0.14)',
    'success-border': 'rgba(34, 197, 94, 0.4)', 'warning-border': 'rgba(245, 158, 11, 0.4)', 'error-border': 'rgba(239, 68, 68, 0.4)',
    // 阴影：低透明大半径，禁止彩色 glow
    'shadow-sm': light ? '0 1px 2px rgba(15, 18, 30, 0.08)' : '0 1px 2px rgba(0, 0, 0, 0.35)',
    'shadow-md': light ? '0 4px 14px rgba(15, 18, 30, 0.10)' : '0 4px 14px rgba(0, 0, 0, 0.38)',
    'shadow-lg': light ? '0 14px 40px rgba(15, 18, 30, 0.16)' : '0 14px 40px rgba(0, 0, 0, 0.5)',
  };
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
  const tokens = deriveTokens(theme, custom);
  root.dataset.canvasTheme = theme.id;
  // director-desk 独立样式体系监听 data-theme（而非 data-canvas-theme）——同步写入，让导演台暗色变量真正生效
  root.dataset.theme = theme.family === 'light' ? 'light' : 'dark';
  // 原子色 + 全部派生令牌（--theme-*）
  Object.entries(tokens).forEach(([key, value]) => root.style.setProperty(`--theme-${key}`, value));
  // 兼容项目早期样式变量（旧别名）——保证主题真正覆盖旧版面板、节点和控件颜色
  const aliases: Record<string, string> = {
    '--bg-primary': tokens.bg,
    '--bg-secondary': tokens.surface,
    '--bg-tertiary': tokens.panel,
    '--bg-input': tokens.input,
    '--bg-elev': tokens['bg-elev'],
    '--surface-2': tokens['surface-2'],
    '--border': tokens.border,
    '--border-hover': tokens.primary,
    '--border-strong': tokens['border-strong'],
    '--text-primary': tokens.text,
    '--text-secondary': tokens.muted,
    '--text-muted': tokens.muted,
    '--text-2': tokens['text-2'],
    '--text-3': tokens['text-3'],
    '--accent': tokens.primary,
    '--accent-hover': tokens['accent-hover'],
    '--accent-active': tokens['accent-active'],
    '--accent-soft': tokens['accent-soft'],
    '--accent-border': tokens['accent-border'],
    '--accent-glow': `${tokens.primary}44`,
    '--edge-color': tokens.edge,
    '--theme-grid': `${tokens.border}66`,
    '--success': tokens.success, '--warning': tokens.warning, '--error': tokens.error,
    '--success-soft': tokens['success-soft'], '--warning-soft': tokens['warning-soft'], '--error-soft': tokens['error-soft'],
    '--shadow-sm': tokens['shadow-sm'], '--shadow-md': tokens['shadow-md'], '--shadow-lg': tokens['shadow-lg'],
  };
  Object.entries(aliases).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.setProperty('color-scheme', theme.family === 'light' ? 'light' : 'dark');
}

/** 供 antd ConfigProvider 使用：把当前主题解析为 hex（antd 不接受 CSS 变量字符串，否则派生色不可靠） */
export function resolveAntdTokens(theme: CanvasTheme, custom: Record<string, string>, prefs: UIPreferences): { colorPrimary: string; colorBgBase: string; colorText: string; colorBorder: string; borderRadius: number; fontFamily: string } {
  const tokens = deriveTokens(theme, custom);
  const radius = prefs.radius === 'small' ? 8 : prefs.radius === 'large' ? 18 : 12;
  return {
    colorPrimary: tokens.primary,
    colorBgBase: tokens.bg,
    colorText: tokens.text,
    colorBorder: tokens.border,
    borderRadius: radius,
    fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
  };
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
