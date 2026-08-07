/** 本地导入的 ComfyUI 工作流（无主控时用户自己的 API 工作流） */

export interface LocalWorkflowEntry {
  id: string;
  /** 以 API 导出文件名命名（去掉 .json） */
  name: string;
  serverId?: string;
  json: Record<string, any>;
  importedAt: number;
}

const KEY = 'jacecanvas-local-workflows';

export function getLocalWorkflows(serverId?: string): LocalWorkflowEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as LocalWorkflowEntry[];
    // serverId 匹配或未绑定（空）的都显示；serverId 为空时显示全部
    return serverId ? list.filter(w => !w.serverId || w.serverId === serverId) : list;
  } catch { return []; }
}

export function saveLocalWorkflow(name: string, json: Record<string, any>, serverId?: string): LocalWorkflowEntry {
  const list = getLocalWorkflows();
  const entry: LocalWorkflowEntry = { id: 'lwf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name, serverId, json, importedAt: Date.now() };
  list.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  return entry;
}

export function removeLocalWorkflow(id: string): void {
  try { localStorage.setItem(KEY, JSON.stringify(getLocalWorkflows().filter(w => w.id !== id))); } catch { /* ignore */ }
}
