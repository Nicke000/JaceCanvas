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
  results?: Array<{ type: 'image' | 'video' | 'audio' | 'text'; url: string; filename?: string }>;
}

const GENERATION_HISTORY_KEY = 'ai-canvas-history';
export const GENERATION_HISTORY_EVENT = 'ai-canvas-generation-history-updated';

/**
 * 生成节点不能依赖历史面板先挂载：用户可能一直没有打开历史栏，
 * 但成功/失败结果仍必须立即进入本地历史记录。
 */
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
