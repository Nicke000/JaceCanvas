import { useSettingsStore } from '@/stores/settingsStore';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  dataUrl?: string;
  url?: string;
  source?: 'local' | 'asset' | 'canvas' | 'history';
}
export interface ChatTurn { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>>; }

/** 通用模型拉取：适用于聊天 AI / 提示词 AI / 付费 API 等各种 OpenAI 兼容接口 */
export async function fetchModelsFromApi(provider: string, baseUrl: string, apiKey: string): Promise<string[]> {
  try {
    if (!baseUrl) return [];
    const root = baseUrl.replace(/\/+$/, '');
    let url = `${root}/models`;
    const headers: Record<string, string> = {};
    if (provider === 'gemini') {
      url = `${root}/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`;
      if (apiKey) headers['x-goog-api-key'] = apiKey;
    } else if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      url = `${root}/models`;
    } else if (provider === 'ollama') {
      url = `${root}/api/tags`;
    } else {
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (provider === 'ollama') {
      return (data.models || []).map((m: any) => String(m.name || m.model || '')).filter(Boolean);
    }
    if (provider === 'gemini') {
      return (data.models || []).map((m: any) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    }
    const items = Array.isArray(data) ? data : data.data || data.models || [];
    return items.map((item: any) => String(item.id || item.name || '').replace(/^models\//, '')).filter(Boolean);
  } catch { return []; }
}

function endpoint(provider: string, base: string, model: string) {
  const b = base.replace(/\/+$/, '');
  if (provider === 'gemini') return b.includes('/models/') ? b : `${b}${b.includes('/v1beta') || b.includes('/v1/') ? '' : '/v1beta'}/models/${encodeURIComponent(model)}:generateContent`;
  if (provider === 'ollama') return b.endsWith('/api/chat') ? b : `${b}/api/chat`;
  if (provider === 'anthropic') return b.endsWith('/messages') ? b : `${b}/messages`;
  return b.endsWith('/chat/completions') ? b : `${b}/chat/completions`;
}

function textFromDataUrl(dataUrl: string): string {
  try {
    const encoded = dataUrl.split(',')[1] || '';
    return decodeURIComponent(escape(atob(encoded))).slice(0, 30000);
  } catch { return ''; }
}

export function attachmentParts(attachments: ChatAttachment[]) {
  return attachments.filter(a => a.dataUrl || a.url).map(a => {
    const url = a.dataUrl || a.url || '';
    if (a.mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url } };
    const text = (/^(text\/|application\/(json|javascript|x-yaml|yaml|xml|sql|toml|pdf))/.test(a.mimeType) || /\.(md|txt|json|js|ts|py|yaml|yml|xml|toml|env|ini)$/i.test(a.name)) && a.dataUrl ? textFromDataUrl(a.dataUrl) : '';
    return { type: 'text', text: `附件：${a.name}（${a.mimeType}）${text ? `\n${text}` : `\n内容引用：${url}`}` };
  });
}

async function readResponseText(response: Response, onChunk?: (text: string) => void): Promise<{ text: string; raw: any }> {
  const contentType = response.headers.get('content-type') || '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    const data: any = await response.json().catch(() => ({}));
    const content = data.message?.content || data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.output_text || data.output?.[0]?.content?.[0]?.text;
    return { text: String(data.text || data.response || content || data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''), raw: data };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let raw: any = {};
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const value = line.replace(/^data:\s*/, '').trim();
      if (!value || value === '[DONE]') continue;
      try {
        const item = JSON.parse(value);
        raw = item;
        const part = item.choices?.[0]?.delta?.content || item.choices?.[0]?.message?.content || item.delta?.text || item.text || item.response || '';
        if (typeof part === 'string' && part) { text += part; onChunk?.(part); }
      } catch { /* ignore keep-alive/non-json SSE lines */ }
    }
  }
  return { text, raw };
}

export async function sendChat(
  message: string,
  attachments: ChatAttachment[],
  history: ChatTurn[],
  signal?: AbortSignal,
  overrides?: { model?: string; thinkingMode?: 'auto' | 'fast' | 'deep'; onChunk?: (text: string) => void; systemPrompt?: string; provider?: string; baseUrl?: string; apiKey?: string },
) {
  const s = useSettingsStore.getState();
  // 支持配置覆盖（DevAgent 独立 API 等）：overrides.provider/baseUrl/apiKey 优先于全局 chat 配置
  const provider = overrides?.provider || s.chatProvider;
  const baseUrl = overrides?.baseUrl || s.chatBaseUrl;
  const apiKey = overrides?.apiKey || s.chatApiKey;
  const model = overrides?.model || s.chatModel;
  const thinkingMode = overrides?.thinkingMode || s.chatThinkingMode;
  if (!apiKey && provider !== 'ollama') throw new Error('请先配置 AI API 密钥');
  const parts = [{ type: 'text', text: message }, ...attachmentParts(attachments)];
  const turns: ChatTurn[] = [...history];
  // 空消息（Agent 等由调用方全权构造 history 的场景）不追加空 user turn，避免部分 API 拒绝空 content
  if (message.trim() || attachments.length) turns.push({ role: 'user', content: parts });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (provider === 'gemini') { if (apiKey) headers['x-goog-api-key'] = apiKey; }
  else if (provider !== 'ollama') headers.Authorization = `Bearer ${apiKey}`;
  const body = provider === 'gemini'
    ? { contents: turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: typeof t.content === 'string' ? [{ text: t.content }] : t.content.map((part: any) => part.type === 'image_url' ? { inline_data: { mime_type: String(part.image_url?.url || '').match(/^data:([^;]+);/)?.[1] || 'image/png', data: String(part.image_url?.url || '').split(',')[1] } } : { text: String(part.text || '') }) })), systemInstruction: { parts: [{ text: overrides?.systemPrompt ?? s.chatSystemPrompt }] } }
    : provider === 'anthropic' ? { model, max_tokens: 4096, system: overrides?.systemPrompt ?? s.chatSystemPrompt, messages: turns }
    : provider === 'ollama' ? { model, stream: false, system: overrides?.systemPrompt ?? s.chatSystemPrompt, messages: turns }
    : (() => {
        // OpenAI 兼容端点：content 一律数组化（OpenAI 标准与 dashscope 均接受）；
        // dashscope compatible-mode 要求首条消息 role='user' 且不支持 system —— 把 system 合并进第一条 user 消息。
        const sys = overrides?.systemPrompt ?? s.chatSystemPrompt;
        const sysPart = { type: 'text' as const, text: sys };
        const norm = (c: any) => (typeof c === 'string' ? [{ type: 'text' as const, text: c }] : (c as Array<any>));
        const dash = /dashscope|maas\.aliyuncs/i.test(baseUrl || '');
        const messages = dash
          ? (turns[0]
              ? [{ role: 'user' as const, content: [sysPart, ...(Array.isArray(turns[0].content) ? turns[0].content : norm(turns[0].content))] }, ...turns.slice(1)]
              : [{ role: 'user' as const, content: [sysPart] }])
          : [{ role: 'system' as const, content: [sysPart] }, ...turns];
        return { model, messages, temperature: 0.7, ...(thinkingMode === 'deep' ? { reasoning_effort: 'high' } : thinkingMode === 'fast' ? { reasoning_effort: 'low' } : {}) };
      })();
  // SSE 不是所有 OpenAI 兼容网关都实现；默认走 JSON，避免全页面聊天在等待流结束时看似卡死。
  // 需要增量输出时可由调用方显式传入 onChunk，此时仍请求流式响应。
  const wantsStream = Boolean(overrides?.onChunk) && provider !== 'anthropic' && provider !== 'gemini';
  const requestBody = { ...body, ...(provider !== 'anthropic' && provider !== 'gemini' ? { stream: wantsStream } : {}) };
  const requestUrl = endpoint(provider, baseUrl, model);
  // 默认 60s 超时（外部 signal 如暂停节点 abort 与之合并；TimeoutError 走 error 分支）
  const timeoutSignal = AbortSignal.timeout(60000);
  const effSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify(requestBody), signal: effSignal });
  // 兼容声明 SSE 但实际返回 JSON、或返回空 SSE 的代理网关。普通 JSON 重试只发生一次。
  if (wantsStream && response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
    response = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify({ ...requestBody, stream: false }), signal: effSignal });
  }
  if (!response.ok) {
    const data: any = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || data.message || `聊天 AI 请求失败（HTTP ${response.status}）`);
  }
  const streamed = await readResponseText(response, overrides?.onChunk);
  const data: any = streamed.raw;
  const text = streamed.text || (s.chatProvider === 'gemini' ? data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') : s.chatProvider === 'anthropic' ? data.content?.map((p: any) => p.text || '').join('') : s.chatProvider === 'ollama' ? data.message?.content || data.response : data.choices?.[0]?.message?.content);
  if (typeof text !== 'string' || !text) throw new Error('聊天 AI 没有返回文本');
  return { text, raw: data };
}