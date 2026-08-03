/**
 * 阿里云百炼 z-image-turbo 文生图测试接口。
 *
 * 该接口与通用付费 API 的请求协议不同：它使用
 * /api/v1/services/aigc/multimodal-generation/generation，
 * 请求体为 input.messages，响应中的图片位于 output.choices[].message.content[].image。
 */

export type BailianRegion = 'cn-beijing' | 'ap-southeast-1' | 'custom';

export interface BailianTextToImageConfig {
  apiKey: string;
  region: BailianRegion;
  workspaceId?: string;
  /** 自定义完整 Base URL，例如 https://xxx.<region>.maas.aliyuncs.com */
  baseUrl?: string;
}

export const BAILIAN_REGION_OPTIONS: Array<{ label: string; value: BailianRegion }> = [
  { label: '华北 2（北京）', value: 'cn-beijing' },
  { label: '新加坡', value: 'ap-southeast-1' },
  { label: '其他地域（自定义地址）', value: 'custom' },
];

export const BAILIAN_RESOLUTION_OPTIONS = [
  { label: '1024 像素档', value: 1024 },
  { label: '1280 像素档', value: 1280 },
  { label: '1536 像素档', value: 1536 },
] as const;

export type BailianResolution = (typeof BAILIAN_RESOLUTION_OPTIONS)[number]['value'];

export const BAILIAN_RATIO_OPTIONS = [
  { label: '1:1', value: '1:1' },
  { label: '2:3', value: '2:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '7:9', value: '7:9' },
  { label: '9:7', value: '9:7' },
  { label: '9:16', value: '9:16' },
  { label: '9:21', value: '9:21' },
  { label: '16:9', value: '16:9' },
  { label: '21:9', value: '21:9' },
] as const;

/** 百炼视频文档明确支持的 ratio 参数。 */
export const BAILIAN_VIDEO_RATIO_OPTIONS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
] as const;

export const BAILIAN_VIDEO_RESOLUTION_OPTIONS = [720, 1080] as const;

const SIZE_TABLE: Record<number, Record<string, string>> = {
  1024: {
    '1:1': '1024*1024', '2:3': '832*1248', '3:2': '1248*832',
    '3:4': '864*1152', '4:3': '1152*864', '7:9': '896*1152',
    '9:7': '1152*896', '9:16': '720*1280', '9:21': '576*1344',
    '16:9': '1280*720', '21:9': '1344*576',
  },
  1280: {
    '1:1': '1280*1280', '2:3': '1024*1536', '3:2': '1536*1024',
    '3:4': '1104*1472', '4:3': '1472*1104', '7:9': '1120*1440',
    '9:7': '1440*1120', '9:16': '864*1536', '9:21': '720*1680',
    '16:9': '1536*864', '21:9': '1680*720',
  },
  1536: {
    '1:1': '1536*1536', '2:3': '1248*1872', '3:2': '1872*1248',
    '3:4': '1296*1728', '4:3': '1728*1296', '7:9': '1344*1728',
    '9:7': '1728*1344', '9:16': '1152*2048', '9:21': '864*2016',
    '16:9': '2048*1152', '21:9': '2016*864',
  },
};

export function getBailianImageSize(resolution: number, ratio: string): string {
  const normalizedResolution = BAILIAN_RESOLUTION_OPTIONS.some(item => item.value === resolution) ? resolution : 1024;
  return SIZE_TABLE[normalizedResolution][ratio] || SIZE_TABLE[normalizedResolution]['1:1'];
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getDefaultBaseUrl(region: BailianRegion, workspaceId: string): string {
  if (region === 'custom') return '';
  if (workspaceId) return `https://${workspaceId}.${region}.maas.aliyuncs.com`;
  return region === 'ap-southeast-1'
    ? 'https://dashscope-intl.aliyuncs.com'
    : 'https://dashscope.aliyuncs.com';
}

export function getBailianTextToImageUrl(config: BailianTextToImageConfig): string {
  const workspaceId = String(config.workspaceId || '').trim();
  const baseUrl = normalizeBaseUrl(config.baseUrl || getDefaultBaseUrl(config.region, workspaceId));
  if (!baseUrl) throw new Error('请填写云百炼自定义 Base URL');
  return `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`;
}

function extractImageUrl(data: any): string {
  const content = data?.output?.choices?.[0]?.message?.content;
  const contentItems = Array.isArray(content) ? content : [];
  const choicesImage = contentItems.find((item: any) => typeof item?.image === 'string' && item.image.trim())?.image;
  const fallbackCandidates = [
    data?.output?.results?.[0]?.url,
    data?.output?.results?.[0]?.image,
    data?.output?.image_url,
    data?.image_url,
    data?.url,
  ];
  return String(choicesImage || fallbackCandidates.find(value => typeof value === 'string' && value.trim()) || '').trim();
}

export async function callBailianTextToImage(
  config: BailianTextToImageConfig,
  params: { prompt: string; ratio: string; resolution: number; seed?: number },
  signal?: AbortSignal,
): Promise<{ url: string; raw: unknown }> {
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) throw new Error('请先在设置 → 文生图中填写 API Key');
  const prompt = String(params.prompt || '').trim();
  if (!prompt) throw new Error('请输入提示词，或连接文本节点到提示词输入端口');

  const body: Record<string, unknown> = {
    model: 'z-image-turbo',
    input: {
      messages: [{ role: 'user', content: [{ text: prompt }] }],
    },
    parameters: {
      prompt_extend: false,
      size: getBailianImageSize(params.resolution, params.ratio),
    },
  };
  const seed = Number(params.seed);
  if (Number.isInteger(seed) && seed >= 0 && seed <= 2147483647) {
    (body.parameters as Record<string, unknown>).seed = seed;
  }

  const response = await fetch(getBailianTextToImageUrl(config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.message || data?.error?.message || data?.code || `HTTP ${response.status}`;
    throw new Error(`云百炼 z-image-turbo 请求失败（${response.status}）：${String(detail).slice(0, 240)}`);
  }
  const url = extractImageUrl(data);
  if (!url) throw new Error('云百炼请求成功，但响应中没有找到图片地址');
  return { url, raw: data };
}