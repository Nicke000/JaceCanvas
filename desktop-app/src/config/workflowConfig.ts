/**
 * 工作流配置解析器
 * 从 _workflows_config.json 中提取参数并按类型智能分组，生成友好的表单控件
 */
import rawConfig from './_workflows_config.json';

// ========== 类型定义 ==========
export interface WorkflowField {
  nodeId: string; fieldName: string; type: 'string' | 'number' | 'boolean' | 'select';
  default: unknown; nodeTitle: string; nodeClass: string;
  group: 'prompt' | 'negative_prompt' | 'dimensions' | 'sampler' | 'output' | 'model' | 'control' | 'other';
  label: string;
  options?: { label: string; value: string }[];
}

export interface WorkflowConfig {
  id: string; nodeCount: number;
  coreParams: WorkflowField[];
  advancedParams: WorkflowField[];
  defaultValueMap: Record<string, unknown>;
}

// ========== 采样器/调度器选项 ==========
export const SAMPLER_OPTIONS = [
  { label: 'Euler', value: 'euler' },{ label: 'Euler A', value: 'euler_ancestral' },
  { label: 'DPM++ 2M', value: 'dpmpp_2m' },{ label: 'DPM++ SDE', value: 'dpmpp_sde' },
  { label: 'DDIM', value: 'ddim' },{ label: 'Res Multistep', value: 'res_multistep' },
];
export const SCHEDULER_OPTIONS = [
  { label: 'Normal', value: 'normal' },{ label: 'Karras', value: 'karras' },
  { label: 'Simple', value: 'simple' },{ label: 'Exponential', value: 'exponential' },
];

// ========== 字段分组规则 ==========
function classifyField(nodeClass: string, nodeTitle: string, fieldName: string): WorkflowField['group'] {
  const cls = nodeClass.toLowerCase(); const title = nodeTitle.toLowerCase(); const fn = fieldName.toLowerCase();
  if (cls.includes('cliptextencode')) {
    if (title.includes('negative') || title.includes('负面')) return 'negative_prompt';
    return 'prompt';
  }
  if (title.includes('提示词') || title.includes('prompt') || title.includes('描述')) return 'prompt';
  if (fn === 'width' || fn === 'height' || fn === 'batch_size' || cls.includes('latentimage') || cls.includes('resolution')) return 'dimensions';
  if (title.includes('分辨率') || title.includes('尺寸') || title.includes('width') || title.includes('height')) return 'dimensions';
  if (cls.includes('ksampler') || fn === 'seed' || fn === 'steps' || fn === 'cfg' || fn === 'sampler_name' || fn === 'scheduler' || fn === 'denoise') return 'sampler';
  if (cls.includes('saveimage') || fn === 'filename_prefix' || fn === 'output_format') return 'output';
  if (cls.includes('loader') || fn.includes('model') || fn.includes('vae') || fn.includes('clip') || fn.includes('unet') || fn.includes('lora')) return 'model';
  if (fn === 'shift' || fn === 'guidance' || fn === 'strength' || fn === 'fps' || fn === 'duration' || fn === 'scale' || fn === 'shot_num_secs' || fn === 'frame_rate' || fn === 'num_frames' || fn === 'style') return 'control';
  return 'other';
}

// ========== 字段标签 ==========
const KNOWN_LABELS: Record<string, string> = {
  text:'提示词',prompt:'提示词',width:'宽度',height:'高度',batch_size:'批量',
  seed:'种子',steps:'步数',cfg:'CFG 强度',sampler_name:'采样器',scheduler:'调度器',
  denoise:'降噪',filename_prefix:'文件名前缀',vae_name:'VAE',clip_name:'CLIP',
  model_name:'模型',unet_name:'UNet',lora_name:'LoRA',shift:'Shift',
  strength:'强度',duration:'时长(秒)',fps:'帧率',scale:'放大倍数',
  guidance:'引导强度',quality:'质量',aspect_ratio:'宽高比',megapixels:'像素量(MP)',
  shot_num_secs:'镜头时长(秒)',frame_rate:'帧率',num_frames:'帧数',style:'风格',
};
function fieldLabel(nodeTitle: string, fieldName: string): string {
  if (KNOWN_LABELS[fieldName]) return KNOWN_LABELS[fieldName];
  return fieldName.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

/** ComfyUI 的 Load* 节点和常见字段名是上传参数，而不是普通文本。 */
export function mediaTypeForField(nodeClass: string, fieldName: string): 'image' | 'video' | 'audio' | undefined {
  const cls = nodeClass.toLowerCase();
  const field = fieldName.toLowerCase();
  if (cls.includes('loadaudio') || /audio|sound|voice/.test(field)) return 'audio';
  if (cls.includes('loadvideo') || cls.includes('vhs_loadvideo') || /video|motion/.test(field)) return 'video';
  // ComfyUI 的 file/file_path 参数通常仍然接收图片；统一走图片上传/桥接，
  // 避免把它当普通字符串后无法连接上传节点。
  if (cls.includes('loadimage') || /image|mask|reference|ref_image|file|path|font/.test(field)) return 'image';
  return undefined;
}

// ========== Select 选项生成 ==========
function getOptions(fieldName: string): { label: string; value: string }[] | undefined {
  if (fieldName === 'sampler_name') return SAMPLER_OPTIONS;
  if (fieldName === 'scheduler') return SCHEDULER_OPTIONS;
  if (fieldName === 'style') return [{label:'动漫',value:'anime'},{label:'写实',value:'realistic'},{label:'电影',value:'cinematic'},{label:'摄影',value:'photographic'},{label:'插画',value:'illustration'},{label:'3D',value:'3d'},{label:'简洁',value:'clean'},{label:'详细',value:'detailed'}];
  if (fieldName === 'aspect_ratio') return [{label:'1:1',value:'1:1'},{label:'9:16 竖屏',value:'9:16 (Portrait Widescreen)'},{label:'16:9 横屏',value:'16:9 (Landscape Widescreen)'},{label:'3:4',value:'3:4'},{label:'4:3',value:'4:3'}];
  if (fieldName === 'quality') return [{label:'高',value:'high'},{label:'中',value:'medium'},{label:'低',value:'low'}];
  if (fieldName === 'remove_watermark') return [{label:'是',value:'true'},{label:'否',value:'false'}];
  if (fieldName === 'output_format') return [{label:'PNG',value:'png'},{label:'JPG',value:'jpg'},{label:'MP4',value:'mp4'}];
  return undefined;
}

function normalizeType(fieldName: string, fieldData: any): WorkflowField['type'] {
  const value = fieldData?.default;
  if (typeof value === 'boolean' || /^(true|false)$/i.test(String(value ?? ''))) return 'boolean';
  if (Array.isArray(fieldData?.options) || Array.isArray(fieldData?.values) || getOptions(fieldName)?.length) return 'select';
  if (typeof value === 'number' || /^(int|float|number|integer)$/i.test(String(fieldData?.type || ''))) return 'number';
  return 'string';
}

// ========== 核心 vs 高级分组 ==========
const CORE_GROUPS: WorkflowField['group'][] = ['prompt', 'negative_prompt', 'dimensions', 'sampler', 'control'];
const ADVANCED_GROUPS: WorkflowField['group'][] = ['model', 'output', 'other'];

// ========== 主解析 + 缓存 ==========
const configMap = new Map<string, WorkflowConfig>();

function parseWorkflow(id: string, data: any): WorkflowConfig {
  const fields: WorkflowField[] = [];
  const defaultValueMap: Record<string, unknown> = {};
  if (data.inputs) {
    for (const [nodeId, nodeData] of Object.entries(data.inputs) as [string, any][]) {
      if (!nodeData.fields) continue;
      for (const [fieldName, fieldData] of Object.entries(nodeData.fields) as [string, any][]) {
        const group = classifyField(nodeData.class||'', nodeData.title||'', fieldName);
        const label = fieldLabel(nodeData.title||'', fieldName);
        const options = getOptions(fieldName);
        const type = normalizeType(fieldName, fieldData);
        const dynamicOptions = Array.isArray(fieldData.options) ? fieldData.options.map((option: any) => ({ label: String(option.label ?? option), value: String(option.value ?? option) })) : Array.isArray(fieldData.values) ? fieldData.values.map((option: any) => ({ label: String(option), value: String(option) })) : options;
        fields.push({ nodeId, fieldName, type, default: fieldData.default, nodeTitle: nodeData.title||nodeId, nodeClass: nodeData.class||'', group, label, options: dynamicOptions });
        defaultValueMap[`${nodeId}:${fieldName}`] = fieldData.default;
      }
    }
  }
  const cfg: WorkflowConfig = { id, nodeCount: data.nodeCount||0, coreParams: fields.filter(f=>CORE_GROUPS.includes(f.group)), advancedParams: fields.filter(f=>ADVANCED_GROUPS.includes(f.group)), defaultValueMap };
  configMap.set(id, cfg);
  return cfg;
}

// 预解析
for (const [id, data] of Object.entries(rawConfig)) { parseWorkflow(id, data); }

// ========== 对外 API ==========
export function getWorkflowConfig(workflowId: string): WorkflowConfig | undefined { return configMap.get(workflowId); }
export function getAllWorkflowIds(): string[] { return [...configMap.keys()]; }