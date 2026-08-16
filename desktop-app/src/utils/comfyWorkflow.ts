/** 本地 ComfyUI 工作流 JSON 解析与参数管理 */

export interface LocalWorkflowParam {
  nodeId: string;
  field: string;
  /** 扁平 key：`节点id:字段名`（如 "3:steps"） */
  key: string;
  label: string;
  nodeTitle: string;
  nodeClass: string;
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
      params.push({ nodeId, field, key: `${nodeId}:${field}`, label: field, nodeTitle: String(title), nodeClass: String(node?.class_type || ''), value, type });
    });
  });
  return params;
}

/** 负向提示词字段判定：字段名/节点标题含 negative/neg，或 CLIPTextEncode 的 text 值含明显负向词 */
export function isNegativePromptField(field: string, node?: any, value?: unknown): boolean {
  const f = String(field || '').toLowerCase();
  const cls = String(node?.class_type || '').toLowerCase();
  const title = String(node?._meta?.title || '').toLowerCase();
  if (/negative|neg/i.test(f) || /negative|neg/i.test(title)) return true;
  // 仅对 CLIPTextEncode 的 text 字段做"值含负向词"判断（避免误伤正向提示词里的普通词汇）
  if (f === 'text' && /clip.?text|encode|textencode/i.test(cls) && typeof value === 'string'
    && /cartoon|childish|ugly|low.?quality|blurry|blur|worst|bad.?hand|deformed|malformed|watermark|signature|低分辨率|低画质|畸形|模糊|水印|变形|多余|丑陋|手指|肢体/i.test(value)) {
    return true;
  }
  return false;
}

/** 正向提示词字段判定：prompt 字段名 / CLIPTextEncode 的 text / PrimitiveString(Multiline) 的 value（标题含 prompt/提示） */
export function isPositivePromptField(field: string, node?: any): boolean {
  const f = String(field || '').toLowerCase();
  const cls = String(node?.class_type || '').toLowerCase();
  const title = String(node?._meta?.title || '').toLowerCase();
  if (isNegativePromptField(field, node)) return false;
  if (/prompt/i.test(f)) return true; // prompt / positive_prompt / text_prompt
  if (f === 'text' && /clip.?text|encode|textencode/i.test(cls)) return true; // CLIPTextEncode 的 text
  if (f === 'value' && /primitive.?string/i.test(cls) && /prompt|提示/i.test(title)) return true; // PrimitiveString 提示词
  if (f === 'text') return true; // 兜底：旧工作流的 text 字段
  return false;
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
    // 用最后一个冒号分割：节点 id 可能带冒号（子节点如 "398:376"），字段名通常不含冒号
    const sep = key.lastIndexOf(':');
    if (sep <= 0 || sep >= key.length - 1) return;
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
  // 文本输入：正向提示词字段各暴露一个「提示词」端口（text / text-1 / text-2...），负向字段单独暴露「负面提示词」端口
  const promptFields: Array<{ label: string }> = [];
  let hasNeg = false;
  Object.entries(workflowJson).forEach(([, node]) => {
    const ins = node?.inputs || {};
    Object.entries(ins).forEach(([field, value]) => {
      if (typeof value !== 'string') return;
      if (isNegativePromptField(field, node, value)) { hasNeg = true; return; }
      if (isPositivePromptField(field, node)) promptFields.push({ label: String(node?._meta?.title || node?.class_type || '提示词') });
    });
  });
  promptFields.forEach((pf, idx) => {
    // 第一个字段兼容旧版 'text' 端口 id，其余用 text-1/text-2...
    const id = idx === 0 ? 'text' : `text-${idx}`;
    if (!inputs.some(x => x.id === id)) inputs.unshift({ id, label: pf.label || (idx === 0 ? '提示词' : `提示词 ${idx + 1}`), type: 'text' });
  });
  if (hasNeg && !inputs.some(x => x.id === 'negative')) inputs.unshift({ id: 'negative', label: '负面提示词', type: 'text' });
  if (!outputs.length) outputs.push({ id: 'output', label: '图片', type: 'image' });
  return { inputs, outputs };
}

/** 工作流中的图片输入节点（LoadImage 等）需要上游 URL 上传到 ComfyUI 后填 filename */
export function workflowImageInputs(workflowJson: Record<string, any> | undefined): string[] {
  if (!workflowJson) return [];
  return Object.entries(workflowJson).filter(([, n]) => /^LoadImage/i.test(String(n?.class_type || ''))).map(([id]) => id);
}
