/**
 * JaceCanvas - DSH 统一服务层（渲染进程）
 *
 * 让画布各处 AI 能力（聊天窗口 / 短剧剧本分析 / 导演台运镜分析 / 画布节点）统一
 * 走 DeepSeek Harness（DSH）：DSH 具备文件系统、真实终端、Web 搜索、Skills 等
 * 完整 agent 能力，比单独调 LLM API 强得多。
 *
 * 实现：通过主进程 dsh-bridge 的 headless 任务（dsh --profile headless "任务"）
 * 执行，等待最终答案返回。headless 每次冷启动一个全新持久化会话，多轮对话时
 * 把历史拼进任务文本，保证上下文连续。
 *
 * 开源适配：DSH 为可选外部依赖（npm i -g @deepseek-ai/dsh）。未安装时本服务
 * 返回不可用，调用方应回退到原有 API 配置。
 */

export interface DshAskOptions {
  task: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  profile?: string;
  cwd?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface DshAskResult {
  ok: boolean;
  text: string;
  error?: string;
}

function dshApi(): any {
  return (window as any).electronAPI?.dshApi;
}

/** DSH 是否可用（探测主进程状态，带缓存 5s） */
let cachedAvailable: boolean | null = null;
let cacheAt = 0;
export async function dshAvailable(force = false): Promise<boolean> {
  if (!force && cachedAvailable !== null && Date.now() - cacheAt < 5000) return cachedAvailable;
  try {
    const st = await dshApi()?.getStatus?.();
    cachedAvailable = !!st?.available;
  } catch { cachedAvailable = false; }
  cacheAt = Date.now();
  return cachedAvailable;
}

export function invalidateDshCache() { cachedAvailable = null; }

/**
 * 提交一个 DSH headless 任务并等待最终答案（文本）。
 * 多轮对话：把 history 拼进任务（DSH headless 每次是新会话，靠任务文本带上下文）。
 * 超时默认 10 分钟（headless 冷启动 + 长任务）。
 */
export async function dshAsk(opts: DshAskOptions): Promise<DshAskResult> {
  const api = dshApi();
  if (!api?.runTask) return { ok: false, text: '', error: 'DSH 集成不可用' };
  const available = await dshAvailable();
  if (!available) return { ok: false, text: '', error: '未检测到 dsh。请先安装：npm install -g @deepseek-ai/dsh' };

  const { task, history = [], profile, cwd, systemPrompt, timeoutMs = 10 * 60 * 1000 } = opts;

  // 组装带上下文的完整任务文本
  const parts: string[] = [];
  if (systemPrompt) parts.push(`【系统指令】\n${systemPrompt}`);
  if (history.length) {
    const transcript = history.map(t => `${t.role === 'user' ? '用户' : '助手'}：${t.content}`).join('\n');
    parts.push(`【对话历史】\n${transcript}`);
  }
  parts.push(`【本次请求】\n${task}`);
  const fullTask = parts.join('\n\n');

  const started = await api.runTask({ task: fullTask, profile: profile || 'headless', cwd });
  if (!started?.ok) return { ok: false, text: '', error: started?.message || 'DSH 任务启动失败' };
  const taskId = started.taskId;

  // 等待完成事件（事件驱动，超时兜底）
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => { off(); resolve({ ok: false, text: '', error: `DSH 任务超时（${Math.round(timeoutMs / 60000)} 分钟）` }); }, timeoutMs);
    const off = api.onTaskDone((payload: any) => {
      if (payload?.taskId !== taskId) return;
      window.clearTimeout(timer); off();
      if (payload?.ok) resolve({ ok: true, text: String(payload.output || '') });
      else resolve({ ok: false, text: '', error: payload?.error ? String(payload.error) : 'DSH 任务失败' });
    });
  });
}

/** 快捷：dshAsk 但失败时抛错（供 try/catch 调用方使用） */
export async function dshAskOrThrow(opts: DshAskOptions): Promise<string> {
  const r = await dshAsk(opts);
  if (!r.ok) throw new Error(r.error || 'DSH 任务失败');
  return r.text;
}