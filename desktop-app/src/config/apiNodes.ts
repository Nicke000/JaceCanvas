/** API 节点定义 - 从 _workflows_config.json 自动提取 */
import type { NodeComponentType } from '@/types';
import type { WorkflowField } from './workflowConfig';
import { getWorkflowConfig, getAllWorkflowIds } from './workflowConfig';

export interface ApiNodeDef {
  type: string;            // 类型标识 (如 wf_ZimageNunchaku)
  label: string;           // 短显示名
  fullName: string;        // 完整工作流名(workflow_id)
  icon: string;            // emoji
  color: string;
  category: string;        // 文生图/视频/数字人...
  workflows: string[];     // 关联的工作流ID列表(一个节点可能对应多个工作流变体)
}

// ========== API 节点定义 (手动配置：类型标识 → 显示信息 + workfow_id) ==========
// type 用于 toolbar 的 apiType, fullName/workflows 用于匹配 _workflows_config
const API_NODE_DEFS: ApiNodeDef[] = [
  // ====== 文生图 ======
  { type:'wf_ZimageNunchaku', label:'Zimage·文生图', fullName:'文生图-Zimage-Nunchaku', icon:'⚡', color:'#a855f7', category:'文生图', workflows:['文生图-Zimage-Nunchaku'] },
  { type:'wf_Zimage双采', label:'Zimage·双采放大', fullName:'Zimage双采-三采-双放大', icon:'🔍', color:'#a855f7', category:'文生图', workflows:['Zimage双采-三采-双放大'] },
  { type:'wf_Krea2', label:'Krea2·写实', fullName:'Krea2文生图写实质感', icon:'🎨', color:'#fb923c', category:'文生图', workflows:['Krea2文生图写实质感'] },
  { type:'wf_Qwen双节棍', label:'Qwen·双节棍', fullName:'Qwen双节棍生图', icon:'🖼️', color:'#6366f1', category:'文生图', workflows:['Qwen双节棍生图'] },
  { type:'wf_Qwen多视图', label:'Qwen·多视图', fullName:'Qwen多视图生成', icon:'🔲', color:'#6366f1', category:'文生图', workflows:['Qwen多视图生成'] },
  { type:'wf_Qwen人物展示', label:'Qwen·人物展示', fullName:'Qwen人物多角度展示', icon:'👤', color:'#6366f1', category:'文生图', workflows:['Qwen人物多角度展示'] },
  // ====== 图编辑 ======
  { type:'wf_Qwen编辑', label:'Qwen·换装换姿', fullName:'Qwen编辑（换装+换姿势+换动作）', icon:'✏️', color:'#818cf8', category:'图编辑', workflows:['Qwen编辑（换装+换姿势+换动作）'] },
  { type:'wf_Qwen二次元转真人', label:'Qwen·二次元转真人', fullName:'Qwen二次元转真人+高清放大', icon:'✨', color:'#818cf8', category:'图编辑', workflows:['Qwen二次元转真人+高清放大'] },
  { type:'wf_SeedVR2放大', label:'Seed·高清放大', fullName:'Seed VR2图片高清放大', icon:'🔍', color:'#14b8a6', category:'图编辑', workflows:['Seed VR2图片高清放大'] },
  // ====== 视频 ======
  { type:'wf_LTX四宫格', label:'LTX·四宫格短剧', fullName:'LTX-2.3-4宫格V3短剧', icon:'🎬', color:'#22c55e', category:'视频', workflows:['LTX-2.3-4宫格V3短剧'] },
  { type:'wf_LTX动作模仿', label:'LTX·动作模仿', fullName:'Ltx2.3动作模仿-图片跳舞-动作迁移', icon:'🏃', color:'#d946ef', category:'视频', workflows:['Ltx2.3动作模仿-图片跳舞-动作迁移'] },
  { type:'wf_WanAnimate', label:'Wan·动作迁移', fullName:'动作迁移-Wan2.2-Animate', icon:'🏃', color:'#d946ef', category:'视频', workflows:['动作迁移-Wan2.2-Animate','Wan2.2 Animate动作迁移真人动作对齐Q版人物（全身动作对齐半身图像）'] },
  // ====== 数字人 ======
  { type:'wf_对口型单人图', label:'对口型·单人图', fullName:'对口型-InfiniteTalk单人图像驱动', icon:'👄', color:'#eab308', category:'数字人', workflows:['对口型-InfiniteTalk单人图像驱动'] },
  { type:'wf_对口型双人', label:'对口型·双人', fullName:'对口型-InfiniteTalk双人图像驱动', icon:'👄', color:'#eab308', category:'数字人', workflows:['对口型-InfiniteTalk双人图像驱动'] },
  // ====== JoyAI ======
  { type:'wf_JoyAIEcho', label:'JoyAI·多镜头', fullName:'JoyAI-Echo 多镜头连贯视频与音频生成', icon:'🎭', color:'#c084fc', category:'视频', workflows:['JoyAI-Echo 多镜头连贯视频与音频生成'] },
];

export const API_NODES = API_NODE_DEFS;
// 新工作流不再需要手工登记：只要进入桌面端配置，就会自动出现在节点库。
const AUTO_API_NODE_DEFS: ApiNodeDef[] = getAllWorkflowIds()
  .filter(workflowId => !API_NODE_DEFS.some(node => node.workflows.includes(workflowId)))
  .map((workflowId, index) => ({
    type: `wf_auto_${index}_${workflowId}`,
    label: workflowId,
    fullName: workflowId,
    icon: '🔌',
    color: '#6366f1',
    category: /音频|声音|audio/i.test(workflowId) ? '音频' : /视频|video|wan|ltx|animate/i.test(workflowId) ? '视频' : '图像',
    workflows: [workflowId],
  }));

export const ALL_API_NODES = [...API_NODE_DEFS, ...AUTO_API_NODE_DEFS];
export const API_NODE_MAP = new Map(ALL_API_NODES.map(n => [n.type, n]));
export const API_TYPE_LIST = ALL_API_NODES.map(n => n.type);

// ========== 从配置中获取工作流的参数 ==========
export interface ApiFormField {
  key: string;          // 'nodeId:fieldName'
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea';
  default: unknown;
  options?: { label: string; value: string }[];
  group: WorkflowField['group'];
  nodeTitle: string;
}

export function getApiNodeFormFields(apiType: string): { coreParams: ApiFormField[]; advancedParams: ApiFormField[]; defaultValues: Record<string, unknown>; workflowIds: string[] } | null {
  const def = API_NODE_MAP.get(apiType);
  if (!def) return null;

  const allFields: ApiFormField[] = [];
  const defaultValues: Record<string, unknown> = {};
  const workflowIds: string[] = [];

  for (const wfId of def.workflows) {
    const cfg = getWorkflowConfig(wfId);
    if (!cfg) continue;
    workflowIds.push(wfId);
    // 合并默认值 (后面的覆盖前面的)
    Object.assign(defaultValues, cfg.defaultValueMap);
    // 合并字段
    for (const f of [...cfg.coreParams, ...cfg.advancedParams]) {
      const key = `${f.nodeId}:${f.fieldName}`;
      if (allFields.some(e => e.key === key)) continue; // 去重
      let ft: ApiFormField['type'] = 'text';
      if (f.type === 'number') ft = 'number';
      else if (f.type === 'boolean') ft = 'boolean';
      else if (f.options && f.options.length > 0) ft = 'select';
      else if (f.group === 'prompt' || f.group === 'negative_prompt') ft = 'textarea';
      allFields.push({ key, label: f.label, type: ft, default: f.default, options: f.options, group: f.group, nodeTitle: f.nodeTitle });
    }
  }

  return { coreParams: allFields.filter(f => ['prompt','negative_prompt','dimensions','sampler','control'].includes(f.group)), advancedParams: allFields.filter(f => ['model','output','other'].includes(f.group)), defaultValues, workflowIds };
}