import Dexie, { type Table } from 'dexie';
import type { ChatSession, Project } from '@/types';

/** 项目版本快照（自动保存时记录，用于恢复历史） */
export interface ProjectSnapshot {
  id: string;
  projectId: string;
  version: number;
  savedAt: number;
  canvasData: { nodes: unknown[]; edges: unknown[] };
}

/** IndexedDB 数据库 */
class CanvasDatabase extends Dexie {
  projects!: Table<Project, string>;
  chatSessions!: Table<ChatSession, string>;
  projectSnapshots!: Table<ProjectSnapshot, string>;
  assets!: Table<{ id: string; list: string }, string>;

  constructor() {
    super('AICanvasDB');
    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt',
    });
    this.version(2).stores({
      projects: 'id, name, createdAt, updatedAt',
      chatSessions: 'id, nodeId, updatedAt',
    });
    this.version(3).stores({
      projects: 'id, name, createdAt, updatedAt',
      chatSessions: 'id, nodeId, updatedAt',
      projectSnapshots: 'id, projectId, savedAt, version',
    });
    this.version(4).stores({
      projects: 'id, name, createdAt, updatedAt',
      chatSessions: 'id, nodeId, updatedAt',
      projectSnapshots: 'id, projectId, savedAt, version',
      assets: 'id',
    });
  }
}

export const db = new CanvasDatabase();

/** 保存项目到 IndexedDB */
export async function saveProject(project: Project): Promise<void> {
  await db.projects.put(project);
}

/** 加载所有项目 */
export async function loadProjects(): Promise<Project[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

/** 根据ID加载项目 */
export async function loadProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id);
}

/** 删除项目 */
export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  await db.chatSessions.put(session);
}

export async function loadChatSessions(): Promise<ChatSession[]> {
  return db.chatSessions.orderBy('updatedAt').reverse().toArray();
}

export async function deleteChatSession(id: string): Promise<void> {
  await db.chatSessions.delete(id);
}

/** 生成唯一ID */
/**
 * 批处理占位符：把提示词里的 `{a|b|c}` 随机替换为其中一项。
 * 示例："一只{a|橘色|白色}的猫" → 每次执行随机得到三种之一。
 */
export function expandPromptVariants(prompt: string): string {
  if (!prompt || !prompt.includes('{')) return prompt;
  return prompt.replace(/\{([^{}]*\|[^{}]*)\}/g, (_match, inner: string) => {
    const options = String(inner).split('|').map(s => s.trim()).filter(Boolean);
    if (options.length === 0) return '';
    return options[Math.floor(Math.random() * options.length)];
  });
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
