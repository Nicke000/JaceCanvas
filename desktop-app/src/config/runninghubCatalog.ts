import registry from './model-registry.public.json';

export type RunningHubParamType = 'STRING' | 'TEXT' | 'INT' | 'FLOAT' | 'BOOLEAN' | 'LIST' | 'IMAGE' | 'VIDEO' | 'AUDIO';
export interface RunningHubParam {
  fieldKey: string;
  type: RunningHubParamType;
  required?: boolean;
  label?: string;
  description?: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: Array<{ value: string; description?: string; descriptionEn?: string }>;
}
export interface RunningHubModelContract {
  class_name: string;
  display_name: string;
  name_cn?: string;
  name_en?: string;
  endpoint: string;
  output_type: 'image' | 'video' | 'audio' | '3d' | 'string';
  category: string;
  params: RunningHubParam[];
}

const source = registry as { version: string; models: RunningHubModelContract[] };
export const RUNNINGHUB_REGISTRY_VERSION = source.version;
export const RUNNINGHUB_MODELS = source.models;
export const RUNNINGHUB_CATEGORIES = Array.from(new Set(RUNNINGHUB_MODELS.map(model => model.category))).sort();

export function runningHubModelByClassName(className: string): RunningHubModelContract | undefined {
  return RUNNINGHUB_MODELS.find(model => model.class_name === className);
}

/**
 * 国内端点（www.runninghub.cn/openapi/v2）不可用的模型：endpoint 含 `-official` 标记，
 * 服务端在其提交时返回 40310（需迁移到全球端 runninghub.ai），因此在节点库中置灰提示。
 * 仅用于 UI 可见性，不改动 registry 数据。
 */
export function runningHubModelUnavailableInCn(model: Pick<RunningHubModelContract, 'endpoint' | 'display_name' | 'name_cn'>): boolean {
  const isOfficial = /-official/i.test(model.endpoint);
  const markedDown = /\[Deprecated\]|-deprecated|已下架/i.test(`${model.endpoint} ${model.name_cn || ''} ${model.display_name || ''}`);
  return isOfficial || markedDown;
}

const TRUSTED_LABELS: Record<string, string> = {
  prompt: '提示词', negativePrompt: '反向提示词', width: '宽度', height: '高度', size: '尺寸', seed: '随机种子', n: '生成数量', imageNum: '图片数量',
  imageUrl: '输入图片', imageUrls: '输入图片', videoUrl: '输入视频', videoUrls: '输入视频', audioUrl: '输入音频', audioUrls: '输入音频',
  referenceImage: '参考图片', referenceImages: '参考图片', aspectRatio: '画面比例', duration: '时长', resolution: '分辨率', fps: '帧率', frameRate: '帧率',
};

/** 官方中文 label/description 优先；没有可靠译名时保留字段键，避免猜测 API 含义。 */
export function runningHubParamLabel(param: RunningHubParam): string {
  const official = String(param.label || '').trim();
  if (/[\u3400-\u9fff]/.test(official)) return official;
  return TRUSTED_LABELS[param.fieldKey] || official || param.fieldKey;
}
export function runningHubParamHelp(param: RunningHubParam): string {
  const description = String(param.description || '').trim();
  const unknown = !/[\u3400-\u9fff]/.test(description) && !TRUSTED_LABELS[param.fieldKey];
  const range = typeof param.min === 'number' || typeof param.max === 'number' ? `范围：${param.min ?? '-∞'} 至 ${param.max ?? '∞'}` : '';
  return [description && description !== param.fieldKey ? description : '', range, unknown ? `官方字段：${param.fieldKey}（请参阅 RunningHub 官方参数说明）` : ''].filter(Boolean).join(' · ');
}
export function runningHubAllowsMultipleMedia(param: RunningHubParam): boolean {
  return /Urls$|Images$|Videos$|Audios$/i.test(param.fieldKey) || /多图|多张|数组|1[-–—]?\d+张|1-3张/i.test(String(param.description || ''));
}
/** Only create numbered slots when the official description states a count. */
export function runningHubMediaSlotCount(param: RunningHubParam): number {
  if (!runningHubAllowsMultipleMedia(param)) return 1;
  const description = String(param.description || '');
  const range = description.match(/(?:\d+\s*[-–—]\s*)(\d+)\s*(?:张|个|段|图片|图像|视频|音频)/i);
  const maximum = description.match(/最多\s*(\d+)\s*(?:张|个|段|图片|图像|视频|音频)/i);
  const count = Number(range?.[1] || maximum?.[1] || 1);
  return Number.isFinite(count) && count > 0 ? Math.min(count, 12) : 1;
}
export function runningHubSlotKey(fieldKey: string, index: number): string {
  return `${fieldKey}__${index + 1}`;
}
/** Content that can meaningfully come from another canvas node. Numeric/config switches stay local to the node. */
export function runningHubIsConnectableInput(param: RunningHubParam): boolean {
  if (['IMAGE', 'VIDEO', 'AUDIO', 'STRING', 'TEXT'].includes(param.type)) return true;
  const key = `${param.fieldKey} ${param.description || ''}`.toLowerCase();
  return param.type === 'LIST' && /style|风格|reference|参考|mode|模式|type|类型|adapter|适配/i.test(key);
}
/** Contract-declared optional result channels. */
export function runningHubOptionalOutputs(model: RunningHubModelContract): Array<{ id: string; label: string; type: string }> {
  const outputs: Array<{ id: string; label: string; type: string }> = [];
  if (model.output_type === 'video' && model.params.some(param => param.fieldKey === 'returnLastFrame' && /尾帧|last.?frame/i.test(`${param.fieldKey} ${param.description || ''}`))) {
    outputs.push({ id: 'lastFrame', label: '尾帧图片（开启后）', type: 'image' });
  }
  return outputs;
}

export function runningHubDefaults(model: RunningHubModelContract): Record<string, unknown> {
  return Object.fromEntries(model.params.filter(param => param.defaultValue !== undefined).map(param => [param.fieldKey, param.defaultValue]));
}

export function runningHubMediaFields(model: RunningHubModelContract): Record<string, string> {
  return Object.fromEntries(model.params.filter(param => ['IMAGE', 'VIDEO', 'AUDIO'].includes(param.type)).map(param => [param.fieldKey, param.type.toLowerCase()]));
}
