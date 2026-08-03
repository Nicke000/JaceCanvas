/**
 * 付费 API 通用服务
 * 支持：可灵(Kling)、即梦(JiMeng)、通义万相(Tongyi)、智谱(CogView/CogVideo)、
 * MiniMax、百度文心、Runway、OpenAI(Sora/DALL-E)、Google(Veo/Imagen)、
 * Pika、Luma Dream Machine、Midjourney代理、Stability AI
 */
import { PAID_API_ADAPTERS } from '@/config/paidApiAdapters';

export interface PaidApiConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  region?: string;
  workspaceId?: string;
  /** 可选：第三方代理/自定义网关覆盖实际路由，避免盲目拼接 /v1。 */
  modelsPath?: string;
  imagePath?: string;
  videoPath?: string;
  taskPath?: string;
  capabilityPath?: string;
  authMode?: 'bearer' | 'x-api-key' | 'query-key' | 'none';
}
export interface PaidGenerationResult { url: string; type: 'image' | 'video'; taskId?: string; raw?: unknown; }

export type PaidCapability =
  | 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'
  | 'first-frame-to-image' | 'first-frame-to-video' | 'first-last-to-video' | 'image-upscale' | 'remove-background' | 'outpaint'
  | 'background-generation' | 'style-transfer' | 'reference-to-video'
  | 'motion-video' | 'video-swap' | 'video-edit' | 'dance-video'
  // 4.6.8 补齐：对口型（百炼 VideoRetalk）、可灵主体管理、可灵音色管理。
  | 'lipsync' | 'element-manage' | 'voice-manage';

export interface PaidCapabilityDefinition {
  label: string;
  description: string;
  input: 'text' | 'image' | 'first-last' | 'video' | 'image-video';
  output: 'image' | 'video';
  /** Based on the vendor directory/index reviewed for this release. */
  providers: string[];
}

/**
 * Capability-level catalog. A provider is only listed when the local vendor
 * index documents that capability; custom/gateway are intentionally opt-in
 * adapters because their actual routes are supplied by the user.
 */
export const PAID_CAPABILITIES: Record<PaidCapability, PaidCapabilityDefinition> = {
  'text-to-image': { label:'文生图', description:'根据文字生成图片', input:'text', output:'image', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','baidu','openai','google','midjourney','stability'] },
  'first-frame-to-image': { label:'首帧生图', description:'使用首帧参考图和提示词生成图片', input:'image', output:'image', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','openai','google','stability'] },
  'first-frame-to-video': { label:'首帧生视频', description:'使用首帧图片和提示词生成视频', input:'image', output:'video', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','runway','openai','google'] },
  'image-to-image': { label:'图生图 / 图片编辑', description:'根据参考图和指令生成或编辑图片', input:'image', output:'image', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','baidu','openai','google','midjourney','stability'] },
  'text-to-video': { label:'文生视频', description:'根据文字生成视频', input:'text', output:'video', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','runway','openai','google','pika','luma'] },
  'image-to-video': { label:'图生视频', description:'使用图片作为首帧或参考图生成视频', input:'image', output:'video', providers:['custom','gateway','kling','jimeng','tongyi','zhipu','minimax','runway','google','pika','luma','stability'] },
  'first-last-to-video': { label:'首尾帧生成视频', description:'同时提供首帧和尾帧，生成连续过渡视频', input:'first-last', output:'video', providers:['custom','gateway','kling','minimax','runway'] },
  'image-upscale': { label:'图片清晰 / 放大', description:'提升图片分辨率和细节清晰度', input:'image', output:'image', providers:['custom','gateway','stability'] },
  'remove-background': { label:'移除背景', description:'抠出主体并生成透明背景图片', input:'image', output:'image', providers:['custom','gateway','stability'] },
  outpaint: { label:'扩图', description:'向画布外扩展图片内容', input:'image', output:'image', providers:['custom','gateway','stability'] },
  'background-generation': { label:'图片背景生成', description:'按文字替换或生成图片背景', input:'image', output:'image', providers:['custom','gateway','stability','minimax'] },
  'style-transfer': { label:'风格重绘', description:'保留主体结构并转换视觉风格', input:'image', output:'image', providers:['custom','gateway','kling','jimeng','tongyi','minimax','stability'] },
  'reference-to-video': { label:'参考生视频', description:'使用主体或多模态参考素材生成视频', input:'image-video', output:'video', providers:['custom','gateway','minimax','runway','kling'] },
  'motion-video': { label:'图生动作', description:'将参考动作迁移到图片主体', input:'image-video', output:'video', providers:['custom','gateway','tongyi','minimax','kling'] },
  'video-swap': { label:'视频换人', description:'替换视频中的人物主体', input:'image-video', output:'video', providers:['custom','gateway','kling','runway'] },
  'video-edit': { label:'视频编辑', description:'根据文字或参考素材编辑已有视频', input:'video', output:'video', providers:['custom','gateway','minimax','runway','openai'] },
  'dance-video': { label:'图生舞蹈视频', description:'根据参考人物图和动作描述生成舞蹈视频', input:'image-video', output:'video', providers:['custom','gateway','tongyi','minimax','kling'] },
  // 4.6.8：对口型（阿里百炼 VideoRetalk / 可灵对口型），视频 + 音频输入。
  'lipsync': { label:'对口型 / 声动人像', description:'将音频人声对口到人物视频，生成口型替换视频', input:'video', output:'video', providers:['custom','gateway','tongyi'] },
  // 4.6.8：可灵主体 / 音色管理（在节点内直接创建、查询、删除，不进入生成队列）。
  'element-manage': { label:'主体管理', description:'创建、查询和删除可复用的人物/物体主体（可灵）', input:'image', output:'image', providers:['custom','gateway','kling'] },
  'voice-manage': { label:'音色管理', description:'创建、查询和删除自定义音色（可灵）', input:'image', output:'image', providers:['custom','gateway','kling'] },
};

export function supportsPaidCapability(provider: string, capability: PaidCapability): boolean {
  return PAID_CAPABILITIES[capability]?.providers.includes(normalizeProvider(provider)) ?? false;
}

function normalizeProvider(provider: string): string {
  if (provider === 'openai_paid') return 'openai';
  if (provider === 'google_paid') return 'google';
  return provider;
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function providerPath(provider: string, kind: 'models' | 'image' | 'video' | 'task', baseUrl: string): string {
  const hasVersion = /\/v\d+(?:beta)?$/i.test(baseUrl);
  const prefix = hasVersion ? '' : '/v1';
  if (kind === 'models') {
    if (provider === 'stability') return '/v1/engines/list';
    if (provider === 'google') return '/models';
    return `${prefix}/models`;
  }
  if (provider === 'gateway') return `${prefix}/${kind === 'task' ? 'task/query' : `${kind}/generate`}`;
  if (provider === 'openai') return kind === 'video' ? `${prefix}/videos` : `${prefix}/images/generations`;
  if (provider === 'google') return '/models';
  if (provider === 'kling') return kind === 'image' ? `${prefix}/images/generations` : kind === 'video' ? `${prefix}/videos/text2video` : `${prefix}/videos/image2video`;
  if (provider === 'tongyi') return kind === 'image' ? '/services/aigc/text-to-image/image-synthesis' : '/services/aigc/video-generation/video-synthesis';
  if (provider === 'stability') return kind === 'image' ? '/v2beta/stable-image/generate/core' : '/v2beta/image-to-video';
  if (provider === 'zhipu') return kind === 'image' ? `${prefix}/images/generations` : `${prefix}/videos/generations`;
  if (provider === 'minimax') return kind === 'image' ? `${prefix}/image_generation` : `${prefix}/video_generation`;
  return `${prefix}/${kind}/generate`;
}

function authHeaders(config: PaidApiConfig): Record<string, string> {
  if (config.authMode === 'none') return { 'Content-Type': 'application/json' };
  if (config.authMode === 'x-api-key') return { 'Content-Type': 'application/json', 'X-API-Key': config.apiKey };
  if (config.authMode === 'query-key') return { 'Content-Type': 'application/json' };
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` };
}

// ========== 提供商预设 ==========
export const PAID_PROVIDERS: Record<string, { label: string; description: string; defaultBaseUrl: string; models: string[]; supports: string[] }> = {
  custom: { label:'自定义接口', description:'按自定义路径和认证方式调用第三方图片/视频网关', defaultBaseUrl:'', models:[], supports:Object.keys(PAID_CAPABILITIES) },
  gateway: { label:'通用任务网关（文档模板）', description:'使用自定义路径调用任务型接口', defaultBaseUrl:'', models:[], supports:Object.keys(PAID_CAPABILITIES) },
  kling: { label:'快手·可灵', description:'国内综合体验最强，物理模拟真实且支持高分辨率长视频', defaultBaseUrl:'https://api.klingai.com/v1', models:['kling-v1','kling-v1.5','kling-v1.6'], supports:['text-to-image','text-to-video','image-to-video','image-to-image'] },
  jimeng: { label:'字节·即梦', description:'深度打通剪映生态，生成速度快且最懂中文互联网流行趋势', defaultBaseUrl:'https://ark.cn-beijing.volces.com/api/v3', models:['jimeng-2.0','jimeng-2.0-pro'], supports:['text-to-image','text-to-video','image-to-video','image-to-image'] },
  tongyi: { label:'阿里·通义万相', description:'图像、视频和 Wan2.2 Animate 动作迁移能力', defaultBaseUrl:'https://dashscope.aliyuncs.com/api/v1', models:['wan2.1-t2i-turbo','wan2.2-t2v-turbo','wanx-v1','wan2.2-animate'], supports:['text-to-image','text-to-video','image-to-video','image-to-image','motion-video'] },
  zhipu: { label:'智谱·清影', description:'指令跟随精准，长视频连贯性与逻辑推理能力优于纯视觉模型', defaultBaseUrl:'https://open.bigmodel.cn/api/paas/v4', models:['cogview-3-plus','cogvideox-flash','cogvideox-2b'], supports:['text-to-image','text-to-video','image-to-video'] },
  minimax: { label:'MiniMax·海螺AI', description:'人物微表情细腻自然，语音唇形同步能力业内领先', defaultBaseUrl:'https://api.minimax.chat/v1', models:['image-01','video-01','hailuo-02'], supports:['text-to-image','text-to-video'] },
  baidu: { label:'百度·文心/度加', description:'整合搜索与文库生态，擅长知识资讯类视频自动生成', defaultBaseUrl:'https://aip.baidubce.com', models:['ernie-vilg-v2','ernie-video-v1'], supports:['text-to-image','text-to-video','image-to-image'] },
  runway: { label:'Runway Gen-3', description:'业界最精细控制面板与电影级质感的专业创作者首选', defaultBaseUrl:'https://api.rev.ai', models:['gen3-alpha-turbo','gen3-alpha'], supports:['text-to-video','image-to-video'] },
  openai: { label:'OpenAI (Sora/DALL-E)', description:'长镜头叙事与场景变换逻辑性顶尖，行业风向标', defaultBaseUrl:'https://api.openai.com/v1', models:['dall-e-3','sora-turbo','gpt-image-1'], supports:['text-to-image','text-to-video','image-to-image'] },
  google: { label:'Google (Veo 3/Imagen)', description:'原生音视频同步生成，4K输出稳定且光影物理准确性极高', defaultBaseUrl:'https://generativelanguage.googleapis.com/v1beta', models:['imagen-3','veo-3.0-generate-preview'], supports:['text-to-image','text-to-video','image-to-video','image-to-image'] },
  pika: { label:'Pika Labs', description:'专注创意特效与局部修改，适合快速原型验证和社交媒体趣味内容', defaultBaseUrl:'https://api.pika.art/v1', models:['pika-2.0','pika-2.1'], supports:['text-to-video','image-to-video'] },
  luma: { label:'Luma Dream Machine', description:'3D空间理解力强，运镜符合真实摄像机物理规律', defaultBaseUrl:'https://api.lumalabs.ai/dream-machine/v1', models:['dream-machine','photon'], supports:['text-to-video','image-to-video'] },
  midjourney: { label:'Midjourney代理', description:'继承极致美学素养与艺术风格化程度无人能及，单帧画质天花板', defaultBaseUrl:'', models:['midjourney-v6','midjourney-v6.1','niji-6'], supports:['text-to-image','image-to-image'] },
  stability: { label:'Stability AI', description:'开源图像模型标杆，SDXL/SD3系列广泛应用于各类创作场景', defaultBaseUrl:'https://api.stability.ai/v2beta', models:['stable-diffusion-xl-1024-v1-0','sd3.5-large','stable-video-diffusion'], supports:['text-to-image','text-to-video','image-to-video','image-to-image'] },
};
// ========== 常用比例预设 ==========
export const ASPECT_RATIOS = [
  { label: '1:1 (1024×1024)', value: '1:1', w: 1024, h: 1024 },
  { label: '16:9 (1280×720)', value: '16:9', w: 1280, h: 720 },
  { label: '9:16 (720×1280)', value: '9:16', w: 720, h: 1280 },
  { label: '4:3 (1024×768)', value: '4:3', w: 1024, h: 768 },
  { label: '3:4 (768×1024)', value: '3:4', w: 768, h: 1024 },
  { label: '3:2 (1152×768)', value: '3:2', w: 1152, h: 768 },
  { label: '2:3 (768×1152)', value: '2:3', w: 768, h: 1152 },
  { label: '21:9 (1344×576)', value: '21:9', w: 1344, h: 576 },
];

// ========== 模型拉取（调用真实 API 或 OpenAI 兼容接口） ==========
export async function fetchPaidModels(provider: string, baseUrl: string, apiKey: string, overrides: Pick<PaidApiConfig, 'modelsPath' | 'authMode'> = {}): Promise<string[]> {
  try {
    const normalizedProvider = normalizeProvider(provider);
    const root = (baseUrl || PAID_PROVIDERS[normalizedProvider]?.defaultBaseUrl || '').replace(/\/+$/, '');
    if (!root || !apiKey) return [];
    // 不同提供商的模型列表接口不同
    let endpoint = '';
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (overrides.modelsPath) {
      endpoint = joinUrl(root, overrides.modelsPath);
    } else if (normalizedProvider === 'stability') {
      endpoint = joinUrl(root, providerPath(normalizedProvider, 'models', root));
    } else if (normalizedProvider === 'google') {
      endpoint = `${root}/models?key=${encodeURIComponent(apiKey)}`;
    } else if (normalizedProvider === 'kling') {
      endpoint = `${root}/models`;
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      // OpenAI 兼容接口
      endpoint = `${root}/models`;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (overrides.authMode === 'query-key' && !endpoint.includes('?')) endpoint += `?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, { headers });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.warn(`[fetchPaidModels] ${normalizedProvider} 认证失败: HTTP ${res.status}`);
        return [];
      }
      console.warn(`[fetchPaidModels] ${normalizedProvider} 请求失败: HTTP ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    // 处理不同返回格式
    const items = Array.isArray(data) ? data : data.data || data.models || [];
    const models = items.map((item: any) => String(item.id || item.name || '').replace(/^models\//, '')).filter(Boolean);
    return models;
  } catch (e) {
    console.warn(`[fetchPaidModels] ${provider} 拉取异常:`, e);
    return [];
  }
}

// ========== 测试连接（支持对象和参数两种调用方式） ==========
export async function testPaidConnection(
  providerOrConfig: string | PaidApiConfig,
  baseUrlArg?: string,
  apiKeyArg?: string
): Promise<{ ok: boolean; message: string }> {
  let provider: string, baseUrl: string, apiKey: string, expectedModel = '';
  let config: PaidApiConfig = { provider: '', baseUrl: '', apiKey: '', model: '' };
  if (typeof providerOrConfig === 'object' && providerOrConfig !== null) {
    config = providerOrConfig;
    provider = providerOrConfig.provider || '';
    baseUrl = providerOrConfig.baseUrl || '';
    apiKey = providerOrConfig.apiKey || '';
    expectedModel = providerOrConfig.model || '';
  } else {
    provider = providerOrConfig as string;
    baseUrl = baseUrlArg || '';
    apiKey = apiKeyArg || '';
    config = { provider, baseUrl, apiKey, model: '' };
  }
  provider = normalizeProvider(provider);
  try {
    baseUrl = baseUrl || PAID_PROVIDERS[provider]?.defaultBaseUrl || '';
    if (!baseUrl) return { ok: false, message: '请填写接口地址' };
    if (!apiKey) return { ok: false, message: '请填写 API 密钥' };
    const root = baseUrl.replace(/\/+$/, '');
    // 灏濊瘯鑾峰彇妯″瀷鍒楄〃鏉ラ獙璇佽繛鎺?
    let endpoint = config.modelsPath ? joinUrl(root, config.modelsPath) : joinUrl(root, providerPath(provider, 'models', root));
    const headers = authHeaders({ ...config, provider, baseUrl: root, apiKey });
    if (config.authMode === 'query-key' && !endpoint.includes('?')) endpoint += `?key=${encodeURIComponent(apiKey)}`;
    if (provider === 'google') {
      if (!config.modelsPath) endpoint = `${root}/models?key=${encodeURIComponent(apiKey)}`;
    } else if (provider === 'stability') {
      if (!config.modelsPath) endpoint = `${root}/engines/list`;
    }
    const res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: '❌ API密钥无效或已过期，请检查密钥是否正确。常见原因：\n• 密钥已过期或已撤销\n• 接口地址与密钥不匹配\n• 使用的密钥没有该接口的权限' };
    }
    if (res.status === 404) {
      return { ok: false, message: '⚠️ 接口地址不正确，服务器返回 404。请检查：\n• 接口地址是否完整（如 https://api.example.com/v1）\n• 该供应商是否使用此接口地址\n• 网络代理是否正常' };
    }
    if (!res.ok) {
      try {
        const errData = await res.json();
        const errMsg = errData.error?.message || errData.message || '';
        return { ok: false, message: `❌ 服务器返回错误 (HTTP ${res.status})：${errMsg.slice(0, 100)}` };
      } catch {
        return { ok: false, message: `❌ 服务器返回错误 (HTTP ${res.status})，响应格式异常` };
      }
    }
    const data: any = await res.json();
    const items = Array.isArray(data) ? data : data.data || data.models || [];
    const models = items.map((item: any) => String(item.id || item.name || '').replace(/^models\//, '')).filter(Boolean);
    if (expectedModel && models.length && !models.includes(expectedModel)) return { ok:false, message:`⚠️ 接口连接成功，但所选模型“${expectedModel}”不在该密钥返回的模型列表中。请重新拉取模型并选择。` };
    return { ok: true, message: `✅ 连接成功！${expectedModel ? `所选模型“${expectedModel}”可用。` : ''}可用 ${models.length} 个模型。` };
  } catch (error: any) {
    const msg = String(error.message || error);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('NetworkError') || msg.includes('net::ERR_')) {
      return { ok: false, message: '❌ 无法连接到接口地址，请检查：\n• 网络连接是否正常\n• 接口地址是否正确（注意 https:// 前缀）\n• 是否需要配置网络代理\n• 是否被防火墙阻止' };
    }
    if (msg.includes('aborted') || msg.includes('timeout')) {
      return { ok: false, message: '⏱️ 连接超时，请检查：\n• 接口地址是否可达\n• 网络延迟是否过高\n• 是否配置了正确的代理' };
    }
    if (msg.includes('DNS') || msg.includes('dns')) {
      return { ok: false, message: '🌐 DNS 解析失败，请检查域名是否正确或网络连接是否正常' };
    }
    return { ok: false, message: `❌ 连接失败: ${msg.slice(0, 120)}` };
  }
}

// ========== 轮询任务 ==========
async function pollTask(baseUrl: string, endpoint: string, config: PaidApiConfig, taskId?: string): Promise<PaidGenerationResult> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const useGatewayQuery = /task\/query/i.test(endpoint);
    const res = await fetch(url, {
      method: useGatewayQuery ? 'POST' : 'GET',
      headers: authHeaders(config),
      ...(useGatewayQuery ? { body: JSON.stringify({ task_id: taskId }) } : {}),
    });
    if (!res.ok) continue;
    const data = await res.json();
    const status = String(data.status || data.task_status || data.data?.task_status || data.output?.task_status || '').toUpperCase();
    if (['SUCCESS', 'SUCCEEDED', 'DONE', 'SUCCEED', 'COMPLETED', 'FINISHED'].includes(status)) {
      const url = normalizeMediaUrl(extractMediaUrl(data), baseUrl);
      if (!url) throw new Error('任务已完成，但接口没有返回媒体地址');
      return { url, type: /\.(mp4|mov|webm|mkv)(?:[?#]|$)/i.test(url) ? 'video' : 'image', raw: data };
    }
    if (['FAILED', 'ERROR', 'FAILURE', 'CANCELLED'].includes(status)) throw new Error(data.message || data.data?.task_status_msg || data.error?.message || '任务执行失败');
  }
  throw new Error('任务超时，请稍后查看结果');
}

function extractMediaUrl(data: any): string {
  const candidates = [
    data?.media_url, data?.output?.media_url, data?.output?.video_url, data?.output?.image_url,
    data?.output?.url, data?.output?.results?.[0]?.url, data?.data?.[0]?.url,
    data?.data?.[0]?.image_url, data?.video_url, data?.image_url, data?.url,
    data?.result?.url, data?.result?.media_url, data?.data?.task_result?.videos?.[0]?.url, data?.data?.task_result?.videos?.[0]?.watermark_url,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

function normalizeMediaUrl(url: string, baseUrl: string): string {
  if (!url || /^data:|^https?:\/\//i.test(url)) return url;
  try { return new URL(url, `${baseUrl.replace(/\/+$/, '')}/`).toString(); } catch { return url; }
}

// ========== 调用付费 API ==========
export async function callPaidApi(config: PaidApiConfig, params: {
  type: PaidCapability;
  prompt: string; negativePrompt?: string; imageUrl?: string; lastImageUrl?: string; videoUrl?: string; audioUrl?: string; templateId?: string; width?: number; height?: number; aspectRatio?: string; resolution?: number; duration?: number; frameRate?: number; seed?: number;
}): Promise<PaidGenerationResult> {
  const provider = normalizeProvider(config.provider);
  const p = PAID_PROVIDERS[provider] || (() => {
    const adapter = PAID_API_ADAPTERS[provider as keyof typeof PAID_API_ADAPTERS];
    return adapter ? { label: adapter.label, description: adapter.description, defaultBaseUrl: adapter.defaultBaseUrl, models: adapter.models.map(model => model.id), supports: adapter.capabilities } : undefined;
  })();
  if (!p) throw new Error(`不支持的提供商: ${config.provider}`);
  const baseUrl = (config.baseUrl || p.defaultBaseUrl).replace(/\/+$/, '');
  const apiKey = config.apiKey;
  if (!apiKey) throw new Error('请先配置 API 密钥');

  if (provider === 'kling') {
    return callKlingVideo(config, params);
  }
  if (provider === 'bailian') return callBailianNative(config, params);
  if (provider === 'minimax') return callMiniMaxNative(config, params);
  if (provider === 'gemini') return callGeminiNative(config, params);
  if (provider === 'openai') return callOpenAINative(config, params);
  if (provider === 'volcengine') return callVolcengineNative(config, params);

  const isVideo = PAID_CAPABILITIES[params.type]?.output === 'video';
  const headers: Record<string, string> = authHeaders(config);
  const body: Record<string, unknown> = {
    model: config.model || p.models[0],
    prompt: params.prompt,
    ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}),
    ...(params.imageUrl && (params.type === 'image-to-video' || params.type === 'image-to-image') ? { image: params.imageUrl } : {}),
    ...(params.imageUrl && !['text-to-image','text-to-video'].includes(params.type) ? { image_url: params.imageUrl } : {}),
    ...(params.lastImageUrl ? { last_frame: params.lastImageUrl, last_frame_url: params.lastImageUrl } : {}),
    ...(params.videoUrl ? { video: params.videoUrl, video_url: params.videoUrl } : {}),
    ...(params.audioUrl ? { audio: params.audioUrl, audio_url: params.audioUrl } : {}),
    ...(params.templateId ? { template_id: params.templateId, templateId: params.templateId } : {}),
    n: 1,
    ...(params.width ? { width: params.width } : {}),
    ...(params.height ? { height: params.height } : {}),
    ...(params.duration ? { duration: params.duration } : {}),
    ...(params.frameRate ? { fps: params.frameRate, frame_rate: params.frameRate } : {}),
    ...(params.seed != null && params.seed >= 0 ? { seed: params.seed } : {}),
    ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio, ar: params.aspectRatio } : {}),
  };

  if (provider === 'google') {
    const model = encodeURIComponent(config.model || p.models[0] || 'imagen-3');
    const endpoint = joinUrl(baseUrl, `/models/${model}:predict`);
    const googleBody = { instances: [{ prompt: params.prompt, ...(params.imageUrl ? { image: { bytesBase64Encoded: params.imageUrl.split(',')[1] || params.imageUrl } } : {}) }], parameters: { sampleCount: 1, aspectRatio: params.aspectRatio, width: params.width, height: params.height } };
    const googleResponse = await fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(googleBody) });
    if (!googleResponse.ok) throw new Error(`厂商 google 请求 ${endpoint} 失败（HTTP ${googleResponse.status}）`);
    const googleData = await googleResponse.json();
    const googleUrl = normalizeMediaUrl(extractMediaUrl(googleData), baseUrl);
    if (!googleUrl) throw new Error('厂商 google 已响应，但没有返回媒体地址');
    return { url: googleUrl, type: isVideo ? 'video' : 'image', raw: googleData };
  }
  // 网关使用 image_url/image_urls 和 ar；OpenAI/custom 保留 OpenAI 兼容字段。
  if (provider !== 'openai' && provider !== 'custom') {
    delete body.image;
    if (params.imageUrl) body.image_url = params.imageUrl;
    if (params.type === 'image-to-image') body.image_urls = [params.imageUrl];
    delete body.aspect_ratio;
  }
  const kind = isVideo ? 'video' : 'image';
  const endpoint = config.capabilityPath || (kind === 'video' ? (config.videoPath || providerPath(provider, 'video', baseUrl)) : (config.imagePath || providerPath(provider, 'image', baseUrl)));
  let requestUrl = joinUrl(baseUrl, endpoint);
  if (config.authMode === 'query-key' && !requestUrl.includes('?')) requestUrl += `?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`厂商 ${provider} 请求 ${requestUrl} 失败（HTTP ${res.status}）：${err.error?.message || err.message || '响应无错误详情'}`);
  }
  const data = await res.json();
  const taskId = data.task_id || data.taskId || data.id || data.data?.task_id;
  const immediateUrl = normalizeMediaUrl(extractMediaUrl(data), baseUrl);
  if (taskId && !immediateUrl) {
    const queryEndpoint = data.task_query_url || config.taskPath || providerPath(provider, 'task', baseUrl);
    return pollTask(baseUrl, queryEndpoint, config, taskId);
  }
  const url = immediateUrl;
  if (!url) throw new Error('接口已响应，但没有返回图片或视频地址');
  return { url, type: isVideo ? 'video' : 'image', taskId, raw: data };
}

type PaidCallParams = Parameters<typeof callPaidApi>[1];

async function readJsonResponse(response: Response, provider: string): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${provider} 接口失败（HTTP ${response.status}）：${data.message || data.error?.message || data.code || '未提供错误详情'}`);
  return data;
}

function firstMedia(data: any): string {
  return normalizeMediaUrl(extractMediaUrl(data) || data?.output?.choices?.[0]?.message?.content?.find((item: any) => item.image)?.image || data?.content?.url || '', '');
}

async function callBailianNative(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const isVideo = PAID_CAPABILITIES[params.type]?.output === 'video';
  const endpoint = isVideo ? '/api/v1/services/aigc/video-generation/video-synthesis' : '/api/v1/services/aigc/multimodal-generation/generation';
  const image = params.imageUrl ? [{ image: params.imageUrl }] : [];
  const content = [{ text: params.prompt }, ...image];
  const body: any = isVideo ? {
    model: config.model,
    input: { prompt: params.prompt, ...(params.imageUrl ? { img_url: params.imageUrl } : {}), ...(params.lastImageUrl ? { last_frame_url: params.lastImageUrl } : {}), ...(params.videoUrl ? { video_url: params.videoUrl } : {}), ...(params.audioUrl ? { audio_url: params.audioUrl } : {}) },
    parameters: { ...(params.resolution ? { resolution: `${params.resolution}P` } : {}), ...(params.aspectRatio ? { ratio: params.aspectRatio } : {}), ...(params.duration ? { duration: params.duration } : {}), ...(params.frameRate ? { fps: params.frameRate } : {}), ...(params.seed != null && params.seed >= 0 ? { seed: params.seed } : {}) },
  } : {
    model: config.model,
    input: { messages: [{ role: 'user', content }] },
    parameters: { prompt_extend: false, ...(params.width && params.height ? { size: `${params.width}*${params.height}` } : {}), ...(params.negativePrompt ? { negative_prompt: params.negativePrompt } : {}) },
  };
  const region = config.region || 'cn-beijing';
  const regionalBase = config.workspaceId && region !== 'custom'
    ? `https://${config.workspaceId}.${region}.maas.aliyuncs.com`
    : (config.baseUrl || 'https://dashscope.aliyuncs.com');
  const response = await fetch(joinUrl(regionalBase, endpoint), { method:'POST', headers:{...authHeaders(config), ...(isVideo ? {'X-DashScope-Async':'enable'} : {})}, body:JSON.stringify(body) });
  const data = await readJsonResponse(response, '阿里云百炼');
  const immediate = firstMedia(data);
  if (immediate) return { url: immediate, type: isVideo ? 'video' : 'image', raw:data };
  const taskId = data.output?.task_id || data.output?.taskId || data.task_id;
  if (!taskId) throw new Error('百炼响应中没有图片地址或 task_id');
  return pollTask(regionalBase, `/api/v1/tasks/${taskId}`, config, taskId);
}

async function callMiniMaxNative(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const content: any[] = [{ type:'text', text:params.prompt }];
  if (params.imageUrl) content.push({ type:'image_url', image_url:{url:params.imageUrl}, role:'first_frame' });
  if (params.lastImageUrl) content.push({ type:'image_url', image_url:{url:params.lastImageUrl}, role:'last_frame' });
  if (params.videoUrl) content.push({ type:'video_url', video_url:{url:params.videoUrl}, role:'reference_video' });
  if (params.audioUrl) content.push({ type:'audio_url', audio_url:{url:params.audioUrl}, role:'reference_audio' });
  const response = await fetch(joinUrl(config.baseUrl || 'https://api.minimaxi.com', '/v2/video_generation'), { method:'POST', headers:authHeaders(config), body:JSON.stringify({ model:config.model, content, ...(params.aspectRatio ? { ratio:params.aspectRatio } : {}) }) });
  const data = await readJsonResponse(response, 'MiniMax');
  const taskId = data.task_id || data.id || data.data?.task_id;
  if (!taskId) throw new Error('MiniMax 响应中没有 task_id');
  return pollTask(config.baseUrl || 'https://api.minimaxi.com', `/v2/query/video_generation/${taskId}`, config, taskId);
}

async function callGeminiNative(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const isVideo = PAID_CAPABILITIES[params.type]?.output === 'video';
  const endpoint = isVideo ? `/v1beta/models/${encodeURIComponent(config.model)}:predict` : `/v1beta/interactions`;
  const parts: any[] = [{ text:params.prompt }];
  if (params.imageUrl) parts.push({ inline_data:{ mime_type:'image/png', data:params.imageUrl.split(',')[1] || params.imageUrl } });
  const body = isVideo ? { instances:[{ prompt:params.prompt, ...(params.imageUrl ? { image:{bytesBase64Encoded:params.imageUrl.split(',')[1] || params.imageUrl} } : {}) }], parameters:{ aspectRatio:params.aspectRatio } } : { model:config.model, input:{parts} };
  let url=joinUrl(config.baseUrl || 'https://generativelanguage.googleapis.com', endpoint); if(!url.includes('?')) url += `?key=${encodeURIComponent(config.apiKey)}`;
  const data=await readJsonResponse(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),'Gemini');
  const media=firstMedia(data); if(!media) throw new Error('Gemini 响应中没有媒体地址'); return {url:media,type:isVideo?'video':'image',raw:data};
}

async function callOpenAINative(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const isVideo=PAID_CAPABILITIES[params.type]?.output==='video';
  const hasV1=/\/v1\/?$/i.test(config.baseUrl);
  const endpoint=isVideo?(hasV1?'/videos':'/v1/videos'):(hasV1?'/images/generations':'/v1/images/generations');
  const body:any={model:config.model,prompt:params.prompt,n:1}; if(params.imageUrl) body.image=params.imageUrl; if(params.width&&params.height) body.size=`${params.width}x${params.height}`;
  const data=await readJsonResponse(await fetch(joinUrl(config.baseUrl||'https://api.openai.com',endpoint),{method:'POST',headers:authHeaders(config),body:JSON.stringify(body)}),'OpenAI');
  const media=firstMedia(data); if(media) return {url:media,type:isVideo?'video':'image',raw:data}; const taskId=data.id; if(!taskId) throw new Error('OpenAI 响应中没有结果或任务 ID'); return pollTask(config.baseUrl||'https://api.openai.com',`/v1/videos/${taskId}`,config,taskId);
}

async function callVolcengineNative(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const contents:any[]=[{type:'text',text:params.prompt}]; if(params.imageUrl) contents.push({type:'image_url',image_url:{url:params.imageUrl}}); if(params.videoUrl) contents.push({type:'video_url',video_url:{url:params.videoUrl}}); if(params.audioUrl) contents.push({type:'audio_url',audio_url:{url:params.audioUrl}});
  const data=await readJsonResponse(await fetch(joinUrl(config.baseUrl||'https://ark.cn-beijing.volces.com/api/v3','/contents/generations/tasks'),{method:'POST',headers:authHeaders(config),body:JSON.stringify({model:config.model,content:contents})}),'火山方舟');
  const taskId=data.id||data.task_id||data.data?.task_id;if(!taskId)throw new Error('火山方舟响应中没有任务 ID');return pollTask(config.baseUrl||'https://ark.cn-beijing.volces.com/api/v3',`/contents/generations/tasks/${taskId}`,config,taskId);
}

async function callKlingVideo(config: PaidApiConfig, params: PaidCallParams): Promise<PaidGenerationResult> {
  const firstFrame = params.imageUrl ? { image_url: params.imageUrl } : {};
  const lastFrame = params.lastImageUrl ? { tail_image_url: params.lastImageUrl } : {};
  const endpoint = params.imageUrl || params.lastImageUrl ? '/v1/videos/image2video' : '/v1/videos/text2video';
  const data = await readJsonResponse(await fetch(joinUrl(config.baseUrl || 'https://api-beijing.klingai.com', endpoint), {
    method:'POST', headers:authHeaders(config), body:JSON.stringify({ model_name:config.model, prompt:params.prompt, ...firstFrame, ...lastFrame, ...(params.duration ? { duration:String(params.duration) } : {}), ...(params.aspectRatio ? { aspect_ratio:params.aspectRatio } : {}) }),
  }), '可灵');
  const taskId=data.data?.task_id||data.task_id;if(!taskId)throw new Error('可灵响应中没有 task_id');
  return pollTask(config.baseUrl||'https://api-beijing.klingai.com',`${endpoint}/${taskId}`,config,taskId);
}

// ========== 4.6.8 可灵主体 / 音色管理 ==========
export interface PaidManageRequest {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  kind: 'element' | 'voice';
  action: 'create' | 'list' | 'delete';
  name?: string;
  description?: string;
  /** 创建主体时为图片 URL，创建音色时为音频 URL。 */
  mediaUrl?: string;
  id?: string;
}
export interface PaidManageItem { id: string; name: string; preview?: string; }
export interface PaidManageResult { ok: boolean; message: string; items?: PaidManageItem[]; }

/**
 * 可灵主体 / 音色管理：创建、列表、删除。
 * 接口来自「付费api节点整理/视频.docx」：
 * - 主体：POST /v1/general/advanced-custom-elements、GET 同路径、POST /v1/general/delete-advanced-elements
 * - 音色：POST /v1/general/custom-voices、GET 同路径、POST /v1/general/delete-voices
 */
export async function callPaidManage(req: PaidManageRequest): Promise<PaidManageResult> {
  const base = (req.baseUrl || 'https://api-beijing.klingai.com').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` };
  const kindLabel = req.kind === 'element' ? '主体' : '音色';
  try {
    if (req.action === 'create') {
      const body = req.kind === 'element'
        ? { element_name: req.name || '', element_description: req.description || '', image_url: req.mediaUrl || '' }
        : { voice_name: req.name || '', voice_url: req.mediaUrl || '' };
      const res = await fetch(`${base}/v1/general/${req.kind === 'element' ? 'advanced-custom-elements' : 'custom-voices'}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const data = await readJsonResponse(res, '可灵');
      const id = data.data?.element_id || data.data?.voice_id || data.data?.id || data.element_id || data.voice_id || '';
      if (!id) throw new Error(`可灵未返回${kindLabel} ID`);
      return { ok: true, message: `已创建${kindLabel}：${req.name || ''}`, items: [{ id: String(id), name: String(req.name || '') }] };
    }
    if (req.action === 'list') {
      const res = await fetch(`${base}/v1/general/${req.kind === 'element' ? 'advanced-custom-elements' : 'custom-voices'}?pageNum=1&pageSize=50`, { method: 'GET', headers });
      const data = await readJsonResponse(res, '可灵');
      const list = data.data?.elements || data.data?.voices || data.data?.list || data.data?.items || [];
      const items: PaidManageItem[] = list.map((item: any) => ({
        id: String(item.element_id || item.voice_id || item.id || ''),
        name: String(item.element_name || item.voice_name || item.name || ''),
        preview: String(item.image_url || item.trial_url || item.cover_url || ''),
      })).filter((item: PaidManageItem) => item.id);
      return { ok: true, message: `共 ${items.length} 个${kindLabel}`, items };
    }
    if (req.action === 'delete') {
      const deletePath = req.kind === 'element' ? 'delete-advanced-elements' : 'delete-voices';
      const body = req.kind === 'element' ? { element_ids: [req.id] } : { voice_id: req.id };
      const res = await fetch(`${base}/v1/general/${deletePath}`, { method: 'POST', headers, body: JSON.stringify(body) });
      await readJsonResponse(res, '可灵');
      return { ok: true, message: `已删除${kindLabel}` };
    }
    return { ok: false, message: '未知操作' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
