import Dexie, { type Table } from 'dexie';
import type { Project } from '@/types';

/** IndexedDB 数据库 */
class CanvasDatabase extends Dexie {
  projects!: Table<Project, string>;

  constructor() {
    super('AICanvasDB');
    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt',
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

/** 生成唯一ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
