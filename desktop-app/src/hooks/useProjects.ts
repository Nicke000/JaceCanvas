import { useState } from 'react';
import type { Project } from '@/types';
import { db, generateId } from '@/utils';
import { useCanvasStore } from '@/stores/canvasStore';

/** 项目管理 hook */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const all = await db.projects.orderBy('updatedAt').reverse().toArray();
      setProjects(all);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (name: string) => {
    const project: Project = {
      id: generateId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      canvasData: { nodes: [], edges: [] },
    };
    await db.projects.put(project);
    await refreshProjects();
    return project;
  };

  const saveCurrentProject = async () => {
    const { nodes, edges, projectName } = useCanvasStore.getState();
    const now = Date.now();
    // 尝试用已有ID保存，没有则新建
    const existing = await db.projects
      .where('name')
      .equals(projectName)
      .first();

    const project: Project = {
      id: existing?.id ?? generateId(),
      name: projectName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      canvasData: { nodes, edges },
    };
    await db.projects.put(project);
    await refreshProjects();
    return project;
  };

  const loadProject = async (id: string) => {
    const project = await db.projects.get(id);
    if (project) {
      useCanvasStore.getState().loadCanvas(
        project.canvasData.nodes,
        project.canvasData.edges
      );
      useCanvasStore.getState().setProjectName(project.name);
    }
  };

  const deleteProject = async (id: string) => {
    await db.projects.delete(id);
    await refreshProjects();
  };

  return {
    projects,
    loading,
    refreshProjects,
    createProject,
    saveCurrentProject,
    loadProject,
    deleteProject,
  };
}
