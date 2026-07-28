import { useSettingsStore } from '@/stores/settingsStore';

/** ComfyUI WebSocket 实时进度管理 */
export interface ProgressPayload { value: number; max: number; node?: string; promptId?: string }
export interface ExecutingPayload { node: string | null; prompt_id?: string }
export interface PromptDonePayload { prompt_id: string; status: 'success' | 'error' | 'interrupted' }
type ProgressCallback = (data: ProgressPayload) => void;
type StatusCallback = (data: { status: string; sid?: string }) => void;
type ExecutingCallback = (data: ExecutingPayload) => void;
type PromptDoneCallback = (data: PromptDonePayload) => void;

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  return 'client-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const CLIENT_KEY = 'ai-canvas-comfy-client-id';
let cachedClientId: string | undefined;

export function getClientId(): string {
  if (cachedClientId) return cachedClientId;
  try { const cached = localStorage.getItem(CLIENT_KEY); if (cached) { cachedClientId = cached; return cached; } } catch {}
  const id = uuid();
  try { localStorage.setItem(CLIENT_KEY, id); } catch {}
  cachedClientId = id;
  return id;
}

class ComfyWS {
  private ws: WebSocket | null = null;
  private url: string = '';
  private reconnectTimer: any = null;
  private progressCbs: Set<ProgressCallback> = new Set();
  private statusCbs: Set<StatusCallback> = new Set();
  private executingCbs: Set<ExecutingCallback> = new Set();
  private promptDoneCbs: Set<PromptDoneCallback> = new Set();
  private _connected = false;

  get connected() { return this._connected; }

  connect() {
    const base = useSettingsStore.getState().baseUrl.replace(/\/+$/, '');
    const wsUrl = base.replace('https://', 'wss://').replace('http://', 'ws://') + '/comfyui-ws?clientId=' + encodeURIComponent(getClientId());
    if (this.url === wsUrl && this._connected) return;
    this.url = wsUrl;
    this.disconnect();
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => { this._connected = true; this.emitStatus('connected'); };
      this.ws.onmessage = (e) => { try { this.handleMsg(JSON.parse(e.data)); } catch {} };
      this.ws.onclose = () => { this._connected = false; this.emitStatus('disconnected'); this.scheduleReconnect(); };
      this.ws.onerror = () => { this._connected = false; this.emitStatus('error'); };
    } catch { this.scheduleReconnect(); }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, 5000);
  }

  disconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {}; this.ws = null; }
    this._connected = false;
  }

  private handleMsg(msg: any) {
    const promptId: string | undefined = msg.data?.prompt_id;
    switch (msg.type) {
      case 'progress': {
        const { value, max, node } = msg.data || {};
        this.progressCbs.forEach(cb => cb({ value, max, node, promptId }));
        break;
      }
      case 'executing': {
        const { node, prompt_id } = msg.data || {};
        this.executingCbs.forEach(cb => cb({ node, prompt_id }));
        if (node == null && prompt_id) this.promptDoneCbs.forEach(cb => cb({ prompt_id, status: 'success' }));
        break;
      }
      case 'status': {
        this.statusCbs.forEach(cb => cb({ status: msg.data?.status || '' }));
        break;
      }
      case 'execution_start': {
        this.emitStatus('running');
        break;
      }
      case 'execution_cached':
      case 'executed': {
        this.progressCbs.forEach(cb => cb({ value: 1, max: 1, promptId }));
        break;
      }
      case 'execution_success': {
        if (promptId) this.promptDoneCbs.forEach(cb => cb({ prompt_id: promptId, status: 'success' }));
        break;
      }
      case 'execution_error': {
        if (promptId) this.promptDoneCbs.forEach(cb => cb({ prompt_id: promptId, status: 'error' }));
        break;
      }
      case 'execution_interrupted': {
        if (promptId) this.promptDoneCbs.forEach(cb => cb({ prompt_id: promptId, status: 'interrupted' }));
        break;
      }
    }
  }

  onProgress(cb: ProgressCallback) { this.progressCbs.add(cb); return () => { this.progressCbs.delete(cb); }; }
  onStatus(cb: StatusCallback) { this.statusCbs.add(cb); return () => { this.statusCbs.delete(cb); }; }
  onExecuting(cb: ExecutingCallback) { this.executingCbs.add(cb); return () => { this.executingCbs.delete(cb); }; }
  onPromptDone(cb: PromptDoneCallback) { this.promptDoneCbs.add(cb); return () => { this.promptDoneCbs.delete(cb); }; }

  private emitStatus(status: string) {
    this.statusCbs.forEach(cb => cb({ status }));
  }
}

export const comfyWS = new ComfyWS();