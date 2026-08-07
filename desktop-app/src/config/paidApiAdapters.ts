import type { PaidCapability } from '@/services/paidApi.service';

export type PaidProviderId = 'bailian' | 'kling' | 'minimax' | 'gemini' | 'openai' | 'volcengine' | 'flux' | 'fal' | 'meshy' | 'elevenlabs';
export type PaidInputField = 'prompt' | 'image' | 'images' | 'firstImage' | 'lastImage' | 'video' | 'audio' | 'duration' | 'ratio' | 'resolution' | 'fps' | 'seed' | 'template';
export type PaidAuthMode = 'bearer' | 'query-key' | 'x-api-key' | 'x-key' | 'key';

export interface PaidModelDefinition {
  id: string;
  label: string;
  capabilities: PaidCapability[];
  note?: string;
}

export interface PaidProviderDefinition {
  id: PaidProviderId;
  label: string;
  shortLabel: string;
  description: string;
  defaultBaseUrl: string;
  authMode: PaidAuthMode;
  regions?: Array<{ value: string; label: string; baseUrl?: string }>;
  models: PaidModelDefinition[];
  capabilities: PaidCapability[];
  docs: string;
}

/**
 * This is intentionally conservative. Only vendors and model families that
 * are present in 图片.docx / 视频.docx / 素材模板.docx are listed here. A
 * vendor is not exposed just because its name appeared in an old generic list.
 */
export const PAID_API_ADAPTERS: Record<PaidProviderId, PaidProviderDefinition> = {
  bailian: {
    id: 'bailian', label: '阿里云百炼', shortLabel: '百炼',
    description: 'DashScope 原生图像与视频接口；图片同步，视频按任务轮询。',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com', authMode: 'bearer',
    regions: [
      { value: 'cn-beijing', label: '华北 2（北京）' },
      { value: 'ap-southeast-1', label: '新加坡' },
      { value: 'custom', label: '自定义地域' },
    ],
    models: [
      { id: 'z-image-turbo', label: 'Z-Image Turbo', capabilities: ['text-to-image'] },
      { id: 'qwen-image', label: 'Qwen-Image', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'qwen-image-plus', label: 'Qwen-Image Plus', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'qwen-image-max', label: 'Qwen-Image Max', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'qwen-image-2.0', label: 'Qwen-Image 2.0', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'qwen-image-edit', label: 'Qwen-Image Edit', capabilities: ['image-to-image'] },
      { id: 'wan2.7-t2v-2026-06-12', label: 'Wan 2.7 文生视频', capabilities: ['text-to-video'] },
      { id: 'wan2.7-i2v-2026-04-25', label: 'Wan 2.7 图生视频', capabilities: ['image-to-video', 'first-last-to-video'] },
      { id: 'wan2.2-animate-move', label: '万相-图生动作', capabilities: ['motion-video'] },
      { id: 'wan2.2-animate-mix', label: '万相-视频换人', capabilities: ['video-swap'] },
      { id: 'animate-anyone-gen2', label: '舞动人像 AnimateAnyone', capabilities: ['dance-video'] },
      { id: 'videoretalk', label: '声动人像 VideoRetalk', capabilities: ['lipsync'] },
      { id: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1', capabilities: ['text-to-video'] },
      { id: 'happyhorse-1.0-t2v', label: 'HappyHorse 1.0', capabilities: ['text-to-video'] },
      { id: 'kling/kling-v3-omni', label: 'Kling V3 Omni（百炼）', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video'] },
      { id: 'vidu/viduq3-turbo_text2video', label: 'Vidu Q3 Turbo', capabilities: ['text-to-video'] },
    ],
    capabilities: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'motion-video', 'video-swap', 'dance-video', 'lipsync'],
    docs: '付费api节点整理/图片.docx、视频.docx',
  },
  kling: {
    id: 'kling', label: '快手可灵', shortLabel: '可灵',
    description: '可灵官方视频生成、首尾帧、全能参考、动作控制、主体管理、音色管理。',
    defaultBaseUrl: 'https://api-beijing.klingai.com', authMode: 'bearer',
    models: [
      { id: 'kling-v3-omni', label: 'Kling 3.0 Omni', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'motion-video', 'first-last-to-video'] },
      { id: 'kling-o1', label: 'Kling O1', capabilities: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit', 'motion-video', 'first-last-to-video'] },
      { id: 'kling-v2-6', label: 'Kling 2.6', capabilities: ['text-to-video', 'image-to-video'] },
      { id: 'kling-v1-6', label: 'Kling 1.6', capabilities: ['text-to-video', 'image-to-video'] },
    ],
    capabilities: ['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'motion-video', 'video-edit', 'dance-video', 'element-manage', 'voice-manage'],
    docs: '付费api节点整理/视频.docx、素材模板.docx',
  },
  minimax: {
    id: 'minimax', label: 'MiniMax 海螺', shortLabel: 'MiniMax',
    description: 'MiniMax H3 多模态视频接口，支持文本、图片、视频和音频内容数组。',
    defaultBaseUrl: 'https://api.minimaxi.com', authMode: 'bearer',
    models: [
      { id: 'MiniMax-H3', label: 'MiniMax H3', capabilities: ['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'video-edit'] },
      { id: 'speech-2.8-turbo', label: '语音 2.8 Turbo（快/便宜）', capabilities: ['text-to-speech'] },
      { id: 'speech-2.8-hd', label: '语音 2.8 HD（音质佳）', capabilities: ['text-to-speech'] },
    ],
    capabilities: ['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'video-edit', 'text-to-speech'],
    docs: '付费api节点整理/视频.docx',
  },
  gemini: {
    id: 'gemini', label: 'Google Gemini / Veo', shortLabel: 'Gemini',
    description: 'Gemini 图像生成/编辑与 Veo 视频生成接口。',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com', authMode: 'query-key',
    models: [
      { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'veo-3.1-generate-preview', label: 'Veo 3.1', capabilities: ['text-to-video', 'image-to-video', 'first-last-to-video'] },
      { id: 'veo-3.0-generate-preview', label: 'Veo 3', capabilities: ['text-to-video', 'image-to-video'] },
    ],
    capabilities: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'first-last-to-video'],
    docs: '付费api节点整理/图片.docx、视频.docx',
  },
  openai: {
    id: 'openai', label: 'OpenAI', shortLabel: 'OpenAI',
    description: 'OpenAI 图像生成/编辑和视频任务接口。',
    defaultBaseUrl: 'https://api.openai.com/v1', authMode: 'bearer',
    models: [
      { id: 'gpt-image-1', label: 'GPT Image 1', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'sora-2', label: 'Sora 2', capabilities: ['text-to-video', 'image-to-video', 'video-edit'] },
    ],
    capabilities: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'video-edit'],
    docs: '付费api节点整理/图片.docx、视频.docx',
  },
  volcengine: {
    id: 'volcengine', label: '火山方舟', shortLabel: '火山',
    description: '豆包 Seedream 文生图/图生图 + Seedance 视频，Ark 任务创建/查询流程。',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', authMode: 'bearer',
    models: [
      { id: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0', capabilities: ['text-to-image', 'image-to-image', 'first-frame-to-image'] },
      { id: 'doubao-seedance-2-0', label: 'Seedance 2.0', capabilities: ['text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'video-edit'] },
    ],
    capabilities: ['text-to-image', 'image-to-image', 'first-frame-to-image', 'text-to-video', 'image-to-video', 'first-last-to-video', 'reference-to-video', 'video-edit'],
    docs: '付费api节点整理/视频.docx、火山方舟.pdf',
  },
  flux: {
    id: 'flux', label: 'Flux 官方', shortLabel: 'Flux',
    description: 'Black Forest Labs 官方 API：FLUX.2 Pro/Klein/Flex 文生图与图生图，异步任务轮询，x-key 鉴权。',
    defaultBaseUrl: 'https://api.bfl.ai', authMode: 'x-key',
    models: [
      { id: 'flux-2-pro-preview', label: 'FLUX.2 Pro', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'flux-2-klein-9b', label: 'FLUX.2 Klein 9B', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'flux-2-flex', label: 'FLUX.2 Flex', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'flux-1.1-pro', label: 'FLUX.1.1 Pro', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'flux-dev', label: 'FLUX.1 Dev', capabilities: ['text-to-image', 'image-to-image'] },
    ],
    capabilities: ['text-to-image', 'image-to-image'],
    docs: 'https://docs.bfl.ai',
  },
  fal: {
    id: 'fal', label: 'Fal.ai 聚合', shortLabel: 'Fal',
    description: 'fal.ai 聚合平台：FLUX.1 Dev/Schnell/Pro、SD3.5 等模型，队列异步任务，Key 鉴权。',
    defaultBaseUrl: 'https://queue.fal.run', authMode: 'key',
    models: [
      { id: 'fal-ai/flux/dev', label: 'FLUX.1 Dev', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'fal-ai/flux/schnell', label: 'FLUX.1 Schnell', capabilities: ['text-to-image'] },
      { id: 'fal-ai/flux-pro/v1.1', label: 'FLUX.1 Pro v1.1', capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'fal-ai/stable-diffusion-v35-large', label: 'SD3.5 Large', capabilities: ['text-to-image'] },
    ],
    capabilities: ['text-to-image', 'image-to-image'],
    docs: 'https://fal.ai/docs',
  },
  elevenlabs: {
    id: 'elevenlabs', label: 'ElevenLabs 语音', shortLabel: 'EL',
    description: 'ElevenLabs 多语言语音合成（英文音质标杆），xi-api-key 鉴权，模型即音色。',
    defaultBaseUrl: 'https://api.elevenlabs.io', authMode: 'x-api-key',
    models: [
      { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel（英文默认）', capabilities: ['text-to-speech'] },
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', capabilities: ['text-to-speech'] },
      { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Domi', capabilities: ['text-to-speech'] },
      { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', capabilities: ['text-to-speech'] },
    ],
    capabilities: ['text-to-speech'],
    docs: 'https://elevenlabs.io/docs',
  },
  meshy: {
    id: 'meshy', label: 'Meshy 3D', shortLabel: '3D',
    description: 'Meshy 文生3D/图生3D：生成 GLB 模型，文生3D 为 preview→refine 两阶段贴图。',
    defaultBaseUrl: 'https://api.meshy.ai', authMode: 'bearer',
    models: [
      { id: 'meshy-6', label: 'Meshy 6（最新）', capabilities: ['text-to-3d', 'image-to-3d'] },
      { id: 'meshy-5', label: 'Meshy 5', capabilities: ['text-to-3d', 'image-to-3d'] },
    ],
    capabilities: ['text-to-3d', 'image-to-3d'],
    docs: 'https://docs.meshy.ai',
  },
};

export const PAID_PROVIDER_IDS = Object.keys(PAID_API_ADAPTERS) as PaidProviderId[];

export function getPaidAdapter(provider: string): PaidProviderDefinition | undefined {
  return PAID_API_ADAPTERS[provider as PaidProviderId];
}

export function getPaidProvidersForCapability(capability: PaidCapability): PaidProviderDefinition[] {
  return PAID_PROVIDER_IDS.map(id => PAID_API_ADAPTERS[id]).filter(adapter => adapter.capabilities.includes(capability));
}

export function getPaidModelsForAdapter(provider: string, capability: PaidCapability): PaidModelDefinition[] {
  return getPaidAdapter(provider)?.models.filter(model => model.capabilities.includes(capability)) || [];
}
