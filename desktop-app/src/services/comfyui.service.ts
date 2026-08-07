import { useSettingsStore } from '@/stores/settingsStore';
import { WORKFLOW_PRESETS } from '@/config/workflowPresets';
import { getClientId } from '@/services/comfyui-ws.service';

export interface GenerateInput { workflow_id: string; input_values: Record<string, unknown>; client_id?: string; }
export interface GenerateResponse { prompt_id: string; success: boolean; error?: string; images?: { filename: string; base64: string }[]; [key: string]: unknown; }
export interface ResultItem { type: 'image' | 'video' | 'audio' | 'text' | '3d'; url: string; filename?: string; }
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

export interface ActiveServer { id: string; name: string; baseUrl: string; apiKey: string; perfUrl?: string; }

/** 当前生效的服务器：优先 serverId 指定的服务器，其次多服务器列表的 activeServer，最后回退旧版单地址 baseUrl。 */
export function getActiveServer(serverId?: string): ActiveServer | null {
  const state = useSettingsStore.getState();
  if (serverId && state.servers && state.servers.length) {
    return state.servers.find(item => item.id === serverId) || null;
  }
  if (state.servers && state.servers.length) {
    return state.servers.find(item => item.id === state.activeServerId) || state.servers[0] || null;
  }
  return state.baseUrl ? { id: 'default', name: '主服务器', baseUrl: state.baseUrl, apiKey: state.apiKey } : null;
}

export function getApiBase(serverId?: string): string {
  const raw = (getActiveServer(serverId)?.baseUrl || '').replace(/\/+$/, '');
  // 自动补协议：用户填 127.0.0.1:8188 / localhost:8188 等也按 http 处理
  return raw && !/^https?:\/\//i.test(raw) ? 'http://' + raw : raw;
}
function getControlBases(): string[] {
  // 性能检测：主控服务器优先用 perfUrl（节点地址 baseUrl 可能不含控制端点）；未配 perfUrl 时回退 baseUrl
  const active = getActiveServer();
  const bases: string[] = [];
  if (active?.perfUrl) bases.push(active.perfUrl.replace(/\/+$/, ''));
  const base = getApiBase();
  if (base && bases.every(b => b !== base)) bases.push(base);
  return bases;
}
function hdrs(serverId?: string): Record<string, string> { const h: Record<string, string> = { 'Content-Type': 'application/json' }; const k = getActiveServer(serverId)?.apiKey || useSettingsStore.getState().apiKey; if (k) h['Authorization'] = 'Bearer ' + k; return h; }
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
  const native = async (): Promise<Response> => fetch(url, { ...opts, signal: ctrl.signal });
  const proxy = (window as any).electronAPI?.proxyFetch;
  if (proxy) {
    try {
      // 主进程代理：规避 ComfyUI 未开 CORS 时渲染进程 fetch 被拦
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
      const result = await proxy({ url, method: opts.method || 'GET', headers: (opts.headers || {}) as any, body: body !== undefined ? body : undefined });
      // 主进程直接返回 utf-8 text（渲染进程可能没有 Buffer，不能用 Buffer.from(b64)）
      let text: string;
      if (typeof result.text === 'string') text = result.text;
      else if (typeof Buffer !== 'undefined') text = Buffer.from(result.b64, 'base64').toString('utf-8');
      else {
        const bin = atob(result.b64);
        text = decodeURIComponent(Array.from(bin, c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      }
      clearTimeout(t); opts.signal?.removeEventListener('abort', abort);
      return { ok: true, status: 200, text: async () => text, headers: new Headers({ 'content-type': result.mime || 'application/json' }) } as unknown as Response;
    } catch (e: any) {
      // 代理失败（网络/HTTP 错误）：回退原生 fetch 再试（覆盖代理环境问题）
      try { return await native(); }
      catch {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, status: 400, text: async () => JSON.stringify({ error: msg }), headers: new Headers() } as unknown as Response;
      }
    }
  }
  try { return await native(); }
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

export async function testConnection(serverId?: string, baseUrlOverride?: string): Promise<{ ok: boolean; message: string }> {
  const baseRaw = (baseUrlOverride || getApiBase(serverId)).replace(/\/+$/, '');
  const base = baseRaw && !/^https?:\/\//i.test(baseRaw) ? 'http://' + baseRaw : baseRaw; // override 同样自动补协议
  // 健康检查 /api/health 只对主控类服务存在；ComfyUI 直连没有此端点（404 是常态），
  // 任何非 2xx 或异常都必须回退 /system_stats，否则所有 ComfyUI 直连都会误报"连接失败"。
  const tryHealth = async (): Promise<{ ok: boolean; message: string } | null> => {
    const r = await ftch(base + '/api/health', { headers: hdrs(serverId) }, 10000);
    if (!r.ok) return null;
    const d = await readJson(r);
    return d.status === 'ok' ? { ok: true, message: '服务运行正常' } : { ok: false, message: d.error || `HTTP ${r.status}` };
  };
  const tryStats = async (): Promise<{ ok: boolean; message: string }> => {
    const r = await ftch(base + '/system_stats', { headers: hdrs(serverId) }, 10000);
    return r.ok ? { ok: true, message: 'ComfyUI 服务运行正常' } : { ok: false, message: `HTTP ${r.status}` };
  };
  try { const h = await tryHealth(); if (h) return h; } catch { /* 网络层异常 → 走 stats 兜底 */ }
  try { return await tryStats(); } catch (e) { return { ok: false, message: errorMessage(e) }; }
}

export async function getModels(serverId?: string): Promise<string[]> {
  try { const r = await ftch(getApiBase(serverId) + '/api/gpu/info', { headers: hdrs(serverId) }, 10000); const d = await readJson(r); return d.gpuName ? [d.gpuName] : (d.gpus || []).map((g: any) => g.name); } catch {
    try { const d = await ftch(getApiBase(serverId) + '/system_stats', { headers: hdrs(serverId) }, 10000).then(readJson); return d.devices?.map((g: any) => g.name).filter(Boolean) || []; } catch { return []; }
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
    if (bridgedFileCache.size > 200) bridgedFileCache.clear(); // 上限 200 条，防无界膨胀
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
function workflowCacheKey(serverId?: string) { return serverId ? `${WORKFLOW_CACHE_KEY}:${serverId}` : WORKFLOW_CACHE_KEY; }
function normalizeWorkflows(raw: unknown): ServerWorkflow[] {
  const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && Array.isArray((raw as any).workflows) ? (raw as any).workflows : []);
  return list.filter((item: any) => item && typeof item.id === 'string').map((item: any) => ({
    id: item.id, name: item.name || item.id, mtime: item.mtime, run_count: item.run_count, kind: item.kind, color: item.color, pinned: item.pinned,
  }));
}

/** 将网页版导出的工作流目录导入桌面端。支持数组或 {workflows:[]} 格式。 */
export function importWorkflowDirectory(raw: unknown): ServerWorkflow[] {
  const normalized = normalizeWorkflows(raw);
  localStorage.setItem(WORKFLOW_CACHE_KEY, JSON.stringify(normalized));
  return normalized;
}

/** 按服务器读缓存（无该服务器缓存时回退全局手动导入目录），避免服务器间目录串台。 */
export function getCachedWorkflowDirectory(serverId?: string): ServerWorkflow[] {
  try {
    // 只读本服务器自己的缓存——不允许跨服务器回退，否则非主控/直连会显示别台服务器的工作流
    const raw = localStorage.getItem(workflowCacheKey(serverId)) || '[]';
    return normalizeWorkflows(JSON.parse(raw));
  } catch { return []; }
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
  const api=(window as any).electronAPI; if(!api?.sshPerformance)return null; const s=useSettingsStore.getState(); if(!s.sshHost||!s.sshUsername)return null;
  // ssh 配置只对主机匹配的服务器生效（避免切到本地/其他服务器时还显示填了 ssh 那台的性能）
  const active = getActiveServer();
  const host = active?.baseUrl ? (() => { try { return new URL(active.baseUrl).hostname; } catch { return ''; } })() : '';
  if (host && s.sshHost && host !== s.sshHost && !s.sshHost.includes(host) && !host.includes(s.sshHost)) return null;
  const password=s.sshPassword||await api.getSshPassword?.()||''; if(!password)throw new Error('SSH 密码为空，请在设置中保存密码'); return await api.sshPerformance({host:s.sshHost,port:s.sshPort,username:s.sshUsername,password}) as PerformanceInfo;
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
/** 提交本地 ComfyUI 工作流（直连 /prompt），返回 prompt_id */
/** 上传图片到 ComfyUI（/upload/image），返回服务器文件名（供 LoadImage 节点使用）。
 *  本地 ComfyUI 未开 CORS 时，multipart 请求会成功发出但响应读取被浏览器拦截（拿不到 name），
 *  因此用固定文件名 + overwrite 覆盖，请求发出即视为成功——保证上游图片能进入工作流。 */
export async function uploadImageToComfy(base: string, imageUrl: string): Promise<string> {
  const name = 'input_' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.png'; // 随机后缀：同毫秒并发上传不互相覆盖
  try {
    const blobRes = await fetch(imageUrl);
    if (!blobRes.ok) throw new Error('获取上游图片失败');
    const blob = await blobRes.blob();
    const fd = new FormData();
    fd.append('image', blob, name);
    // fire-and-forget：请求发出即可（响应读取可能被 CORS 拦，但上传本身成功）
    fetch(base.replace(/\/$/, '') + '/upload/image?overwrite=true', { method: 'POST', body: fd }).catch((err) => { console.warn('[uploadImageToComfy] 上传失败:', err?.message || err); });
    return name;
  } catch { return name; }
}

/** 从 ComfyUI 校验/执行错误结构中提取人类可读信息（含 node_errors 各节点细节） */
function extractComfyError(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.slice(0, 300);
  const obj = raw as Record<string, any>;
  if (obj.node_errors && typeof obj.node_errors === 'object') {
    // 校验错误：列出每个出错节点的字段和可用值，用户能直接看到改哪个参数
    const parts = Object.entries(obj.node_errors).map(([nodeId, e]) => {
      const err = e as Record<string, any>;
      const msgs = (err.errors || []).map((x: Record<string, any>) => {
        const d = String(x.details || x.message || '').slice(0, 260);
        return `${x.input_name ? x.input_name + ': ' : ''}${d}`;
      });
      return `节点 ${nodeId}: ${msgs.join('; ') || '参数校验失败'}`;
    });
    if (parts.length) return parts.join(' | ');
  }
  if (obj.exception_message) return `节点 ${obj.node_type || obj.node_id || ''}: ${String(obj.exception_message).slice(0, 300)}`;
  if (obj.message) return String(obj.message).slice(0, 300);
  if (obj.error) return String(obj.error).slice(0, 300);
  try { return JSON.stringify(raw).slice(0, 300); } catch { return '未知错误'; }
}

export async function submitLocalWorkflow(workflowJson: Record<string, any>, serverId?: string): Promise<string> {
  const base = getApiBase(serverId);
  const r = await ftch(base + '/prompt', { method: 'POST', headers: hdrs(serverId), body: JSON.stringify({ prompt: workflowJson }) }, 30000);
  const text = await r.text().catch(() => '');
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* 非 JSON（如 500 的 HTML） */ }
  if (!r.ok || !data?.prompt_id) {
    const detail = data ? extractComfyError(data.error || data) : (text ? text.slice(0, 200) : '');
    throw new Error(`工作流提交失败 (HTTP ${r.status})${detail ? '：' + detail : ''}`);
  }
  return data.prompt_id;
}

/** 轮询本地 ComfyUI /history 直到出结果，返回媒体 URL 列表 */
export async function pollLocalWorkflow(promptId: string, onProgress?: (msg: string, pct?: number) => void, signal?: AbortSignal, serverId?: string): Promise<Array<{ type: 'image' | 'video'; url: string }>> {
  const base = getApiBase(serverId);
  // 超时兜底：任务提交成功但长时间拿不到结果（服务器环境问题/任务被缓存无输出/history 查不到）时，
  // 明确报错而不是无限"还在跑"。180 秒覆盖模型冷加载 + 排队；超出即提示检查服务器。
  const POLL_TIMEOUT_SECONDS = 180;
  for (let i = 0; i < POLL_TIMEOUT_SECONDS; i++) {
    if (signal?.aborted) throw new DOMException('任务已暂停', 'AbortError');
    await new Promise(r => setTimeout(r, 1000));
    if (signal?.aborted) throw new DOMException('任务已暂停', 'AbortError');
    onProgress?.('正在生成', Math.min(99, Math.round((i / POLL_TIMEOUT_SECONDS) * 90)));
    try {
      const r = await ftch(base + '/history/' + encodeURIComponent(promptId), { headers: hdrs(serverId), signal }, 15000);
      if (!r.ok) continue;
      const data = await readJson<Record<string, any>>(r);
      const entry = data[promptId];
      if (!entry) continue;
      const outputs = entry.outputs || {};
      const items: Array<{ type: 'image' | 'video'; url: string }> = [];
      Object.values(outputs).forEach((o: any) => {
        (o.images || []).forEach((img: any) => items.push({ type: 'image', url: `${base}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${img.type || 'output'}` }));
        (o.gifs || o.videos || []).forEach((v: any) => items.push({ type: 'video', url: `${base}/view?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || '')}&type=${v.type || 'output'}` }));
      });
      if (items.length) return items;
      if (entry.status?.status_str === 'error') {
        // 从 status.messages 里找 execution_error 详情（节点/异常）
        let detail = '';
        try {
          const msgs = (entry.status?.messages || []) as Array<[string, any]>;
          const errMsg = msgs.find(([t]) => t === 'execution_error')?.[1];
          if (errMsg) detail = extractComfyError(errMsg);
        } catch { /* ignore */ }
        throw new Error('工作流执行错误' + (detail ? '：' + detail : '（可能缺少模型或插件，请检查 ComfyUI 端）'));
      }
      if (entry.status?.completed) {
        // 完成但无输出：把 status.messages 里可能的提示带上，便于排查（如 SaveImage 未执行/输出为空）
        let hint = '';
        try {
          const msgs = (entry.status?.messages || []) as Array<[string, any]>;
          const cached = msgs.some(([t]) => t === 'execution_cached');
          if (cached) hint = '任务被 ComfyUI 缓存命中（相同输入），但输出为空——若图片未变化属正常，若应有新图请更换 seed 后重试';
          const done = msgs.find(([t]) => t === 'execution_success')?.[1];
          if (done && !hint) hint = extractComfyError(done);
        } catch { /* ignore */ }
        throw new Error('工作流已完成但没有输出媒体' + (hint ? '（' + hint + '）' : '，请检查工作流的输出节点（SaveImage）是否正确连接'));
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      onProgress?.(`查询暂时失败，任务仍在等待`);
    }
  }
  // 轮询超时：任务提交成功但一直没有结果（历史记录查不到 / 服务器端未真正执行）
  throw new Error(`生成超时（${POLL_TIMEOUT_SECONDS} 秒）：未获取到结果。请检查服务器是否正常、模型是否缺失；远程/非主控机器需确认插件与模型已安装，必要时在 ComfyUI 端看任务队列`);
}

export async function fetchWorkflows(serverId?: string): Promise<ServerWorkflow[]> {
  try {
    const base = getApiBase(serverId);
    if (!base) return getCachedWorkflowDirectory();
    const r = await ftch(base + '/api/workflow/list', { headers: hdrs(serverId) }, 10000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await readJson<{ workflows?: ServerWorkflow[] }>(r);
    const server = (d.workflows || []) as ServerWorkflow[];
    if (server.length) { localStorage.setItem(workflowCacheKey(serverId), JSON.stringify(server)); return server; }
  } catch { /* try the next control-plane alias */ }
  try { return getCachedWorkflowDirectory(serverId); } catch { return []; }
}

export function getWorkflowPreset(wfId: string) { return WORKFLOW_PRESETS[wfId] || null; }

export async function generate(input: GenerateInput, serverId?: string): Promise<GenerateResponse> {
  const payload = { ...input, client_id: input.client_id || getClientId() };
  const r = await ftch(getApiBase(serverId) + '/api/workflow/generate', { method: 'POST', headers: hdrs(serverId), body: JSON.stringify(payload) }, tms());
  const data = await readJson<GenerateResponse>(r);
  if (!r.ok) {
    throw new Error(data.error || `任务提交失败 (HTTP ${r.status})`);
  }
  if (!data.success) throw new Error((data.error as string) || '生成任务提交失败');
  if (!data.prompt_id) throw new Error('任务已提交，但 API 未返回 prompt_id');
  return data;
}

/** 中断 ComfyUI 当前任务；本地 AbortController 只能停止轮询，不能停止远端执行。 */
export async function cancelComfyTask(promptId?: string, serverId?: string): Promise<void> {
  const attempts: Array<Promise<unknown>> = [
    ftch(getApiBase(serverId) + '/interrupt', { method: 'POST', headers: hdrs(serverId), body: JSON.stringify(promptId ? { prompt_id: promptId } : {}) }, 10000),
  ];
  if (getApiBase(serverId).includes('1069831-')) {
    attempts.push(controlRequest('/api/concurrent/mirror/interrupt', { method: 'POST', body: JSON.stringify({ mirror_url: getApiBase(serverId) }) }, 10000));
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

export async function pollResult(promptId: string, onProgress?: (msg: string, pct?: number) => void, interval = 2000, maxRetries?: number, signal?: AbortSignal, serverId?: string): Promise<ResultResponse> {
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
      const r = await ftch(getApiBase(serverId) + '/api/workflow/result?prompt_id=' + encodeURIComponent(promptId), { headers: hdrs(serverId), signal }, 15000);
      if (!r.ok) { onProgress?.(`查询暂时失败 (HTTP ${r.status})，任务仍在等待`, pct); continue; }
      const data = await readJson(r);
      // 检查 results 字段（API 返回格式）
      const items = data.results || data.data;
      if (data.success && items && items.length > 0) {
        const results: ResultItem[] = [];
        for (const item of items) {
          const url = (item.url as string) || '';
          if (!url) continue;
          results.push({ type: item.type || 'image', url: url.startsWith('http') ? url : getApiBase(serverId) + (url.startsWith('/') ? url : '/' + url), filename: item.filename });
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
      const r2 = await ftch(getApiBase(serverId) + '/api/comfy/proxy/history?prompt_id=' + encodeURIComponent(promptId), { headers: hdrs(serverId) }, 15000);
      if (!r2.ok) continue;
      const hdata = await r2.json();
      if (hdata[promptId]) {
        const outputs = hdata[promptId].outputs; const results: ResultItem[] = [];
        for (const nodeId in outputs) {
          const no = outputs[nodeId];
          if (no.images) for (const img of no.images) results.push({ type: 'image', url: getApiBase(serverId) + '/api/comfy/view?filename=' + encodeURIComponent(img.filename) + '&type=' + (img.type || 'output') + '&subfolder=' + encodeURIComponent(img.subfolder || ''), filename: img.filename });
          if (no.gifs) for (const g of no.gifs) results.push({ type: 'video', url: getApiBase(serverId) + '/api/comfy/view?filename=' + encodeURIComponent(g.filename) + '&type=' + (g.type || 'output') + '&subfolder=' + encodeURIComponent(g.subfolder || ''), filename: g.filename });
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
