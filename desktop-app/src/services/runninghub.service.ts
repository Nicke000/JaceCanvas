import { useSettingsStore } from '@/stores/settingsStore';
import type { ResultItem } from '@/services/comfyui.service';

export type RunningHubMode = 'standard-model' | 'comfy-workflow';
export interface RunningHubTask { taskId: string; mode: RunningHubMode; raw?: any; }
export interface RunningHubWorkflowInput { nodeId: string; fieldName: string; fieldValue: string; }

function settings() { return useSettingsStore.getState().runningHub; }
function baseUrl() { return String(settings().baseUrl || 'https://www.runninghub.cn/openapi/v2').replace(/\/+$/, ''); }
function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${settings().apiKey}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function recordRunningHubDiagnostic(entry: Record<string, unknown>) {
  try { await (window as any).electronAPI?.logRenderError?.({ type: 'runninghub-request', ...entry }); } catch { /* diagnostics must never affect a generation */ }
}
async function request(url: string, init: RequestInit = {}): Promise<any> {
  const api = (window as any).electronAPI;
  if (api?.proxyFetch) {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const result = await api.proxyFetch({ url, method: init.method || 'GET', headers: init.headers || {}, body });
    const text = typeof result?.text === 'string' ? result.text : '';
    if (result?.ok === false) { await recordRunningHubDiagnostic({ url: url.replace(/\?.*$/, ''), method: init.method || 'GET', status: result.status, response: text.slice(0, 800) }); throw new Error(`RunningHub HTTP ${result.status}: ${text || result.error || '请求失败'}`); }
    const parsed = text ? JSON.parse(text) : {};
    await recordRunningHubDiagnostic({ url: url.replace(/\?.*$/, ''), method: init.method || 'GET', status: result?.status, response: JSON.stringify(parsed).slice(0, 800) });
    return parsed;
  }
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`RunningHub HTTP ${response.status}: ${text || '请求失败'}`);
  return text ? JSON.parse(text) : {};
}

function taskIdOf(data: any): string {
  // Official contract: top-level taskId; task_id is the only documented compatibility spelling.
  const id = data?.taskId || data?.task_id;
  if (!id) {
    const code = data?.errorCode ?? data?.code ?? data?.data?.code ?? '';
    const message = data?.errorMessage || data?.message || data?.msg || data?.data?.message || data?.data?.msg || '';
    if (code && message) {
      if (String(code) === '40310') throw new Error(`RunningHub：该模型在 CN 端点已下线，需到全球端（runninghub.ai）接入。请在 RunningHub 全球 API 控制台核对接入地址与鉴权，或改用仍在国内可用的模型。服务端说明：${String(message)}`);
      throw new Error(`RunningHub 服务端拒绝：code=${code}，${String(message)}`);
    }
    const detail = [code && `code=${code}`, message && String(message)].filter(Boolean).join(', ');
    throw new Error(`RunningHub 提交未返回 taskId${detail ? `（${detail}）` : ''}。请检查 API Key、模型 endpoint 和必填参数。原始响应：${JSON.stringify(data).slice(0, 500)}`);
  }
  return String(id);
}

/** 标准模型接口：不同模型的 endpoint 和 payload 由节点配置提供，不假设所有模型字段相同。 */
export async function createStandardTask(endpoint: string, payload: Record<string, unknown>): Promise<RunningHubTask> {
  if (!endpoint.trim()) throw new Error('标准模型模式必须填写模型接口路径');
  const url = `${baseUrl()}/${endpoint.replace(/^\/+/, '')}`;
  const data = await request(url, { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
  return { taskId: taskIdOf(data), mode: 'standard-model', raw: data };
}

/** Comfy 工作流接口：nodeInfoList 是 RunningHub 专用字段映射，不能套用标准模型 payload。 */
export async function createComfyWorkflowTask(_workflowId: string, _nodeInfoList: RunningHubWorkflowInput[], _workflow?: unknown): Promise<RunningHubTask> {
  // The current official developer-kit only defines registry-backed standard-model endpoints.
  // Do not submit to the former undocumented workflow endpoint.
  throw new Error('当前 RunningHub 官方开发合同未提供 Comfy 工作流提交 endpoint。请从 RunningHub 节点库添加“标准模型 API”节点后执行。');
}

export async function queryTask(task: RunningHubTask): Promise<{ state: 'pending' | 'success' | 'failed'; results: ResultItem[]; raw: any }> {
  const data = task.mode === 'standard-model'
    ? await request(`${baseUrl()}/query`, { method: 'POST', headers: headers(), body: JSON.stringify({ taskId: task.taskId }) })
    : await request(`https://www.runninghub.cn/task/openapi/outputs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: settings().apiKey, taskId: task.taskId }) });
  const status = String(data?.status || data?.data?.status || data?.taskStatus || data?.data?.taskStatus || '').toUpperCase();
  const failed = ['FAILED', 'CANCEL', 'ERROR'].includes(status);
  const success = ['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(status);
  const rawResults = data?.results || data?.data?.results || data?.data?.outputs || data?.outputs || [];
  const list = Array.isArray(rawResults) ? rawResults : rawResults && typeof rawResults === 'object' ? Object.values(rawResults) : [];
  const results: ResultItem[] = list.map((item: any) => {
    const value = item?.url || item?.outputUrl || item?.download_url || item?.downloadUrl || item?.text || item?.content || item?.output || item?.value || item || '';
    const url = String(value);
    const filename = item?.filename || item?.fileName;
    const outputType = String(item?.outputType || '').toLowerCase();
    const type: ResultItem['type'] = outputType === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : outputType === 'audio' || /\.(mp3|wav|m4a)(\?|$)/i.test(url) ? 'audio' : outputType === '3d' ? '3d' : outputType === 'text' || item?.text || item?.content ? 'text' : 'image';
    return { type, url, filename };
  }).filter(item => item.url);
  return { state: failed ? 'failed' : success ? 'success' : 'pending', results, raw: data };
}

function mediaKindForField(field: string, value: unknown, configured?: Record<string, string>): { type: 'image' | 'video' | 'audio'; mime: string; extension: string } | null {
  const configuredType = configured?.[field];
  const kind = configuredType || (/video|mp4|movie/i.test(field) ? 'video' : /audio|sound|music|mp3/i.test(field) ? 'audio' : /image|img|photo|mask|ref/i.test(field) ? 'image' : '');
  const candidates = Array.isArray(value) ? value : [value];
  const hasMediaValue = candidates.some(item => typeof item === 'string' && /^data:|^blob:|^file:|^https?:/i.test(item));
  if (!kind || !(/^(image|video|audio)$/.test(kind)) || !hasMediaValue) return null;
  const type = kind as 'image' | 'video' | 'audio';
  return { type, mime: type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/png', extension: type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png' };
}

/** 只在 RunningHub 提交前转换媒体字段，返回新对象，不修改画布中的原始 inputValues。 */
export async function prepareRunningHubInputs(inputValues: Record<string, unknown>, mediaFields?: Record<string, string>): Promise<Record<string, unknown>> {
  const converted: Record<string, unknown> = { ...inputValues };
  for (const [field, value] of Object.entries(inputValues)) {
    const media = mediaKindForField(field, value, mediaFields);
    if (!media) continue;
    if (Array.isArray(value)) {
      converted[field] = await Promise.all(value.map((item, index) => typeof item === 'string' ? uploadMediaToRunningHub(item, `${field}-${index + 1}.${media.extension}`, media.mime) : item));
      continue;
    }
    if (typeof value !== 'string') continue;
    const filename = `${field}.${media.extension}`;
    converted[field] = await uploadMediaToRunningHub(value, filename, media.mime);
  }
  return converted;
}

export async function uploadMediaToRunningHub(source: string, filename = 'input.bin', mime = 'application/octet-stream'): Promise<string> {
  const api = (window as any).electronAPI;
  if (!api?.loadMediaB64 || !api?.uploadFile) throw new Error('RunningHub 媒体上传需要 Electron 主进程支持');
  const loaded = await api.loadMediaB64({ url: source });
  if (!loaded?.b64) throw new Error('无法读取待上传媒体');
  const response = await api.uploadFile({ url: `${baseUrl()}/media/upload/binary`, b64: loaded.b64, filename, fieldName: 'file', mime, headers: headers(false) });
  const data = JSON.parse(response?.text || '{}');
  return String(data?.data?.download_url || data?.data?.url || data?.download_url || data?.url || '');
}

export async function waitRunningHubTask(task: RunningHubTask, onProgress: (message: string, percent?: number) => void, signal?: AbortSignal): Promise<ResultItem[]> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await queryTask(task);
    if (result.state === 'failed') throw new Error(`RunningHub 任务失败：${JSON.stringify(result.raw).slice(0, 400)}`);
    onProgress(`RunningHub ${result.state === 'success' ? '完成' : '处理中'} · ${task.mode}`, Math.min(95, 5 + attempt));
    if (result.state === 'success') return result.results;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('RunningHub 任务轮询超时');
}
