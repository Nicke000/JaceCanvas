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
    const res = await fetch(url, { headers });
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
  if (provider === 'gemini') return b.includes('/models/') ? b : `${b}/models/${encodeURIComponent(model)}:generateContent`;
  if (provider === 'ollama') return b.endsWith('/api/chat') ? b : `${b}/api/chat`;
  if (provider === 'anthropic') return b.endsWith('/messages') ? b : `${b}/messages`;
  return b.endsWith('/chat/completions') ? b : `${b}/chat/completions`;
}

function textFromDataUrl(dataUrl: string): string {
  try {
    const encoded = dataUrl.split(',')[1] || '';
    return decodeURIComponent(escape(atob(encoded))).slice(0, 12000);
  } catch { return ''; }
}

function attachmentParts(attachments: ChatAttachment[]) {
  return attachments.filter(a => a.dataUrl || a.url).map(a => {
    const url = a.dataUrl || a.url || '';
    if (a.mimeType.startsWith('image/')) return { type: 'image_url', image_url: { url } };
    const text = a.mimeType.startsWith('text/') && a.dataUrl ? textFromDataUrl(a.dataUrl) : '';
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
  overrides?: { model?: string; thinkingMode?: 'auto' | 'fast' | 'deep'; onChunk?: (text: string) => void },
) {
  const s = useSettingsStore.getState();
  const model = overrides?.model || s.chatModel;
  const thinkingMode = overrides?.thinkingMode || s.chatThinkingMode;
  if (!s.chatApiKey && s.chatProvider !== 'ollama') throw new Error('请先在设置中配置聊天 AI API 密钥');
  const parts = [{ type: 'text', text: message }, ...attachmentParts(attachments)];
  const turns: ChatTurn[] = [...history, { role: 'user', content: parts }];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.chatProvider === 'anthropic') { headers['x-api-key'] = s.chatApiKey; headers['anthropic-version'] = '2023-06-01'; }
  else if (s.chatProvider === 'gemini') { if (s.chatApiKey) headers['x-goog-api-key'] = s.chatApiKey; }
  else if (s.chatProvider !== 'ollama') headers.Authorization = `Bearer ${s.chatApiKey}`;
  const body = s.chatProvider === 'gemini'
    ? { contents: turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: typeof t.content === 'string' ? [{ text: t.content }] : t.content.map((part: any) => part.type === 'image_url' ? { inline_data: { mime_type: String(part.image_url?.url || '').match(/^data:([^;]+);/)?.[1] || 'image/png', data: String(part.image_url?.url || '').split(',')[1] } } : { text: String(part.text || '') }) })), systemInstruction: { parts: [{ text: s.chatSystemPrompt }] } }
    : s.chatProvider === 'anthropic' ? { model, max_tokens: 4096, system: s.chatSystemPrompt, messages: turns }
    : s.chatProvider === 'ollama' ? { model, stream: false, system: s.chatSystemPrompt, messages: turns }
    : { model, messages: [{ role: 'system', content: s.chatSystemPrompt }, ...turns], temperature: 0.7, ...(thinkingMode === 'deep' ? { reasoning_effort: 'high' } : thinkingMode === 'fast' ? { reasoning_effort: 'low' } : {}) };
  // SSE 不是所有 OpenAI 兼容网关都实现；默认走 JSON，避免全页面聊天在等待流结束时看似卡死。
  // 需要增量输出时可由调用方显式传入 onChunk，此时仍请求流式响应。
  const wantsStream = Boolean(overrides?.onChunk) && s.chatProvider !== 'anthropic' && s.chatProvider !== 'gemini';
  const requestBody = { ...body, ...(s.chatProvider !== 'anthropic' && s.chatProvider !== 'gemini' ? { stream: wantsStream } : {}) };
  const requestUrl = endpoint(s.chatProvider, s.chatBaseUrl, model);
  let response = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify(requestBody), signal });
  // 兼容声明 SSE 但实际返回 JSON、或返回空 SSE 的代理网关。普通 JSON 重试只发生一次。
  if (wantsStream && response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
    response = await fetch(requestUrl, { method: 'POST', headers, body: JSON.stringify({ ...requestBody, stream: false }), signal });
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