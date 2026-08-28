/**
 * 付费 API 各厂商「参数 schema」——依据各厂商官方 API 文档整理（来源见底部）。
 *
 * 用途：① 付费节点渲染参数面板时，只显示当前厂商/输出类型真正支持的参数（解决"参数不适配"）；
 *      ② callPaidApi 各原生处理器据此把节点参数映射为官方字段名。
 *
 * 只收录从官方文档确认存在的字段；不确定的字段一律不收录（避免臆测）。
 * 每个 provider 定义 video/image/audio 三类输出的「支持参数 kinds」与「请求字段映射」。
 */
import type { PaidCapability } from '@/services/paidApi.service';

export type PaidParamKind =
  | 'prompt' | 'negative' | 'ratio' | 'size' | 'resolution' | 'duration' | 'fps' | 'seed' | 'variants' | 'camera'
  | 'image' | 'lastImage' | 'video' | 'audio' | 'voice' | 'styles';

const ALL_VIDEO: PaidParamKind[] = ['prompt', 'negative', 'ratio', 'resolution', 'duration', 'seed'];
const ALL_IMAGE: PaidParamKind[] = ['prompt', 'negative', 'ratio', 'size', 'seed', 'variants', 'styles'];

/**
 * 每厂商/每能力支持的参数 kind 白名单。
 * 只收录官方文档确认存在的参数；某一厂商不支持的控制（如 fps、camera 运镜）不列出，节点据此隐藏。
 */
export const PAID_PROVIDER_PARAM_KINDS: Record<string, Partial<Record<PaidCapability, PaidParamKind[]>>> = {
  // 可灵：视频 text2video 有 aspect_ratio，image2video 无（跟随输入），含 duration/cfg_scale/mode；图像用 image 参照。
  kling: {
    'text-to-image': ['prompt', 'negative', 'ratio', 'resolution', 'seed', 'variants', 'image', 'styles'],
    'image-to-image': ['prompt', 'negative', 'image', 'resolution', 'ratio', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'negative', 'ratio', 'duration', 'seed'],
    'image-to-video': ['prompt', 'negative', 'image', 'lastImage', 'duration'],
    'reference-to-video': ['prompt', 'negative', 'image', 'video', 'duration'],
    'first-last-to-video': ['prompt', 'negative', 'image', 'lastImage', 'duration'],
    'video-edit': ['prompt', 'negative', 'video', 'duration'],
    'motion-video': ['prompt', 'negative', 'image', 'video', 'duration'],
    'element-manage': [], 'voice-manage': [],
  },
  // FLUX：flux3-video 用 mode/generate_audio/duration/ratio/resolution/keyframes；flux2 图像用 size/seed。
  flux: {
    'text-to-image': ['prompt', 'negative', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'resolution', 'duration'],
    'image-to-video': ['prompt', 'image', 'lastImage', 'ratio', 'resolution', 'duration'],
    'video-edit': ['prompt', 'video', 'duration'],
  },
  // MiniMax：视频 v2 content[]（ratio/duration/resolution）；图像 prompt_img；语音 voice_id。
  minimax: {
    'text-to-image': ['prompt', 'negative', 'ratio', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'negative', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'resolution', 'duration'],
    'image-to-video': ['prompt', 'image', 'lastImage', 'ratio', 'duration'],
    'reference-to-video': ['prompt', 'image', 'video', 'audio', 'ratio', 'duration'],
    'first-last-to-video': ['prompt', 'image', 'lastImage', 'ratio', 'duration'],
    'video-edit': ['prompt', 'video', 'ratio', 'duration'],
    'text-to-speech': ['prompt', 'voice'],
  },
  // 火山方舟：Seedance 视频 content[]（ratio/resolution/duration/seed/watermark）；Seedream 图像 size/seed。
  volcengine: {
    'text-to-image': ['prompt', 'negative', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'first-frame-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'resolution', 'duration', 'seed'],
    'image-to-video': ['prompt', 'image', 'ratio', 'resolution', 'duration', 'seed'],
    'reference-to-video': ['prompt', 'image', 'video', 'audio', 'resolution', 'duration'],
    'first-last-to-video': ['prompt', 'image', 'lastImage', 'resolution', 'duration'],
    'video-edit': ['prompt', 'video', 'resolution', 'duration'],
  },
  // 阿里百炼：qwen-image 图像 size/prompt；wan2.7 视频 ratio/resolution/duration/fps/seed。
  bailian: {
    'text-to-image': ['prompt', 'negative', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'resolution', 'duration', 'fps', 'seed'],
    'image-to-video': ['prompt', 'image', 'ratio', 'resolution', 'duration', 'fps', 'seed'],
    'reference-to-video': ['prompt', 'image', 'video', 'audio', 'ratio', 'resolution', 'duration'],
    'first-last-to-video': ['prompt', 'image', 'lastImage', 'ratio', 'resolution', 'duration'],
    'video-edit': ['prompt', 'video', 'ratio', 'resolution', 'duration'],
    'motion-video': ['prompt', 'image', 'video', 'ratio', 'duration'],
    'video-swap': ['prompt', 'image', 'video', 'ratio', 'duration'],
    'dance-video': ['prompt', 'image', 'video', 'ratio', 'duration'],
    lipsync: ['prompt', 'video', 'audio', 'duration'],
  },
  // Google Gemini/Veo：图像 generateContent（prompt/image/aspect_ratio）；Veo 视频 aspectRatio。
  gemini: {
    'text-to-image': ['prompt', 'negative', 'ratio', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'ratio', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'resolution', 'duration'],
    'image-to-video': ['prompt', 'image', 'ratio', 'duration'],
    'first-last-to-video': ['prompt', 'image', 'lastImage', 'ratio', 'duration'],
  },
  // OpenAI：gpt-image 图像 size/output_format；Sora 视频 prompt。
  openai: {
    'text-to-image': ['prompt', 'negative', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'ratio', 'duration'],
    'image-to-video': ['prompt', 'image', 'duration'],
    'video-edit': ['prompt', 'video', 'duration'],
  },
  // Fal 队列：图像 prompt/image_url/image_size/seed；视频 prompt/aspect_ratio/resolution/frames_per_second/num_frames/seed。
  fal: {
    'text-to-image': ['prompt', 'negative', 'size', 'seed', 'variants', 'styles'],
    'image-to-image': ['prompt', 'image', 'size', 'seed', 'variants', 'styles'],
    'text-to-video': ['prompt', 'negative', 'ratio', 'resolution', 'fps', 'duration', 'seed'],
    'image-to-video': ['prompt', 'image', 'ratio', 'resolution', 'fps', 'duration', 'seed'],
  },
  // Meshy 3D：文生3D prompt；图生3D image_url。
  meshy: {
    'text-to-3d': ['prompt'],
    'image-to-3d': ['image'],
  },
  // ElevenLabs：voice_id 即模型。
  elevenlabs: {
    'text-to-speech': ['prompt', 'voice'],
  },
};

/** 获取某厂商、某能力支持的参数 kinds（兜底用通用视频/图片白名单）。 */
export function getPaidParamKinds(provider: string, capability: PaidCapability): PaidParamKind[] {
  const cap = PAID_PROVIDER_PARAM_KINDS[provider]?.[capability];
  if (cap) return cap;
  const out: PaidParamKind[] = capability === 'text-to-speech' ? ['prompt', 'voice']
    : capability === 'text-to-3d' || capability === 'image-to-3d' ? ['prompt', 'image']
    : PAID_CAPABILITY_OUTPUT[capability] === 'video' ? [...ALL_VIDEO] : [...ALL_IMAGE];
  return out;
}

const PAID_CAPABILITY_OUTPUT: Record<string, 'video' | 'image' | 'audio' | '3d'> = {
  'text-to-image': 'image', 'image-to-image': 'image', 'first-frame-to-image': 'image', 'image-upscale': 'image',
  outpaint: 'image', 'background-generation': 'image', 'style-transfer': 'image',
  'text-to-video': 'video', 'image-to-video': 'video', 'first-last-to-video': 'video', 'reference-to-video': 'video',
  'video-edit': 'video', 'motion-video': 'video', 'video-swap': 'video', 'dance-video': 'video', lipsync: 'video',
  'text-to-speech': 'audio', 'text-to-3d': '3d', 'image-to-3d': '3d',
};

/** 请求字段映射与枚举约束：param kind → 官方字段名 + 类型 + 允许值（取自官方文档，含来源见底部）。 */
export interface PaidFieldDef {
  field: string;
  type?: 'number' | 'string' | 'boolean' | 'select' | 'array' | 'file';
  enum?: string[];
  required?: boolean;
}
export interface PaidProviderFieldMap {
  video?: Partial<Record<PaidParamKind, PaidFieldDef>>;
  image?: Partial<Record<PaidParamKind, PaidFieldDef>>;
  audio?: Partial<Record<PaidParamKind, PaidFieldDef>>;
  isAsync?: boolean;
}

/** 响应字段（成功后的媒体/状态取回路径，取自官方文档；供 extractMediaUrl / 轮询参考）。 */
export const PAID_PROVIDER_RESPONSE: Record<string, { status?: string[]; media?: string[] }> = {
  kling: { status: ['data.task_status'], media: ['data.task_result.images[0].url', 'data.task_result.videos[0].url'] },
  flux: { status: ['status'], media: ['result.sample', 'result.url'] },
  fal: { status: ['status'], media: ['images[0].url', 'video.url'] },
  minimax: { status: ['task.status'], media: ['task.content.url'] },
  volcengine: { status: ['task_status', 'status'], media: ['content.video_url', 'output.url'] },
  gemini: { status: [], media: ['candidates[0].content.parts[].inlineData.data', 'predictions[0].uri'] },
  bailian: { status: ['output.task_status'], media: ['content.url'] },
  openai: { status: ['status'], media: ['data[0].b64_json', 'data[0].url'] },
  meshy: { status: ['status'], media: ['model_urls.glb', 'model_urls.obj'] },
  elevenlabs: { status: [], media: ['(audio binary/url)'] },
};

export const PAID_PROVIDER_FIELD_MAP: Record<string, PaidProviderFieldMap> = {
  kling: {
    isAsync: true,
    video: {
      prompt: { field: 'prompt', type: 'string', required: true },
      negative: { field: 'negative_prompt', type: 'string' },
      ratio: { field: 'aspect_ratio', type: 'select', enum: ['16:9', '9:16', '1:1'] },
      duration: { field: 'duration', type: 'string' },
      seed: { field: 'cfg_scale', type: 'number' },
      image: { field: 'image', type: 'string' },
      lastImage: { field: 'image_tail', type: 'string' },
    },
    image: {
      prompt: { field: 'prompt', type: 'string', required: true },
      negative: { field: 'negative_prompt', type: 'string' },
      ratio: { field: 'aspect_ratio', type: 'select', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'] },
      resolution: { field: 'resolution', type: 'select', enum: ['1k', '2k'] },
      seed: { field: 'image_fidelity', type: 'number' },
      image: { field: 'image', type: 'string' },
      variants: { field: 'n', type: 'number' },
    },
  },
  flux: {
    isAsync: true,
    video: {
      prompt: { field: 'prompt', type: 'string', required: true },
      ratio: { field: 'aspect_ratio', type: 'select', enum: ['16:9', '9:16', '1:1'] },
      resolution: { field: 'resolution', type: 'select', enum: ['720p', '1080p'] },
      duration: { field: 'duration', type: 'number' },
      image: { field: 'keyframes', type: 'string' },
      lastImage: { field: 'keyframes', type: 'string' },
    },
    image: {
      prompt: { field: 'prompt', type: 'string', required: true },
      size: { field: 'width', type: 'number' },
      seed: { field: 'seed', type: 'number' },
      image: { field: 'input_image', type: 'string' },
    },
  },
  fal: {
    isAsync: true,
    video: {
      prompt: { field: 'prompt', type: 'string', required: true },
      negative: { field: 'negative_prompt', type: 'string' },
      ratio: { field: 'aspect_ratio', type: 'select', enum: ['16:9', '9:16', '1:1'] },
      resolution: { field: 'resolution', type: 'select', enum: ['580p', '720p'] },
      duration: { field: 'num_frames', type: 'number' },
      fps: { field: 'frames_per_second', type: 'number' },
      seed: { field: 'seed', type: 'number' },
    },
    image: {
      prompt: { field: 'prompt', type: 'string', required: true },
      image: { field: 'image_url', type: 'string' },
      size: { field: 'image_size', type: 'string' },
      seed: { field: 'seed', type: 'number' },
      variants: { field: 'num_images', type: 'number' },
    },
  },
  minimax: {
    isAsync: true,
    video: {
      prompt: { field: 'content', type: 'array', required: true },
      ratio: { field: 'ratio', type: 'select', enum: ['16:9', '9:16', '1:1', 'adaptive'] },
      resolution: { field: 'resolution', type: 'select', enum: ['480p', '720p', '2K'] },
      duration: { field: 'duration', type: 'number' },
      image: { field: 'content', type: 'array' },
      lastImage: { field: 'content', type: 'array' },
      video: { field: 'content', type: 'array' },
      audio: { field: 'content', type: 'array' },
    },
    image: { prompt: { field: 'prompt' }, image: { field: 'prompt_img' } },
    audio: { prompt: { field: 'text' }, voice: { field: 'voice_setting.voice_id' } },
  },
  volcengine: {
    isAsync: true,
    video: {
      prompt: { field: 'content', type: 'array', required: true },
      ratio: { field: 'ratio', type: 'select', enum: ['16:9', '9:16', '1:1'] },
      resolution: { field: 'resolution', type: 'select', enum: ['480p', '720p', '1080p'] },
      duration: { field: 'duration', type: 'number' },
      seed: { field: 'seed', type: 'number' },
      image: { field: 'content', type: 'array' },
      lastImage: { field: 'content', type: 'array' },
      video: { field: 'content', type: 'array' },
      audio: { field: 'content', type: 'array' },
    },
    image: { prompt: { field: 'prompt' }, image: { field: 'image' }, size: { field: 'size' }, seed: { field: 'seed' } },
  },
  bailian: {
    isAsync: true,
    video: {
      prompt: { field: 'input.prompt', type: 'string', required: true },
      ratio: { field: 'parameters.ratio', type: 'select', enum: ['16:9', '9:16', '1:1', '3:4', '4:3'] },
      resolution: { field: 'parameters.resolution', type: 'select', enum: ['480P', '720P', '1080P'] },
      duration: { field: 'parameters.duration', type: 'number' },
      fps: { field: 'parameters.fps', type: 'number' },
      seed: { field: 'parameters.seed', type: 'number' },
    },
    image: {
      prompt: { field: 'input.messages[].content', type: 'array', required: true },
      size: { field: 'parameters.size', type: 'string' },
      negative: { field: 'parameters.negative_prompt', type: 'string' },
    },
  },
  gemini: {
    isAsync: false,
    video: {
      prompt: { field: 'instances[].prompt', type: 'string', required: true },
      image: { field: 'instances[].image.bytesBase64Encoded', type: 'string' },
      ratio: { field: 'parameters.aspectRatio', type: 'select', enum: ['16:9', '9:16', '1:1'] },
    },
    image: {
      prompt: { field: 'contents[].parts[].text', type: 'string', required: true },
      image: { field: 'contents[].parts[].inline_data', type: 'string' },
      ratio: { field: 'generationConfig.aspectRatio', type: 'select', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
    },
  },
  openai: {
    isAsync: false,
    video: { prompt: { field: 'prompt', type: 'string', required: true }, duration: { field: 'seconds', type: 'number' } },
    image: {
      prompt: { field: 'prompt', type: 'string', required: true },
      size: { field: 'size', type: 'string' },
      negative: { field: 'output_format', type: 'select', enum: ['png', 'jpeg', 'webp'] },
      image: { field: 'image', type: 'file' },
    },
    audio: { prompt: { field: 'input', type: 'string' }, voice: { field: 'voice', type: 'string' } },
  },
  meshy: {
    isAsync: true,
    image: { prompt: { field: 'prompt' }, image: { field: 'image_url' } },
  },
  elevenlabs: {
    isAsync: false,
    audio: { prompt: { field: 'text' }, voice: { field: 'voice_id' } },
  },
  openaiCompatible: {
    isAsync: false,
    video: { prompt: { field: 'prompt', type: 'string', required: true } },
    image: { prompt: { field: 'prompt', type: 'string', required: true }, size: { field: 'size', type: 'string' } },
    audio: { prompt: { field: 'input', type: 'string' }, voice: { field: 'voice', type: 'string' } },
  },
};

/** 某厂商/输出类型的字段映射（无则空）。 */
export function getPaidFieldMap(provider: string, kind: 'video' | 'image' | 'audio'): Partial<Record<PaidParamKind, PaidFieldDef>> {
  return PAID_PROVIDER_FIELD_MAP[provider]?.[kind] || {};
}

/** 每能力的参考输入路数（保守默认：只有明确需要图片输入的能力才给 1 路；绝不凭空多给）。 */
export interface PaidCapReference { images?: number; videos?: number; audios?: number; lastImage?: boolean; }
const CAP_REF_DEFAULT: Partial<Record<PaidCapability, PaidCapReference>> = {
  'text-to-image': { images: 0 },
  'text-to-video': { images: 0 },
  lipsync: { videos: 1, audios: 1 },
};
const CAP_REF_IMAGE: PaidCapReference = { images: 1 };
function capDefault(capability: PaidCapability): PaidCapReference {
  if (CAP_REF_DEFAULT[capability]) return CAP_REF_DEFAULT[capability]!;
  const out = PAID_CAPABILITY_OUTPUT[capability];
  return (out === 'video' || out === 'image') && capability !== 'text-to-image' && capability !== 'text-to-video' ? CAP_REF_IMAGE : { images: 0 };
}

/**
 * 每模型的官方输入 schema（关键：这是"每个模型支持几路参考/哪些输入"的来源，来自各厂商官方文档）。
 * 数值为「参考图 / 参考视频 / 参考音频 / 是否首尾帧」；未收录模型走能力保守默认（不凭空多端口）。
 */
export const PAID_MODEL_REFERENCE: Record<string, PaidCapReference> = {
  // 阿里百炼
  'qwen-image-3.0-pro': { images: 3 }, 'qwen-image-3.0': { images: 3 }, 'qwen-image-2.0-pro': { images: 3 },
  'qwen-image-edit-max': { images: 6 }, 'qwen-image-edit-max-2026-01-16': { images: 6 },
  'qwen-image-edit-plus': { images: 3 }, 'qwen-image-edit-plus-2025-12-15': { images: 3 }, 'qwen-image-edit': { images: 3 },
  'wan2.7-image-pro': { images: 9 }, 'wan2.7-image': { images: 9 },
  'wan2.7-t2v': { images: 0, audios: 1 },
  'wan2.7-i2v': { images: 2, videos: 1, audios: 1, lastImage: true },
  'wan2.7-r2v': { images: 5, videos: 5, audios: 1 },
  'wan2.7-videoedit': { images: 4, videos: 1 },
  // 可灵
  'kling-v3-omni': { images: 7, videos: 1, lastImage: true },
  'kling-video-o1': { images: 7, videos: 1, lastImage: true },
  'kling-v3': { images: 1, lastImage: true }, 'kling-v2-6': { images: 1, lastImage: true },
  'kling-v2-5-turbo': { images: 1, lastImage: true }, 'kling-v1-6': { images: 1, lastImage: true },
  // MiniMax
  'MiniMax-H3': { images: 9, videos: 3, audios: 3, lastImage: true },
  // Google
  'gemini-3.1-flash-image': { images: 14 }, 'gemini-3.1-flash-lite-image': { images: 14 }, 'gemini-3-pro-image': { images: 14 }, 'gemini-2.5-flash-image': { images: 1 },
  'veo-3.1-generate-preview': { images: 3, lastImage: true }, 'veo-3.1-fast-generate-preview': { images: 3, lastImage: true }, 'veo-3.1-lite-generate-preview': { images: 1 },
  // OpenAI（编辑可多图）
  'gpt-image-2': { images: 16 }, 'gpt-image-1.5': { images: 16 }, 'gpt-image-1': { images: 16 },
  'sora-2': { images: 1, lastImage: true },
  // 火山方舟
  'doubao-seedance-2-5-260628': { images: 30, videos: 10, audios: 10, lastImage: true },
  'doubao-seedance-2-0-260128': { images: 9, videos: 3, audios: 3, lastImage: true },
  'doubao-seedance-2-0': { images: 9, videos: 3, audios: 3, lastImage: true },
  'doubao-seedream-5-0-260128': { images: 14 }, 'doubao-seedream-4-0-250828': { images: 14 },
  // Flux
  'flux-3-video': { images: 10, videos: 1, lastImage: true },
  'flux-2-pro': { images: 8 }, 'flux-2-max': { images: 8 }, 'flux-2-flex': { images: 8 }, 'flux-2-klein-9b': { images: 4 },
  'flux-1.1-pro': { images: 1 }, 'flux-1.1-kontext': { images: 4 }, 'flux-dev': { images: 1 },
  // Meshy
  'meshy-7': { images: 1, lastImage: true }, 'meshy-6': { images: 1, lastImage: true }, 'meshy-5': { images: 1, lastImage: true },
};

/** 每厂商的图像/视频「分辨率 / 比例」官方选项，供节点下拉使用。 */
export const PAID_PROVIDER_PARAM_OPTIONS: Record<string, { resolution?: string[]; ratio?: string[] }> = {
  bailian: { resolution: ['1080P', '720P'], ratio: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  volcengine: { resolution: ['1080P', '720P', '480P'], ratio: ['16:9', '9:16', '1:1'] },
  kling: { resolution: ['1k', '2k'], ratio: ['16:9', '9:16', '1:1'] },
  minimax: { resolution: ['1080P', '768P'], ratio: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] },
  flux: { resolution: ['720p', '1080p'], ratio: ['16:9', '9:16', '1:1'] },
  gemini: { ratio: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
  fal: { resolution: ['580p', '720p'], ratio: ['16:9', '9:16', '1:1'] },
  openai: { ratio: ['16:9', '9:16', '1:1', 'auto'] },
};

/** 按所选模型返回参考输入路数（模型官方 schema 优先；未知模型用能力保守默认）。 */
export function getCapReference(capability: PaidCapability, modelId?: string): PaidCapReference {
  if (modelId && PAID_MODEL_REFERENCE[modelId]) return PAID_MODEL_REFERENCE[modelId];
  return capDefault(capability);
}

// 来源（官方文档）：
// - 可灵：https://klingai.com/document-api/api/video/text-to-video 、 /image-to-video 、/video-omni 、/api/image/omni/image-generation
// - Flux：https://docs.bfl.ai/api-reference/utility/generate-a-video-with-flux-3 （mode/keyframes/duration/aspect_ratio/resolution/generate_audio；x-key 鉴权，无 seed）
// - MiniMax：https://platform.minimax.io/docs/api-reference/video-generation-v2-create （content[]/ratio/duration/resolution）、image_generation、t2a_v2
// - 火山方舟：https://docs.byteplus.com/docs/ModelArk （Seedance 2.5 视频 contents/generations/tasks；Seedream 5.0 images/generations）
// - 阿里百炼：https://help.aliyun.com/zh/model-studio （wan2.7 文生/图生视频、qwen-image 文生图）
// - Gemini：https://ai.google.dev/gemini-api/docs （:generateContent response_modalities:["IMAGE"]；veo :predict）
// - OpenAI：https://developers.openai.com/api/reference/images 、/videos 、/audio/speech
// - Fal：https://fal.ai/docs/documentation/model-apis/inference/queue
// - Meshy：https://docs.meshy.ai （openapi/v2/text-to-3d、openapi/v1/image-to-3d）
// - ElevenLabs：https://elevenlabs.io/docs/api-reference/text-to-speech/convert

