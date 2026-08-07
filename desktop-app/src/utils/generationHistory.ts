import { db } from '@/utils';

export interface GenerationHistoryItem {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  params: Record<string, unknown>;
  resultUrl?: string;
  status: string;
  timestamp: number;
  error?: string;
  results?: Array<{ type: 'image' | 'video' | 'audio' | 'text' | '3d'; url: string; filename?: string }>;
}

const GENERATION_HISTORY_KEY = 'ai-canvas-history';
export const GENERATION_HISTORY_EVENT = 'ai-canvas-generation-history-updated';

/**
 * 生成节点不能依赖历史面板先挂载：用户可能一直没有打开历史栏，
 * 但成功/失败结果仍必须立即进入本地历史记录。
 */
/** 资产列表类型（与 AssetLibrary 兼容） */
export interface AssetEntry { id: string; name: string; type: string; url: string; }

const ASSETS_KEY = 'ai-canvas-assets-v2';

/** 保存资产列表：优先 IndexedDB（避免 localStorage 5MB 配额爆掉丢素材），同时兼容写 localStorage */
export function saveAssets(list: AssetEntry[]): void {
  try { void db.assets.put({ id: 'all', list: JSON.stringify(list) }); } catch { /* ignore */ }
  try { localStorage.setItem(ASSETS_KEY, JSON.stringify(list)); } catch { /* 配额满时忽略（db 是主存储） */ }
}

/** 读取资产列表：优先 IndexedDB，回退 localStorage（并迁入 db） */
export async function loadAssetsAsync(): Promise<AssetEntry[]> {
  try {
    const row = await db.assets.get('all');
    if (row?.list) return JSON.parse(row.list) as AssetEntry[];
    const legacy = localStorage.getItem(ASSETS_KEY);
    const list = legacy ? JSON.parse(legacy) as AssetEntry[] : [];
    if (list.length) { try { await db.assets.put({ id: 'all', list: JSON.stringify(list) }); } catch { /* ignore */ } }
    return list;
  } catch { return []; }
}

export function autoSaveToAssets(resultUrl: string | undefined, results: Array<{ url: string; type: string; filename?: string }> | undefined, nodeName: string) {
  try {
    const list = JSON.parse(localStorage.getItem(ASSETS_KEY) || '[]') as AssetEntry[];
    const seen = new Set(list.map(x => x.url));
    const add = (url: string, type: string, name?: string) => { if (!url || seen.has(url)) return; if (url.startsWith('data:') && url.length > 8000000) return; // 超大 base64 不自动入资产库（手动收藏或保留在画布）
      seen.add(url); list.push({ id: 'asset-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: name || nodeName, type: type === 'video' ? 'video' : 'image', url }); };
    (results || []).forEach(r => add(r.url, r.type || 'image', r.filename || nodeName));
    if (resultUrl) add(resultUrl, /(mp4|webm|mov)/i.test(resultUrl) ? 'video' : 'image', nodeName);
    if (list.length > 300) list.splice(0, list.length - 300);
    saveAssets(list);
  } catch { /* ignore */ }
}

export function addGenerationHistory(item: GenerationHistoryItem): void {
  try {
    const raw = localStorage.getItem(GENERATION_HISTORY_KEY);
    const current = raw ? JSON.parse(raw) as GenerationHistoryItem[] : [];
    const updated = [item, ...current].slice(0, 50);
    localStorage.setItem(GENERATION_HISTORY_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(GENERATION_HISTORY_EVENT));
  } catch {
    // 历史记录失败不应影响生成任务本身的成功/失败状态。
  }
}

export function readGenerationHistory(): GenerationHistoryItem[] {
  try {
    const raw = localStorage.getItem(GENERATION_HISTORY_KEY);
    return raw ? JSON.parse(raw) as GenerationHistoryItem[] : [];
  } catch {
    return [];
  }
}
