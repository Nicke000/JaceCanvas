import { PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';

/**
 * 付费 API 能力目录。
 *
 * 这里的供应商名单只收录本地“各厂商 api 说明”目录中能核对到的能力：
 * 文档只有动态入口、没有可审计接口的厂商，不会因为名称相似而自动获得扩展能力。
 */
export const VERIFIED_PAID_CAPABILITIES: Record<PaidCapability, string[]> = {
  'text-to-speech': ['custom', 'gateway', 'minimax', 'elevenlabs'],
  'text-to-3d': ['custom', 'gateway', 'meshy'],
  'image-to-3d': ['custom', 'gateway', 'meshy'],
  'text-to-image': ['custom', 'gateway', 'openai', 'google', 'minimax', 'tongyi', 'zhipu', 'jimeng', 'kling', 'stability'],
  'image-to-image': ['custom', 'gateway', 'openai', 'google', 'minimax', 'tongyi', 'zhipu', 'jimeng', 'kling', 'stability'],
  'text-to-video': ['custom', 'gateway', 'openai', 'google', 'minimax', 'runway', 'kling', 'tongyi', 'zhipu', 'jimeng'],
  'image-to-video': ['custom', 'gateway', 'openai', 'google', 'minimax', 'runway', 'kling', 'tongyi', 'zhipu', 'jimeng'],
  'first-frame-to-image': ['custom', 'gateway', 'openai', 'google', 'minimax', 'tongyi', 'zhipu', 'jimeng', 'kling', 'stability'],
  'first-frame-to-video': ['custom', 'gateway', 'openai', 'google', 'minimax', 'tongyi', 'zhipu', 'jimeng', 'kling', 'runway'],
  // Runway 与 MiniMax 的本地官方导出明确包含异步视频/首尾帧相关接口；其他厂商等待文档补齐。
  'first-last-to-video': ['custom', 'gateway', 'minimax', 'runway', 'kling'],
  'image-upscale': ['custom', 'gateway', 'stability'],
  'remove-background': ['custom', 'gateway', 'stability'],
  outpaint: ['custom', 'gateway', 'stability'],
  'background-generation': ['custom', 'gateway', 'minimax', 'stability'],
  'style-transfer': ['custom', 'gateway', 'minimax', 'stability'],
  'reference-to-video': ['custom', 'gateway', 'minimax', 'runway', 'kling'],
  'motion-video': ['custom', 'gateway', 'tongyi', 'minimax', 'kling'],
  'video-swap': ['custom', 'gateway', 'runway', 'tongyi'],
  'video-edit': ['custom', 'gateway', 'minimax', 'runway', 'openai', 'kling'],
  'dance-video': ['custom', 'gateway', 'tongyi', 'minimax'],
  // 4.6.8 补齐：对口型（百炼 VideoRetalk）、可灵主体管理、可灵音色管理。
  lipsync: ['custom', 'gateway', 'tongyi'],
  'element-manage': ['custom', 'gateway', 'kling'],
  'voice-manage': ['custom', 'gateway', 'kling'],
};

const MODEL_CAPABILITY_HINTS: Array<{ pattern: RegExp; capabilities: PaidCapability[] }> = [
  { pattern: /upscale|super.?res|高清|放大|enhance/i, capabilities: ['image-upscale'] },
  { pattern: /remove.?bg|background.?remov|抠图|去背/i, capabilities: ['remove-background'] },
  { pattern: /outpaint|扩图|扩展/i, capabilities: ['outpaint'] },
  { pattern: /background|背景/i, capabilities: ['background-generation'] },
  { pattern: /style|风格|repaint|重绘/i, capabilities: ['style-transfer'] },
  { pattern: /first.?frame|首帧/i, capabilities: ['first-frame-to-image'] },
  { pattern: /first.?frame|首帧/i, capabilities: ['first-frame-to-video'] },
  { pattern: /first.?last|首尾|首中尾/i, capabilities: ['first-last-to-video'] },
  { pattern: /reference|参考|character|主体/i, capabilities: ['reference-to-video'] },
  // Wan2.2 本身不是“图生动作”证明；只有 Animate/Motion 变体才进入该能力。
  { pattern: /animate|motion|动作/i, capabilities: ['motion-video'] },
  { pattern: /swap|换人|replace/i, capabilities: ['video-swap'] },
  { pattern: /edit|video.?to.?video|视频编辑/i, capabilities: ['video-edit'] },
  { pattern: /dance|舞蹈|跳舞/i, capabilities: ['dance-video'] },
];

export function normalizePaidProvider(provider: string): string {
  return provider === 'openai_paid' ? 'openai' : provider === 'google_paid' ? 'google' : provider;
}

/**
 * 有模型列表时，只对明确命中的模型开放扩展能力；基础四类仍由厂商能力决定。
 * 自定义接口/网关必须由用户在设置中明确勾选能力，未勾选时不显示任何能力节点。
 */
export function getSupportedPaidCapabilities(provider: string, models: string[] = [], explicitlyEnabled: string[] = []): PaidCapability[] {
  const normalized = normalizePaidProvider(provider);
  const providerCapabilities = (Object.keys(VERIFIED_PAID_CAPABILITIES) as PaidCapability[])
    .filter(capability => VERIFIED_PAID_CAPABILITIES[capability].includes(normalized));
  if (normalized === 'custom' || normalized === 'gateway') {
    return providerCapabilities.filter(capability => explicitlyEnabled.includes(capability));
  }
  // 未确定具体模型时不能猜测扩展能力；只保留四类通用基础节点。
  if (!models.length) {
    const base = new Set<PaidCapability>(['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']);
    return providerCapabilities.filter(capability => base.has(capability));
  }

  const modelText = models.join(' ');
  const explicit = new Set<PaidCapability>();
  for (const hint of MODEL_CAPABILITY_HINTS) {
    if (hint.pattern.test(modelText)) hint.capabilities.forEach(capability => explicit.add(capability));
  }
  const base = new Set<PaidCapability>(['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']);
  return providerCapabilities.filter(capability => base.has(capability) || explicit.has(capability));
}

export const PAID_CAPABILITY_LABELS: Partial<Record<PaidCapability, string>> = {
  'first-frame-to-image': '首帧生图',
  'first-frame-to-video': '首帧生视频',
  'first-last-to-video': '首尾帧生成',
  'image-upscale': '图片清晰 / 放大',
  'remove-background': '移除背景',
  outpaint: '扩图',
  'background-generation': '图片背景生成',
  'style-transfer': '风格重绘',
  'reference-to-video': '参考生视频',
  'motion-video': '图生动作',
  'video-swap': '视频换人',
  'video-edit': '视频编辑',
  'dance-video': '图生舞蹈视频',
  lipsync: '对口型 / 声动人像',
  'element-manage': '主体管理',
  'voice-manage': '音色管理',
};

/**
 * 按厂商和能力过滤模型。这里不把“模型名包含 video”当成能力证明，
 * 只有文档中可辨认的模型命名规则才会进入对应节点；未知模型会被隐藏，
 * 避免用户误选后产生付费请求。
 */
const PAID_MODEL_RULES: Partial<Record<PaidCapability, Partial<Record<string, RegExp>>>> = {
  'text-to-image': {
    openai: /dall|gpt-image/i, google: /imagen|image/i, minimax: /image|subject/i,
    tongyi: /wanx|t2i|text.?to.?image|image/i, zhipu: /cogview|image/i, jimeng: /jimeng|image/i,
    kling: /image|text.?to.?image/i, stability: /stable.?diffusion|sd3|sdxl/i,
  },
  'image-to-image': {
    openai: /dall|gpt-image/i, google: /imagen|image/i, minimax: /image|subject/i,
    tongyi: /wanx|image|edit/i, zhipu: /cogview|image/i, jimeng: /jimeng|image|edit/i,
    kling: /image|edit/i, stability: /stable.?diffusion|sd3|sdxl/i,
  },
  'first-frame-to-image': {
    openai: /dall|gpt-image/i, google: /imagen|image/i, minimax: /image|subject/i,
    tongyi: /wanx|image/i, zhipu: /cogview|image/i, jimeng: /jimeng|image/i,
    kling: /image/i, stability: /stable.?diffusion|sd3|sdxl/i,
  },
  'motion-video': {
    // 阿里百炼的图生动作仅允许 Wan2.2 Animate/Motion 变体，不能把普通 Wan2.2
    // 文生视频/图生视频模型放进来。
    tongyi: /(?:^|[\/_:-])wan2[\._-]?2(?:[\._-](?:animate|motion)|animate|motion)(?:[\._-].*)?$/i,
    minimax: /motion|animate|video-01/i,
    kling: /kling-v3-omni|kling-o1|kling/i,
  },
  // 4.6.8：图生舞蹈视频补充百炼「舞动人像 AnimateAnyone」模型。
  'dance-video': { minimax: /dance|motion|animate|video-01/i, tongyi: /animate-anyone|wan2[\._-]?2[\._-](?:animate|dance|motion)(?:[\._-].*)?$/i },
  // 4.6.8：视频换人补充百炼 wan2.2-animate-mix（万相-视频换人）。
  'video-swap': { runway: /character|gen.?3|gen.?4/i, kling: /swap|video|character/i, tongyi: /wan2.*animate.*mix|wan2[\._-]?2[\._-]animate[\._-]mix/i },
  // 4.6.8：对口型（百炼 VideoRetalk 声动人像）。
  lipsync: { tongyi: /videoretalk|retalk/i },
  'first-last-to-video': { runway: /gen.?3|gen.?4|keyframes|first.?last/i, minimax: /video-01|hailuo/i, kling: /kling-v3-omni|kling-o1|kling/i },
  'first-frame-to-video': { runway: /gen.?3|gen.?4|image.?to.?video/i, tongyi: /wan.*(?:image|video)/i, minimax: /video-01|hailuo/i },
  'image-to-video': { runway: /gen.?3|gen.?4/i, tongyi: /wan.*(?:image|video)/i, minimax: /video-01|hailuo/i, kling: /image.?to.?video|video/i },
  'text-to-video': { runway: /gen.?3|gen.?4/i, tongyi: /wan.*(?:text|video)/i, minimax: /video-01|hailuo/i, kling: /text.?to.?video|video/i },
  'video-edit': { openai: /sora|video/i, minimax: /video|hailuo/i, runway: /gen.?3|gen.?4|video/i, kling: /kling-v3-omni|kling-o1|kling/i },
  'reference-to-video': { runway: /gen.?3|gen.?4|character|reference/i, minimax: /video|hailuo/i, kling: /kling-v3-omni|kling-o1|kling/i },
  'image-upscale': { stability: /upscal|enhance|esrgan/i },
  'remove-background': { stability: /background.?remov|remove.?bg/i },
  outpaint: { stability: /outpaint/i },
};

export function getPaidModelsForCapability(provider: string, capability: PaidCapability, models: string[]): string[] {
  if (!models.length) return [];
  const normalized = normalizePaidProvider(provider);
  if (normalized === 'custom' || normalized === 'gateway') return models;
  const rule = PAID_MODEL_RULES[capability]?.[normalized];
  if (rule) return models.filter(model => rule.test(model));
  // 只有能力规则明确列出模型时才显示。不能仅凭“video/image/wan”等词推断
  // 厂商是否真的开放了该能力，否则会把可计费但不可用的模型暴露给用户。
  return [];
}
