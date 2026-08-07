/** 本地 ComfyUI 工作流 JSON 解析与参数管理 */

export interface LocalWorkflowParam {
  nodeId: string;
  field: string;
  /** 扁平 key：`节点id:字段名`（如 "3:steps"） */
  key: string;
  label: string;
  nodeTitle: string;
  value: unknown;
  type: 'text' | 'number' | 'boolean' | 'string';
}

/** 端口描述（与 NodeShell 的 PortSpec 结构一致） */
export interface WorkflowPort { id: string; label: string; type?: string }

/** 解析 ComfyUI 工作流 JSON（API 格式）→ 可调参数列表（跳过节点连接引用） */
export function parseWorkflowParams(workflowJson: Record<string, any> | undefined): LocalWorkflowParam[] {
  const params: LocalWorkflowParam[] = [];
  if (!workflowJson || typeof workflowJson !== 'object') return params;
  Object.entries(workflowJson).forEach(([nodeId, node]) => {
    const inputs = node?.inputs || {};
    const title = node?._meta?.title || node?.class_type || nodeId;
    Object.entries(inputs).forEach(([field, value]) => {
      if (Array.isArray(value)) return; // 节点连接引用，跳过
      if (typeof value === 'object' && value !== null) return;
      const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
      params.push({ nodeId, field, key: `${nodeId}:${field}`, label: field, nodeTitle: String(title), value, type });
    });
  });
  return params;
}

/** 默认是否展开：提示词 / 采样核心参数展开，模型/文件名等收起 */
export function defaultParamVisible(field: string): boolean {
  const f = field.toLowerCase();
  if (f === 'text' || f === 'prompt' || f === 'negative' || f === 'positive') return true;
  if (/^(steps|cfg|seed|denoise|width|height|batch_size|batch)$/.test(f)) return true;
  return false;
}

/** 校验工作流 JSON 是否合法（API 格式：节点对象含 inputs/class_type） */
export function validateWorkflowJson(json: unknown): { ok: boolean; message: string; nodeCount?: number } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, message: 'JSON 必须是对象（工作流节点集合）' };
  const obj = json as Record<string, any>;
  const entries = Object.entries(obj);
  if (!entries.length) return { ok: false, message: '工作流为空（没有节点）' };
  const bad = entries.filter(([, n]) => !n || typeof n !== 'object' || !n.class_type || !n.inputs);
  if (bad.length) return { ok: false, message: `有 ${bad.length} 个节点缺少 class_type/inputs（不是 ComfyUI API 格式）` };
  return { ok: true, message: '格式正确', nodeCount: entries.length };
}

/** 用用户参数覆盖工作流 JSON（深拷贝，不影响原数据） */
export function applyWorkflowParams(workflowJson: Record<string, any>, params: Record<string, unknown>): Record<string, any> {
  const prompt = JSON.parse(JSON.stringify(workflowJson)) as Record<string, any>;
  Object.entries(params || {}).forEach(([key, value]) => {
    const sep = key.indexOf(':');
    if (sep <= 0) return;
    const nodeId = key.slice(0, sep);
    const field = key.slice(sep + 1);
    const node = prompt[nodeId];
    if (node && node.inputs && field in node.inputs && value !== undefined && value !== null && value !== '') {
      node.inputs[field] = value;
    }
  });
  return prompt;
}

/** 根据工作流 JSON 自动推导输入/输出端口（对标主控 apiNode）：
 *  LoadImage/LoadVideo/LoadAudio → 输入端口（图片/视频/音频）
 *  SaveImage/SaveVideo → 输出端口
 */
export function workflowPorts(workflowJson: Record<string, any> | undefined): { inputs: WorkflowPort[]; outputs: WorkflowPort[] } {
  const inputs: WorkflowPort[] = [];
  const outputs: WorkflowPort[] = [];
  if (!workflowJson || typeof workflowJson !== 'object') {
    return { inputs: [], outputs: [{ id: 'output', label: '图片', type: 'image' }] };
  }
  Object.entries(workflowJson).forEach(([nodeId, node]) => {
    const ct = String(node?.class_type || '');
    const title = String(node?._meta?.title || ct);
    if (/^LoadImage/i.test(ct) || /^LoadImagePath/i.test(ct) || /^VHS_LoadImage/i.test(ct)) inputs.push({ id: nodeId, label: `${title}`, type: 'image' });
    else if (/^LoadVideo/i.test(ct) || /^VHS_LoadVideo/i.test(ct) || /^VHS_VideoLoad/i.test(ct)) inputs.push({ id: nodeId, label: `${title}`, type: 'video' });
    else if (/^LoadAudio/i.test(ct) || /^VHS_LoadAudio/i.test(ct)) inputs.push({ id: nodeId, label: `${title}`, type: 'audio' });
    else if (/^SaveImage/i.test(ct) || /^PreviewImage/i.test(ct) || /^ImageSave/i.test(ct) || /^SaveAnimatedWEBP/i.test(ct) || /^SaveAnimatedPNG/i.test(ct)) outputs.push({ id: nodeId, label: `${title}`, type: 'image' });
    else if (/^SaveVideo/i.test(ct) || /^VHS_VideoCombine/i.test(ct) || /^VHS_SaveVideo/i.test(ct)) outputs.push({ id: nodeId, label: `${title}`, type: 'video' });
  });
  // 文本输入：工作流含 text/prompt 类参数时暴露「提示词」输入端口（执行时用上游文本覆盖）
  const hasTextParam = parseWorkflowParams(workflowJson).some(p => /^text$/i.test(p.field) || /prompt/i.test(p.field));
  if (hasTextParam && !inputs.some(x => x.id === 'text')) inputs.unshift({ id: 'text', label: '提示词', type: 'text' });
  if (!outputs.length) outputs.push({ id: 'output', label: '图片', type: 'image' });
  return { inputs, outputs };
}

/** 工作流中的图片输入节点（LoadImage 等）需要上游 URL 上传到 ComfyUI 后填 filename */
export function workflowImageInputs(workflowJson: Record<string, any> | undefined): string[] {
  if (!workflowJson) return [];
  return Object.entries(workflowJson).filter(([, n]) => /^LoadImage/i.test(String(n?.class_type || ''))).map(([id]) => id);
}
