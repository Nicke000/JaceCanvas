const KEY = 'ai-canvas-workflow-defaults-v1';

function readAll(): Record<string, Record<string, unknown>> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

export function getWorkflowDefaults(workflowId: string): Record<string, unknown> {
  return readAll()[workflowId] || {};
}

export function saveWorkflowDefaults(workflowId: string, config: Record<string, unknown>): void {
  const all = readAll();
  const values = Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith('_') && key !== 'workflow_id'));
  all[workflowId] = values;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function clearWorkflowDefaults(workflowId: string): void {
  const all = readAll(); delete all[workflowId]; localStorage.setItem(KEY, JSON.stringify(all));
}