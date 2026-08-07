import { fetchWorkflowConfig } from '@/services/comfyui.service';
import { getWorkflowConfig, mediaTypeForField } from '@/config/workflowConfig';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AppNode } from '@/types';

/** 工作流节点字段（本地兜底） */
function localWorkflowFields(workflowId: string) {
  const config = getWorkflowConfig(workflowId);
  if (!config) return [];
  return [...config.coreParams, ...config.advancedParams].map(field => ({
    key: `${field.nodeId}:${field.fieldName}`,
    label: field.label,
    value: field.default,
    field: field.fieldName,
    nodeTitle: field.nodeTitle,
    type: field.type,
    fileType: mediaTypeForField(field.nodeClass, field.fieldName),
  }));
}

/** 刷新画布上 apiNode 的字段（模板/项目加载后调用，服务器工作流参数变化时自动补齐，保留用户已填值） */
export async function refreshApiNodeFields(nodes: AppNode[]): Promise<void> {
  const apiNodes = nodes.filter(n => n.data?.nodeType === 'apiNode' && n.data.config?.workflow_id);
  for (const n of apiNodes) {
    const workflowId = String(n.data.config.workflow_id);
    try {
      const remote = await fetchWorkflowConfig(workflowId);
      const fields = workflowFields(remote);
      const remoteDefaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
      const store = useCanvasStore.getState();
      const current = store.nodes.find(x => x.id === n.id);
      if (!current) continue;
      const oldConfig = (current.data.config || {}) as Record<string, unknown>;
      const userValues = Object.fromEntries(Object.entries(oldConfig).filter(([k]) => !(k in remoteDefaults) && !k.startsWith('_') && k !== 'workflow_id'));
      const prevLabel = (n.data.config?._apiLabel as string) || workflowId; // 保留用户自定义名称，刷新字段不冲掉
      store.updateNodeData(n.id, { config: { workflow_id: workflowId, _apiName: workflowId, _apiLabel: prevLabel, _apiFields: fields, _serverDefaults: remoteDefaults, ...remoteDefaults, ...userValues } });
    } catch { /* 服务器不可达时保留原字段 */ }
  }
}

/** 工作流节点字段（服务器配置） */
function workflowFields(remote: Awaited<ReturnType<typeof fetchWorkflowConfig>>) {
  const enabled = remote.api_config?.enabledParams || {};
  const labels = remote.api_config?.customLabels || {};
  const values = remote.api_config?.formValues || {};
  const template = remote.workflow_template || {};
  const optionsFor = (field: string, value: unknown) => {
    if (Array.isArray(value)) return value.map(option => ({ label: String(option), value: String(option) }));
    if (field === 'sampler_name') return [{ label: 'Euler', value: 'euler' }, { label: 'Euler A', value: 'euler_ancestral' }, { label: 'DPM++ 2M', value: 'dpmpp_2m' }, { label: 'DPM++ SDE', value: 'dpmpp_sde' }, { label: 'DDIM', value: 'ddim' }];
    if (field === 'scheduler') return [{ label: 'Normal', value: 'normal' }, { label: 'Karras', value: 'karras' }, { label: 'Simple', value: 'simple' }, { label: 'Exponential', value: 'exponential' }];
    if (field === 'aspect_ratio') return [{ label: '1:1', value: '1:1' }, { label: '9:16 竖屏', value: '9:16' }, { label: '16:9 横屏', value: '16:9' }, { label: '3:4', value: '3:4' }, { label: '4:3', value: '4:3' }];
    return undefined;
  };
  return Object.keys(enabled).filter(key => enabled[key]).map(key => {
    const split = key.indexOf(':'); const nodeId = key.slice(0, split); const field = key.slice(split + 1);
    const node = template[nodeId] || {}; const value = values[key] ?? node.inputs?.[field];
    const cls = String(node.class_type || '').toLowerCase();
    const exactMediaField = /^(image|video|audio|file)$/i.test(field) ? field.toLowerCase() : '';
    const fileType = cls.includes('loadaudio') || exactMediaField === 'audio' ? 'audio' : (cls.includes('loadvideo') || cls.includes('vhs_loadvideo') || exactMediaField === 'video') ? 'video' : (cls.includes('loadimage') || /image|mask|reference|file|path|font/i.test(field)) ? 'image' : undefined;
    const boolValue = typeof value === 'boolean' || /^(true|false)$/i.test(String(value ?? ''));
    const numberValue = typeof value === 'number';
    const options = optionsFor(field, node.inputs?.[field]?.options || node.inputs?.[field]?.values);
    return { key, label: labels[key] || field, value, field, nodeTitle: node._meta?.title || `节点 ${nodeId}`, fileType, type: boolValue ? 'boolean' : numberValue ? 'number' : options?.length ? 'select' : 'text', options };
  });
}

/**
 * 创建工作流节点（apiNode）：拉取字段默认值后 addNode。
 * 供节点库、模板库共用。
 */
export async function createWorkflowNode(
  workflowId: string,
  position: { x: number; y: number },
  extraConfig?: Record<string, unknown>,
  label?: string,
): Promise<string> {
  let fields: ReturnType<typeof workflowFields> | ReturnType<typeof localWorkflowFields> = [];
  let remoteDefaults: Record<string, unknown> = {};
  try {
    const remote = await fetchWorkflowConfig(workflowId);
    fields = workflowFields(remote);
    remoteDefaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
  } catch {
    fields = localWorkflowFields(workflowId);
    remoteDefaults = Object.fromEntries(fields.map(f => [f.key, f.value]));
  }
  const addNode = useCanvasStore.getState().addNode;
  return addNode('apiNode', position, {
    label: label || workflowId,
    serverId: useSettingsStore.getState().activeServerId || undefined,
    config: { workflow_id: workflowId, _apiName: workflowId, _apiLabel: workflowId, _apiFields: fields, _serverDefaults: remoteDefaults, ...remoteDefaults, ...(extraConfig || {}) },
  });
}
