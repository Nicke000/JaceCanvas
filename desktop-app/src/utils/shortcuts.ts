export interface ShortcutDef {
  id: string; label: string; desc: string; default: string;
}

export const SHORTCUT_DEFS: ShortcutDef[] = [
  { id: 'duplicate', label: '复制节点', desc: '原地复制选中节点', default: 'Ctrl+D' },
  { id: 'copy', label: '复制', desc: '复制选中节点到剪贴板', default: 'Ctrl+C' },
  { id: 'paste', label: '粘贴', desc: '粘贴剪贴板节点到点击位置', default: 'Ctrl+V' },
  { id: 'delete', label: '删除', desc: '删除选中节点', default: 'Delete' },
  { id: 'undo', label: '撤销', desc: '撤销上一步操作', default: 'Ctrl+Z' },
  { id: 'redo', label: '重做', desc: '重做', default: 'Ctrl+Shift+Z' },
  { id: 'group', label: '成组', desc: '选中 ≥2 节点成组（Frame）', default: 'Ctrl+G' },
  { id: 'ungroup', label: '解散分组', desc: '解散 Frame 分组', default: 'Ctrl+Shift+G' },
];

const KEY = 'jacecanvas-shortcuts';

export function getShortcuts(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>;
    const out: Record<string, string> = {};
    SHORTCUT_DEFS.forEach(d => { out[d.id] = saved[d.id] || d.default; });
    return out;
  } catch { return Object.fromEntries(SHORTCUT_DEFS.map(d => [d.id, d.default])); }
}

export function setShortcut(id: string, combo: string): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, string>;
    saved[id] = combo;
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch { /* 忽略 */ }
}

export function resetShortcuts(): void {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}

/** 判断键盘事件是否匹配某个快捷键组合（如 'Ctrl+Shift+Z'），兼容原生与 React 合成事件 */
export function matchShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, combo: string): boolean {
  if (!combo) return false;
  const parts = combo.toLowerCase().split('+').filter(Boolean);
  const key = parts.pop() || '';
  if (key !== e.key.toLowerCase() && key !== e.key) return false;
  const has = (m: string) => parts.includes(m);
  if (has('ctrl') !== (e.ctrlKey || e.metaKey)) return false;
  if (has('shift') !== e.shiftKey) return false;
  if (has('alt') !== e.altKey) return false;
  return true;
}
