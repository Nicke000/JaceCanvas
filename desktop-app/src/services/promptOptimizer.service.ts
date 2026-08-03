import { useSettingsStore } from '@/stores/settingsStore';

export type PromptAction = 'optimize' | 'translate';
export type PromptKind = 'image' | 'video' | 'image-to-video' | 'image-edit' | 'digital-human' | 'audio' | 'generic';

export const SYSTEM_PROMPTS: Record<PromptKind, string> = {
  image: '你是专业的文生图提示词优化师。请把用户输入优化为适合文生图模型的高质量提示词，补充主体、构图、镜头、光线、材质、风格和画质信息。保留用户意图，不要凭空改变主体。只输出最终提示词，不要解释。',
  video: '你是专业的文生视频提示词优化师。请把用户输入优化为适合文生视频模型的提示词，补充主体动作、镜头运动、时间连续性、环境、光线和风格。只输出最终提示词，不要解释。',
  'image-to-video': '你是专业的图生视频提示词优化师。输入图片会作为视频首帧或参考帧，请重点描述动作、表情、镜头运动、主体一致性和时间变化，不要重新描述不存在的主体。只输出最终提示词。',
  'image-edit': '你是专业的图像编辑提示词优化师。请将用户需求改写为清晰、可执行的图像编辑指令，明确要修改的对象、位置、变化和需要保持不变的内容。只输出最终提示词。',
  'digital-human': '你是专业的数字人和对口型提示词优化师。请明确人物身份、表情、口型、说话节奏、动作和镜头要求，保持人物外观一致。只输出最终提示词。',
  audio: '你是专业的音频和音乐生成提示词优化师。请明确声音类型、情绪、节奏、乐器、环境和时长。只输出最终提示词。',
  generic: '你是专业的 AI 提示词优化师。请保留用户意图，补充必要细节并输出可直接用于生成模型的提示词。只输出最终提示词。',
};

function endpoint(provider: string, base: string): string {
  const clean = base.replace(/\/+$/, '');
  if (provider === 'gemini') return clean.includes('/models/') ? clean : `${clean}/models`;
  if (provider === 'anthropic') return clean.endsWith('/messages') ? clean : `${clean}/messages`;
  if (provider === 'ollama') return clean.endsWith('/generate') ? clean : `${clean}/api/generate`;
  return clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
}

export function promptKindForNode(nodeType: string): PromptKind {
  if (/imageToImage|qwenImageEdit|fireRedEdit|refWashImage|refImageClear/i.test(nodeType)) return 'image-edit';
  if (/video|wan|ltx|motion|lipSync|joyAI|refImageToVideo/i.test(nodeType)) return 'image-to-video';
  if (/audio/i.test(nodeType)) return 'audio';
  if (/digital|lipSync|person/i.test(nodeType)) return 'digital-human';
  if (/image|qwen|zimage|krea|flux|sdxl|storyboard/i.test(nodeType)) return 'image';
  return 'generic';
}

export async function optimizePrompt(input: { text: string; action: PromptAction; kind: PromptKind; imageContext?: string[] }): Promise<string> {
  const s = useSettingsStore.getState();
  // 每次按钮点击都是全新任务：不读取、不保存、不复用任何上一轮对话。
  const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (!s.optimizerApiKey && s.optimizerProvider !== 'ollama') throw new Error('请先在设置中填写提示词 AI 的 API 密钥');
  const customPrompt = input.action === 'optimize' ? s.optimizerPromptOverrides?.[input.kind] : '';
  const systemPrompt = customPrompt?.trim() || SYSTEM_PROMPTS[input.kind];
  const task = input.action === 'translate' ? '请将下面提示词翻译成自然、适合生成模型使用的英文，只输出英文提示词。' : `${systemPrompt}\n注意：这是提示词优化任务，必须直接生成优化后的最终提示词，不要把任务转交给下游模型，也不要解释优化过程。`;
  const context = input.imageContext?.length ? `\n图片输入上下文：\n${input.imageContext.map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '';
  const user = `这是一次全新的独立任务（request_id: ${requestId}）。不要引用或假设任何历史对话、历史提示词或之前的回答。\n${task}${context}\n\n本次用户提示词：\n${input.text}`;
  const url = endpoint(s.optimizerProvider, s.optimizerBaseUrl);
  // 只使用标准请求头，避免跨域预检因自定义头被提供商拒绝；独立性通过本次请求体保证。
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.optimizerProvider === 'anthropic') { headers['x-api-key'] = s.optimizerApiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (s.optimizerProvider !== 'ollama' && s.optimizerApiKey) headers.Authorization = `Bearer ${s.optimizerApiKey}`;
  const imageUrls = (input.imageContext || []).filter(value => /^https?:\/\//i.test(value) || /^data:image\//i.test(value));
  const openAiContent = [{ type: 'text', text: user }, ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))];
  const body = s.optimizerProvider === 'gemini'
    ? { contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n${user}` }] }] }
    : s.optimizerProvider === 'anthropic'
      ? { model: s.optimizerModel, max_tokens: 1200, system: systemPrompt, messages: [{ role: 'user', content: user }] }
      : s.optimizerProvider === 'ollama'
      ? { model: s.optimizerModel, stream: false, prompt: user, system: SYSTEM_PROMPTS[input.kind], images: imageUrls.filter(url => /^data:image\//i.test(url)).map(url => url.split(',')[1]), options: { num_ctx: 4096 } }
        : { model: s.optimizerModel, temperature: 0.35, metadata: { ai_canvas_request_id: requestId, new_conversation: true }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: imageUrls.length ? openAiContent : user }] };
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.message || `提示词 AI 请求失败（HTTP ${response.status}）`);
  const result = s.optimizerProvider === 'gemini' ? data.candidates?.[0]?.content?.parts?.[0]?.text : s.optimizerProvider === 'anthropic' ? data.content?.[0]?.text : data.choices?.[0]?.message?.content || data.response;
  if (!result || typeof result !== 'string') throw new Error('提示词 AI 没有返回文本');
  return result.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
}