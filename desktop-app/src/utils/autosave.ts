import { db, type ProjectSnapshot } from '@/utils';
import { useCanvasStore } from '@/stores/canvasStore';

const AUTOSAVE_DELAY_MS = 4000;
const MAX_SNAPSHOTS = 10;
let timer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let lastNodes: unknown = null;
let lastEdges: unknown = null;
let context = { projectId: 'default', projectName: '未命名项目' };

/** 设置当前项目的自动保存上下文（项目切换/新建时调用） */
export function setAutosaveContext(projectId: string, projectName: string): void {
  context = { projectId: projectId || 'default', projectName: projectName || '未命名项目' };
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flushAutosave(false); }, AUTOSAVE_DELAY_MS);
}

/** 挂载自动保存：画布变化防抖后落盘（Dexie 项目 + 版本快照） */
export function initAutosave(): void {
  if (initialized) return;
  initialized = true;
  const state = useCanvasStore.getState();
  lastNodes = state.nodes;
  lastEdges = state.edges;
  useCanvasStore.subscribe(s => {
    if (s.nodes !== lastNodes || s.edges !== lastEdges) {
      lastNodes = s.nodes;
      lastEdges = s.edges;
      schedule();
    }
  });
  window.addEventListener('beforeunload', () => { if (timer) { clearTimeout(timer); timer = null; } void flushAutosave(); });
}

/** 立即保存当前画布，返回项目 id。createSnapshot=false 时只更新项目本体（自动防抖用，避免快照被挤占）；手动保存/退出时建版本快照 */
export async function flushAutosave(createSnapshot = true): Promise<string> {
  const { nodes, edges } = useCanvasStore.getState();
  const now = Date.now();
  const { projectId: rawId, projectName } = context;
  const projectId = rawId || 'default';
  const old = await db.projects.get(projectId);
  await db.projects.put({ id: projectId, name: projectName, createdAt: old?.createdAt ?? now, updatedAt: now, canvasData: { nodes: nodes as any, edges: edges as any } });
  if (!createSnapshot) return projectId;
  const existing = await db.projectSnapshots.where('projectId').equals(projectId).sortBy('savedAt');
  const lastVersion = existing.length ? (existing[existing.length - 1].version || 0) : 0;
  await db.projectSnapshots.put({ id: `${projectId}-${now}`, projectId, version: lastVersion + 1, savedAt: now, canvasData: { nodes: nodes as any, edges: edges as any } });
  if (existing.length >= MAX_SNAPSHOTS) {
    const overflow = existing.slice(0, existing.length - MAX_SNAPSHOTS + 1);
    await db.projectSnapshots.bulkDelete(overflow.map(s => s.id));
  }
  return projectId;
}

/** 读取当前项目最近的自动保存点（快照优先，其次项目本体） */
export async function restoreAutosave(): Promise<{ nodes: unknown[]; edges: unknown[] } | null> {
  const snapshots = await db.projectSnapshots.where('projectId').equals(context.projectId).sortBy('savedAt');
  const latest = snapshots[snapshots.length - 1];
  if (latest) return latest.canvasData;
  const project = await db.projects.get(context.projectId);
  return project?.canvasData ?? null;
}

/** 当前项目的历史版本列表（时间正序） */
export async function listSnapshots(): Promise<ProjectSnapshot[]> {
  return db.projectSnapshots.where('projectId').equals(context.projectId).sortBy('savedAt');
}

/** 恢复指定版本 */
export async function restoreSnapshot(id: string): Promise<{ nodes: unknown[]; edges: unknown[] } | null> {
  const snap = await db.projectSnapshots.get(id);
  return snap?.canvasData ?? null;
}
