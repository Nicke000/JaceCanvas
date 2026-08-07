import type { NodeComponentType } from '@/types';

export interface TemplateStep {
  /** addNode 的节点类型（'apiNode' / 'paidCapability' / 本地节点类型） */
  type: string;
  label?: string;
  /** paidCapability：能力 id（如 text-to-speech） */
  capability?: string;
  /** paidCapability：指定厂商（留空自动取第一个可用厂商） */
  provider?: string;
  /** apiNode：工作流 id */
  workflowId?: string;
  config?: Record<string, unknown>;
}

export interface DomainTemplate {
  id: string;
  name: string;
  domain: '短剧' | '电商' | '通用';
  desc: string;
  steps: TemplateStep[];
  /** 步骤间连线（from/to 为 steps 索引） */
  links: Array<{ from: number; to: number; fromPort?: string; toPort?: string }>;
}

/** 专业领域预置模板：一键添加到画布（自动排布 + 连线 + 预填参数） */
export const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    id: 'drama-storyboard',
    name: '短剧分镜流水线',
    domain: '短剧',
    desc: '剧本 → 剧情分镜（人物/场景/运镜）→ 预览；分镜输出可再接文生图/视频节点',
    steps: [
      { type: 'scriptInput', label: '剧本输入' },
      { type: 'storyboardPrompt', label: '剧情分镜' },
      { type: 'preview', label: '分镜预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'script' },
      { from: 1, to: 2, fromPort: 'storyboard_list', toPort: 'media' },
    ],
  },
  {
    id: 'drama-4grid',
    name: '短剧宫格成片',
    domain: '短剧',
    desc: '一句话剧本 → LTX-2.3 四宫格短剧工作流 → 视频预览',
    steps: [
      { type: 'textInput', label: '剧本一句话' },
      { type: 'apiNode', label: 'LTX 4宫格短剧', workflowId: 'LTX-2.3-4宫格V3短剧' },
      { type: 'preview', label: '结果预览' },
    ],
    links: [{ from: 1, to: 2, fromPort: 'output', toPort: 'media' }],
  },
  {
    id: 'drama-full',
    name: '短剧完整流水线',
    domain: '短剧',
    desc: '剧本 → 分镜（含台词/角色）→ 逐镜图+视频+配音 → 时间线合成 → 成片。写个剧本就能出片（视频/配音生成较慢，可按需关闭）',
    steps: [
      { type: 'scriptInput', label: '剧本输入' },
      { type: 'storyboardPrompt', label: '剧情分镜', config: { personCount: 2, segmentCount: 3, totalDuration: 15 } },
      { type: 'storyboardRender', label: '分镜批量生成', config: { generateVideo: true, generateAudio: true, variants: 1 } },
      { type: 'timelineRender', label: '时间线合成' },
      { type: 'preview', label: '成片预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'script' },
      { from: 1, to: 2, fromPort: 'storyboard_list', toPort: 'script' },
      { from: 2, to: 3, fromPort: 'results', toPort: 'results' },
      { from: 3, to: 4, fromPort: 'video', toPort: 'media' },
    ],
  },
  {
    id: 'drama-lipsync',
    name: '对口型配音数字人',
    domain: '短剧',
    desc: '台词 → MiniMax 语音合成 → 对口型数字人 → 视频（需上传/连接人物图）',
    steps: [
      { type: 'paidCapability', label: '文字转语音', capability: 'text-to-speech', config: { voice_id: 'female-tianmei' } },
      { type: 'lipSyncHuman', label: '对口型数字人' },
      { type: 'preview', label: '结果预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'audio', toPort: 'audio' },
      { from: 1, to: 2, fromPort: 'video', toPort: 'media' },
    ],
  },
  {
    id: 'ecom-outfit',
    name: '模特换装出图',
    domain: '电商',
    desc: '上传模特图 → Qwen 编辑（换装+换姿势+换动作）→ 预览',
    steps: [
      { type: 'uploadNode', label: '模特图' },
      { type: 'apiNode', label: 'Qwen 换装编辑', workflowId: 'Qwen编辑（换装+换姿势+换动作）' },
      { type: 'preview', label: '结果预览' },
    ],
    links: [{ from: 1, to: 2, fromPort: 'output', toPort: 'media' }],
  },
  {
    id: 'ecom-main-image',
    name: '电商主图生成',
    domain: '电商',
    desc: '商品描述 → 文生图 → 预览（可在节点内切换火山/Flux/可灵等厂商）',
    steps: [
      { type: 'textInput', label: '商品描述' },
      { type: 'paidCapability', label: '文生图', capability: 'text-to-image' },
      { type: 'preview', label: '结果预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'prompt' },
      { from: 1, to: 2, fromPort: 'image', toPort: 'media' },
    ],
  },
  {
    id: 'ecom-batch-line',
    name: '电商批量主图流水线',
    domain: '电商',
    desc: '商品描述 → 批量文生图（一次 4 张变体）→ 网格对比选图 → 主图输出',
    steps: [
      { type: 'textInput', label: '商品描述' },
      { type: 'paidCapability', label: '批量文生图', capability: 'text-to-image', config: { variants: 4 } },
      { type: 'preview', label: '主图网格对比' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'prompt' },
      { from: 1, to: 2, fromPort: 'image', toPort: 'media' },
    ],
  },
  {
    id: 'general-t2v',
    name: '通用文生视频',
    domain: '通用',
    desc: '描述 → 文生视频 → 预览（可在节点内切换厂商/模型）',
    steps: [
      { type: 'textInput', label: '视频描述' },
      { type: 'paidCapability', label: '文生视频', capability: 'text-to-video' },
      { type: 'preview', label: '结果预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'prompt' },
      { from: 1, to: 2, fromPort: 'video', toPort: 'media' },
    ],
  },

  {
    id: 'drama-solo',
    name: '短剧单人独白',
    domain: '短剧',
    desc: '单人独白短剧（低成本快出）：剧本 → 单人分镜（1 角色 2 片段）→ 预览',
    steps: [
      { type: 'scriptInput', label: '剧本输入' },
      { type: 'storyboardPrompt', label: '单人分镜', config: { personCount: 1, segmentCount: 2, totalDuration: 8 } },
      { type: 'preview', label: '分镜预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'script' },
      { from: 1, to: 2, fromPort: 'storyboard_list', toPort: 'media' },
    ],
  },
  {
    id: 'drama-duo-batch',
    name: '短剧双人批量出图',
    domain: '短剧',
    desc: '双人对话短剧 → 批量分镜出图（只出图不生成视频，适合快速做分镜脚本图）',
    steps: [
      { type: 'scriptInput', label: '剧本输入' },
      { type: 'storyboardPrompt', label: '双人分镜', config: { personCount: 2, segmentCount: 4, totalDuration: 20 } },
      { type: 'storyboardRender', label: '批量出图', config: { generateVideo: false, generateAudio: false, variants: 1 } },
      { type: 'preview', label: '分镜图预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'script' },
      { from: 1, to: 2, fromPort: 'storyboard_list', toPort: 'script' },
      { from: 2, to: 3, fromPort: 'results', toPort: 'media' },
    ],
  },
  {
    id: 'ecom-white-bg',
    name: '电商白底图去背景',
    domain: '电商',
    desc: '上传商品图 → 一键去背景出白底图（remove-background 能力）→ 预览/保存',
    steps: [
      { type: 'uploadNode', label: '商品图' },
      { type: 'paidCapability', label: '去背景', capability: 'remove-background' },
      { type: 'preview', label: '白底图预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'output', toPort: 'image' },
      { from: 1, to: 2, fromPort: 'image', toPort: 'media' },
    ],
  },
  {
    id: 'ecom-video-main',
    name: '电商商品视频主图',
    domain: '电商',
    desc: '商品描述 → 文生视频（text-to-video 能力）→ 预览，适合做动态主图/详情视频',
    steps: [
      { type: 'textInput', label: '商品描述' },
      { type: 'paidCapability', label: '文生视频', capability: 'text-to-video' },
      { type: 'preview', label: '视频预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'text', toPort: 'prompt' },
      { from: 1, to: 2, fromPort: 'video', toPort: 'media' },
    ],
  },
  {
    id: 'ecom-scene-bg',
    name: '电商商品场景合成',
    domain: '电商',
    desc: '上传商品图 → 背景生成/场景合成（background-generation）→ 预览，适合氛围图/场景图',
    steps: [
      { type: 'uploadNode', label: '商品图' },
      { type: 'paidCapability', label: '场景合成', capability: 'background-generation' },
      { type: 'preview', label: '场景图预览' },
    ],
    links: [
      { from: 0, to: 1, fromPort: 'output', toPort: 'image' },
      { from: 1, to: 2, fromPort: 'image', toPort: 'media' },
    ],
  },
];