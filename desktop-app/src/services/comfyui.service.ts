import { useSettingsStore } from '@/stores/settingsStore';
import { WORKFLOW_PRESETS } from '@/config/workflowPresets';
import { getClientId } from '@/services/comfyui-ws.service';

export interface GenerateInput { workflow_id: string; input_values: Record<string, unknown>; client_id?: string; }
export interface GenerateResponse { prompt_id: string; success: boolean; error?: string; images?: { filename: string; base64: string }[]; [key: string]: unknown; }
export interface ResultItem { type: 'image' | 'video' | 'audio' | 'text'; url: string; filename?: string; }
export interface ResultResponse { success: boolean; data?: ResultItem[]; results?: ResultItem[]; error?: string; pending?: boolean; }
export interface WorkflowTemplate { id: string; name: string; description: string; workflow_id: string; defaultInputs: Record<string, unknown>; }

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: 'txt2img', name: 'Txt2Img', description: 'Nunchaku加速文生图', workflow_id: 'Z-image-Nunchaku\u52a0\u901f\u6587\u751f\u56fe',
    defaultInputs: { '93:text': '', '94:width': 768, '94:height': 1136, '94:batch_size': 1, '95:filename_prefix': 'ai-canvas', '99:seed': -1, '99:steps': 15, '99:cfg': 1.5 } },
  { id: 'img2img', name: 'Img2Img', description: 'Image to Image', workflow_id: 'img2img-workflow',
    defaultInputs: { prompt: '', strength: 0.7 } },
  { id: 'txt2video', name: 'Video', description: 'Text to Video', workflow_id: 'txt2video-workflow',
    defaultInputs: { prompt: '', duration: 5 } },
];

export function getApiBase(): string { return useSettingsStore.getState().baseUrl.replace(/\/+$/, ''); }
function getControlBases(): string[] {
  const base = getApiBase();
  return base ? [base] : [];
}
function hdrs(): Record<string, string> { const h: Record<string, string> = { 'Content-Type': 'application/json' }; const k = useSettingsStore.getState().apiKey; if (k) h['Authorization'] = 'Bearer ' + k; return h; }
async function controlRequest(path: string, init: RequestInit = {}, ms = 15000): Promise<any> {
  let last: unknown;
  for (const base of getControlBases().reverse()) {
    try {
      const r = await ftch(base + path, { ...init, headers: { ...hdrs(), ...(init.headers || {}) } }, ms);
      if (!r.ok) { last = new Error(`HTTP ${r.status}`); continue; }
      return readJson(r);
    } catch (error) { last = error; }
  }
  throw last instanceof Error ? last : new Error('无法连接主控接口');
}
function tms(): number { return useSettingsStore.getState().timeout; }
async function ftch(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  const abort = () => ctrl.abort(); opts.signal?.addEventListener('abort', abort, { once: true });
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); opts.signal?.removeEventListener('abort', abort); }
}

async function readJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) throw new Error(`API ${response.status} 返回了空响应`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`API ${response.status} 返回格式错误`); }
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '请求超时，请检查服务状态或增大超时时间';
  if (error instanceof TypeError) return '无法连接 API，请检查地址、网络和跨域设置';
  return error instanceof Error ? error.message : String(error);
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await ftch(getApiBase() + '/api/health', { headers: hdrs() }, 10000);
    const d = await readJson(r);
    return r.ok && d.status === 'ok' ? { ok: true, message: '服务运行正常' } : { ok: false, message: d.error || `HTTP ${r.status}` };
  } catch (e) {
    try {
      const r = await ftch(getApiBase() + '/system_stats', { headers: hdrs() }, 10000);
      return r.ok ? { ok: true, message: 'ComfyUI 服务运行正常' } : { ok: false, message: `HTTP ${r.status}` };
    } catch { return { ok: false, message: errorMessage(e) }; }
  }
}

export async function getModels(): Promise<string[]> {
  try { const r = await ftch(getApiBase() + '/api/gpu/info', { headers: hdrs() }, 10000); const d = await readJson(r); return d.gpuName ? [d.gpuName] : (d.gpus || []).map((g: any) => g.name); } catch {
    try { const d = await ftch(getApiBase() + '/system_stats', { headers: hdrs() }, 10000).then(readJson); return d.devices?.map((g: any) => g.name).filter(Boolean) || []; } catch { return []; }
  }
}

export async function uploadFile(file: File): Promise<string> {
  const fd = new FormData(); fd.append('file', file); fd.append('overwrite', 'true');
  const auth = hdrs(); delete auth['Content-Type'];
  const r = await ftch(getApiBase() + '/api/comfy/upload/file', { method: 'POST', headers: auth, body: fd }, Math.max(60000, tms()));
  const d = await readJson(r);
  if (!r.ok) throw new Error(d.error || `上传失败 (HTTP ${r.status})`);
  const name = d.name || d.filename || d.path;
  if (!name) throw new Error('上传成功，但 API 未返回文件名');
  return name;
}

const bridgedFileCache = new Map<string, Promise<string>>();

function extensionFor(type: string): string {
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  if (type === 'text') return 'txt';
  return 'png';
}

/** 将浏览器可访问的素材转存到 ComfyUI input，规避远程 URL/内网地址安全限制。 */
export async function bridgeMediaToInput(value: unknown, type: 'image'|'video'|'audio'|'text'): Promise<unknown> {
  if (typeof value !== 'string' || !value) return value;
  if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('data:') && !value.startsWith('blob:')) return value;
  const cacheKey = `${type}:${value}`;
  if (!bridgedFileCache.has(cacheKey)) {
    bridgedFileCache.set(cacheKey, (async () => {
      const response = await fetch(value);
      if (!response.ok) throw new Error(`无法读取上游${type}素材 (HTTP ${response.status})`);
      const blob = await response.blob();
      const rawName = decodeURIComponent(value.split('/').pop()?.split('?')[0] || `asset.${extensionFor(type)}`);
      const hasExt = /\.[a-z0-9]{2,5}$/i.test(rawName);
      const name = `ai-canvas-${Date.now()}-${Math.random().toString(36).slice(2,7)}-${hasExt ? rawName : `asset.${extensionFor(type)}`}`;
      return uploadFile(new File([blob], name, { type: blob.type || `${type}/*` }));
    })());
  }
  try { return await bridgedFileCache.get(cacheKey)!; }
  catch (error) { bridgedFileCache.delete(cacheKey); throw error; }
}

export interface ServerWorkflow { id: string; name: string; mtime?: string; run_count?: number; last_run_at?: string | null; last_prompt_id?: string; kind?: string; color?: string; pinned?: boolean; }
const WORKFLOW_CACHE_KEY = 'ai-canvas-server-workflows';

/** 将网页版导出的工作流目录导入桌面端。支持数组或 {workflows:[]} 格式。 */
export function importWorkflowDirectory(raw: unknown): ServerWorkflow[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).workflows) ? (raw as any).workflows : []);
  const normalized = list.filter((item: any) => item && typeof item.id === 'string').map((item: any) => ({
    id: item.id, name: item.name || item.id, mtime: item.mtime, run_count: item.run_count, kind: item.kind, color: item.color, pinned: item.pinned,
  }));
  localStorage.setItem(WORKFLOW_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function getCachedWorkflowDirectory(): ServerWorkflow[] {
  try { return importWorkflowDirectory(JSON.parse(localStorage.getItem(WORKFLOW_CACHE_KEY) || '[]')); } catch { return []; }
}
export interface RemoteWorkflowConfig {
  success: boolean;
  workflow_template: Record<string, any>;
  api_config: {
    enabledParams: Record<string, boolean>;
    formValues: Record<string, unknown>;
    customLabels: Record<string, string>;
  };
}

export async function fetchWorkflowConfig(workflowId: string): Promise<RemoteWorkflowConfig> {
  let r: Response | undefined;
  for (const base of getControlBases()) {
    r = await ftch(base + '/api/workflow/config/' + encodeURIComponent(workflowId), { headers: hdrs() }, 20000);
    if (r.ok) break;
  }
  if (!r) throw new Error('无法连接工作流配置接口');
  const data = await readJson<RemoteWorkflowConfig & { error?: string }>(r);
  if (!r.ok || !data.success) throw new Error(data.error || `无法读取工作流配置 (HTTP ${r.status})`);
  return data;
}

export interface PerformanceInfo {
  online: boolean;
  gpuName?: string;
  gpuAvailable?: boolean;
  comfyRunning: boolean;
  diskUsed?: number;
  diskTotal?: number;
  diskAvailable?: number;
  busy?: boolean;
  runningCount?: number;
  pendingCount?: number;
  gpuUsage?: number;
  gpuMemoryUsed?: number;
  gpuMemoryTotal?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  memoryPercent?: number;
  cpuUsage?: number;
  temperature?: number;
  sshError?: string;
  source?: 'ssh'|'http';
}

async function fetchSshPerformance(): Promise<PerformanceInfo|null> {
  const api=(window as any).electronAPI; if(!api?.sshPerformance)return null; const s=useSettingsStore.getState(); if(!s.sshHost||!s.sshUsername)return null; const password=s.sshPassword||await api.getSshPassword?.()||''; if(!password)throw new Error('SSH 密码为空，请在设置中保存密码'); return await api.sshPerformance({host:s.sshHost,port:s.sshPort,username:s.sshUsername,password}) as PerformanceInfo;
}

export interface ComfyControlStatus { running?: boolean; starting?: boolean; reason?: string; port?: number; url?: string; }
export async function getComfyControlStatus(): Promise<ComfyControlStatus> { return controlRequest('/api/comfy/status'); }
export async function startComfy(): Promise<any> { return controlRequest('/api/comfy/start', { method: 'POST', body: JSON.stringify({ useProxy: true, proxyType: 'network_turbo' }) }); }
export async function stopComfy(): Promise<any> { return controlRequest('/api/comfy/stop', { method: 'POST', body: '{}' }); }
export async function getComfyVersion(): Promise<any> { return controlRequest('/api/comfy/version'); }
export async function getComfyExternalUrl(): Promise<any> { return controlRequest('/api/comfy/external-url'); }
export async function autodlInstanceList(token: string): Promise<any> { return controlRequest('/api/concurrent/instance/list', { method: 'POST', body: JSON.stringify({ token, page_index: 1, page_size: 50 }) }); }
export async function autodlInstanceAction(token: string, instanceUuid: string, action: 'power_on'|'power_off'): Promise<any> { return controlRequest(`/api/concurrent/instance/${action}`, { method: 'POST', body: JSON.stringify({ token, instance_uuid: instanceUuid }) }); }

function finite(...values: unknown[]): number | undefined {
  for (const value of values) { if(value==null||value==='')continue;const n=Number(value); if(Number.isFinite(n))return n; }
}

function memoryGb(value: number | undefined): number | undefined {
  if(value==null)return undefined;
  if(value>1024*1024)return value/1024/1024/1024;
  if(value>1024)return value/1024;
  return value;
}

export async function fetchPerformanceInfo(): Promise<PerformanceInfo> {
  let sshError=''; let ssh:PerformanceInfo|null=null; try{ssh=await fetchSshPerformance()}catch(error){sshError=error instanceof Error?error.message:String(error)}
  if (ssh) return { ...ssh, comfyRunning:true, source:'ssh' };
  const [health, gpu, hardware, comfy, queue, systemStats, comfyQueue, disk] = await Promise.allSettled([
    controlRequest('/api/health?ts=' + Date.now()),
    controlRequest('/api/gpu/info?ts=' + Date.now()),
    controlRequest('/api/hardware/info?ts=' + Date.now()),
    controlRequest('/api/comfy/status?ts=' + Date.now()),
    controlRequest('/api/comfy/queue-status?ts=' + Date.now()),
    controlRequest('/system_stats?ts=' + Date.now()),
    controlRequest('/queue?ts=' + Date.now()),
    controlRequest('/api/disk/size'),
  ]);
  const gv: any = gpu.status === 'fulfilled' ? gpu.value : {};
  const hv: any = hardware.status === 'fulfilled' ? hardware.value : {};
  const cv: any = comfy.status === 'fulfilled' ? comfy.value : {};
  const qv: any = queue.status === 'fulfilled' ? queue.value : {};
  const sv: any = systemStats.status === 'fulfilled' ? systemStats.value : {};
  const cqv: any = comfyQueue.status === 'fulfilled' ? comfyQueue.value : {};
  const dv: any = disk.status === 'fulfilled' ? disk.value : {};
  const g=gv.gpus?.[0]||gv.gpu||gv.data?.gpus?.[0]||{};
  const device=sv.devices?.[0]||{};
  const gpuAvailable=(gv.hasGPU!==undefined?Boolean(gv.hasGPU):undefined) ?? (hv.gpu?.available!==undefined?Boolean(hv.gpu.available):undefined);
  // The documented panel exposes live system values in /system_stats;
  // hardware/info only contains identity and disk metadata.
  const memory=hv.memory||hv.mem||hv.ram||hv.system?.memory||sv.memory||{};
  const cpu=hv.cpu||hv.system?.cpu||{};
  const memoryTotal=memoryGb(finite(memory.total_gb,memory.total,memory.totalGB,hv.memory_total_gb,hv.memoryTotal,sv.system?.ram_total,sv.ram_total));
  const memoryFree=memoryGb(finite(memory.free_gb,memory.free,memory.freeGB,hv.memory_free_gb,hv.memoryFree,sv.system?.ram_free,sv.ram_free));
  const memoryUsed=memoryGb(finite(memory.used_gb,memory.used,memory.usedGB,hv.memory_used_gb,hv.memoryUsed)) ?? (memoryTotal!=null&&memoryFree!=null ? memoryTotal-memoryFree : undefined);
  const gpuTotal=finite(g.memory_total_mb,g.memoryTotalMB,g.memory_total,g.vram_total_mb) ?? (Number(device.vram_total)>0 ? Number(device.vram_total)/1024/1024 : undefined);
  const gpuFree=finite(g.memory_free_mb,g.memoryFreeMB,g.memory_free,g.vram_free_mb) ?? (Number(device.vram_free)>0 ? Number(device.vram_free)/1024/1024 : undefined);
  return {
    online: (health.status === 'fulfilled' && (health.value as any)?.status === 'ok') || systemStats.status === 'fulfilled', sshError:sshError||undefined,
    gpuName: gv.gpuName || g.name || hv.gpu?.name || device.name,
    gpuAvailable: gpuAvailable ?? (systemStats.status === 'fulfilled' ? true : undefined),
    comfyRunning: Boolean(cv.running ?? hv.process?.running ?? systemStats.status === 'fulfilled'),
    diskUsed: hv.disk?.used ?? dv.system?.used_gb, diskTotal: hv.disk?.total ?? dv.system?.total_gb, diskAvailable: hv.disk?.available ?? dv.system?.free_gb,
    busy: qv.busy ?? Boolean(cqv.queue_running?.length || cqv.queue_pending?.length), runningCount: qv.running_count ?? cqv.queue_running?.length, pendingCount: qv.pending_count ?? cqv.queue_pending?.length,
    gpuUsage: finite(g.utilization,g.utilization_gpu,g.gpu_utilization,g.usage_percent,gv.gpuUsage),
    gpuMemoryUsed: finite(g.memory_used_mb,g.memoryUsedMB,g.memory_used,g.vram_used_mb) ?? (gpuTotal!=null&&gpuFree!=null ? gpuTotal-gpuFree : undefined),
    gpuMemoryTotal: gpuTotal,
    memoryUsed, memoryTotal,
    memoryPercent: finite(memory.percent,memory.usage_percent,hv.memory_percent) ?? (memoryUsed!=null&&memoryTotal?Math.round(memoryUsed/memoryTotal*100):undefined),
    cpuUsage: finite(cpu.percent,cpu.usage_percent,cpu.usage,hv.cpu_percent,hv.cpuUsage),
    temperature: finite(g.temperature,g.temp,g.temperature_c,gv.temperature,hv.gpu?.temperature), source:'http',
  };
}
export async function fetchWorkflows(): Promise<ServerWorkflow[]> {
  for (const base of getControlBases()) {
    try {
      const r = await ftch(base + '/api/workflow/list', { headers: hdrs() }, 10000);
      if (!r.ok) continue;
      const d = await readJson<{ workflows?: ServerWorkflow[] }>(r);
      const server = (d.workflows || []) as ServerWorkflow[];
      if (server.length) { localStorage.setItem(WORKFLOW_CACHE_KEY, JSON.stringify(server)); return server; }
    } catch { /* try the next control-plane alias */ }
  }
  try { return getCachedWorkflowDirectory(); } catch { return []; }
}

export function getWorkflowPreset(wfId: string) { return WORKFLOW_PRESETS[wfId] || null; }

export async function generate(input: GenerateInput): Promise<GenerateResponse> {
  const payload = { ...input, client_id: input.client_id || getClientId() };
  const r = await ftch(getApiBase() + '/api/workflow/generate', { method: 'POST', headers: hdrs(), body: JSON.stringify(payload) }, tms());
  const data = await readJson<GenerateResponse>(r);
  if (!r.ok) {
    throw new Error(data.error || `任务提交失败 (HTTP ${r.status})`);
  }
  if (!data.success) throw new Error((data.error as string) || '生成任务提交失败');
  if (!data.prompt_id) throw new Error('任务已提交，但 API 未返回 prompt_id');
  return data;
}

/** 中断 ComfyUI 当前任务；本地 AbortController 只能停止轮询，不能停止远端执行。 */
export async function cancelComfyTask(promptId?: string): Promise<void> {
  const attempts: Array<Promise<unknown>> = [
    ftch(getApiBase() + '/interrupt', { method: 'POST', headers: hdrs(), body: JSON.stringify(promptId ? { prompt_id: promptId } : {}) }, 10000),
  ];
  if (getApiBase().includes('1069831-')) {
    attempts.push(controlRequest('/api/concurrent/mirror/interrupt', { method: 'POST', body: JSON.stringify({ mirror_url: getApiBase() }) }, 10000));
  }
  let last: unknown;
  for (const attempt of attempts) {
    try {
      const response = await attempt;
      if (response instanceof Response && !response.ok) throw new Error(`HTTP ${response.status}`);
      return;
    } catch (error) { last = error; }
  }
  throw last instanceof Error ? last : new Error('无法通知 ComfyUI 中断任务');
}

export async function pollResult(promptId: string, onProgress?: (msg: string, pct?: number) => void, interval = 2000, maxRetries?: number, signal?: AbortSignal): Promise<ResultResponse> {
  if (!promptId) throw new Error('缺少 prompt_id，无法查询任务结果');
  // 生成可能持续数小时。默认不设总时限；timeout 只约束单次 HTTP 请求。
  const retries = maxRetries == null ? Number.POSITIVE_INFINITY : Math.max(1, maxRetries);
  const startedAt = Date.now();
  for (let i = 0; i < retries; i++) {
    if (signal?.aborted) throw new DOMException('任务已暂停', 'AbortError');
    await new Promise(r => setTimeout(r, interval));
    if (signal?.aborted) throw new DOMException('任务已暂停', 'AbortError');
    const pct = Number.isFinite(retries) ? Math.min(99, Math.round(((i + 1) / retries) * 100)) : undefined;
    const elapsedMinutes = Math.floor((Date.now() - startedAt) / 60000);
    const waitingLabel = elapsedMinutes > 0 ? `正在生成 · 已等待 ${elapsedMinutes} 分钟` : '正在生成';
    try {
      const r = await ftch(getApiBase() + '/api/workflow/result?prompt_id=' + encodeURIComponent(promptId), { headers: hdrs(), signal }, 15000);
      if (!r.ok) { onProgress?.(`查询暂时失败 (HTTP ${r.status})，任务仍在等待`, pct); continue; }
      const data = await readJson(r);
      // 检查 results 字段（API 返回格式）
      const items = data.results || data.data;
      if (data.success && items && items.length > 0) {
        const results: ResultItem[] = [];
        for (const item of items) {
          const url = (item.url as string) || '';
          if (!url) continue;
          results.push({ type: item.type || 'image', url: url.startsWith('http') ? url : getApiBase() + (url.startsWith('/') ? url : '/' + url), filename: item.filename });
        }
        if (results.length > 0) return { success: true, data: results };
      }
      // 如果 pending=false 但无结果，说明已完成但未找到产物
      if (data.pending === false) throw new Error(`任务已结束: ${data.error || '没有生成可用结果'}`);
      if (data.pending === true) {
        onProgress?.(waitingLabel, pct);
        continue;
      }
      // 兼容旧端点
      const r2 = await ftch(getApiBase() + '/api/comfy/proxy/history?prompt_id=' + encodeURIComponent(promptId), { headers: hdrs() }, 15000);
      if (!r2.ok) continue;
      const hdata = await r2.json();
      if (hdata[promptId]) {
        const outputs = hdata[promptId].outputs; const results: ResultItem[] = [];
        for (const nodeId in outputs) {
          const no = outputs[nodeId];
          if (no.images) for (const img of no.images) results.push({ type: 'image', url: getApiBase() + '/api/comfy/view?filename=' + encodeURIComponent(img.filename) + '&type=' + (img.type || 'output') + '&subfolder=' + encodeURIComponent(img.subfolder || ''), filename: img.filename });
          if (no.gifs) for (const g of no.gifs) results.push({ type: 'video', url: getApiBase() + '/api/comfy/view?filename=' + encodeURIComponent(g.filename) + '&type=' + (g.type || 'output') + '&subfolder=' + encodeURIComponent(g.subfolder || ''), filename: g.filename });
        }
        if (results.length > 0) return { success: true, data: results };
      }
      onProgress?.(waitingLabel, pct);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new DOMException('任务已暂停', 'AbortError');
      if (error instanceof Error && error.message.includes('任务已结束')) throw error;
      onProgress?.(`连接波动，任务仍在等待${elapsedMinutes > 0 ? ` · ${elapsedMinutes} 分钟` : ''}`, pct);
    }
  }
  throw new Error('已达到指定的查询次数，任务可能仍在执行');
}

const TPL_KEY = 'ai-canvas-templates';
export function loadTemplates(): WorkflowTemplate[] { try { const r = localStorage.getItem(TPL_KEY); return r ? JSON.parse(r) : [...WORKFLOW_TEMPLATES]; } catch { return [...WORKFLOW_TEMPLATES]; } }
export function saveTemplates(ts: WorkflowTemplate[]) { localStorage.setItem(TPL_KEY, JSON.stringify(ts)); }
export function exportTemplate(t: WorkflowTemplate): string { return JSON.stringify(t, null, 2); }
export function importTemplate(json: string): WorkflowTemplate { const t = JSON.parse(json); if (!t.id || !t.name) throw new Error('Bad template'); return t; }
