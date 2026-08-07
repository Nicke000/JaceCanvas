import { sendChat, attachmentParts, type ChatTurn, type ChatAttachment } from '@/services/chat.service';
import { useCanvasStore, NODE_DEFAULTS } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * 画布 AI 代码 Agent —— 让 AI 直接操作画布：
 * 加节点 / 连线 / 改配置 / 查错误 / 执行修复。
 *
 * 协议：所有 provider 通用（无需 tools/function-calling 支持）——
 * 模型按系统提示词输出 JSON：{"action":"...","args":{...}} 或 {"reply":"..."}，
 * 前端执行工具并回传结果，循环直到模型给出 reply。
 */

export type AgentEvent =
  | { kind: 'tool'; action: string; summary: string; ok: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'confirm-source'; summary: string };

const MAX_ROUNDS = 6;

/* ============ 工具清单（给模型的说明书） ============ */
const TOOL_DOCS = `可用工具（输出 JSON 格式，一次一个动作；需要多步时先做完所有动作，最后单独输出 {"reply":"最终回答"}）：
1. {"action":"list_nodes"} —— 列出画布所有节点（id/名称/类型/状态/错误）。
2. {"action":"node_types"} —— 列出可添加的节点类型。
3. {"action":"add_node","args":{"type":"节点类型","label":"可选自定义名","config":{...}}} —— 添加节点到画布中心。
4. {"action":"connect","args":{"source":"上游节点id或名称","target":"下游节点id或名称","sourceHandle":"可选输出端口","targetHandle":"可选输入端口"}} —— 连接两个节点。
5. {"action":"set_config","args":{"node":"节点id或名称","key":"配置项","value":值}} 或 {"node":"...","config":{...}} —— 修改节点配置。
6. {"action":"run","args":{"node":"节点id或名称"}} —— 从该节点开始执行（含下游链路）。
7. {"action":"read_errors"} —— 检查画布所有报错节点及其原因。
8. {"action":"get_node","args":{"node":"节点id或名称"}} —— 查看单个节点详情（配置/状态/结果）。
9. {"action":"delete_node","args":{"node":"节点id或名称"}} —— 删除节点（谨慎）。
10. {"action":"select_node","args":{"node":"节点id或名称"}} —— 在画布中选中并定位节点。
节点可用"名称"或"id"引用，名称不唯一时用 id。

【源码修改模式】当用户要求修改/修复/添加软件的源代码或功能时，使用以下工具（只能改沙盒副本，主版本只读）：
11. {"action":"request_source_access","args":{"reason":"一句话说明要改什么"}} —— 首次改源码前调用：会弹窗让用户确认，确认后复制一份最新源码作为新版本（原版不动）。
12. {"action":"source_list_versions"} —— 列出所有源码版本（id/标记/状态）。
13. {"action":"source_read_file","args":{"version":"版本id","path":"src/xxx.ts"}} —— 读沙盒内源码文件。
14. {"action":"source_write_file","args":{"version":"版本id","path":"src/xxx.ts","content":"完整新内容"}} —— 写沙盒内文件（不能写主版本 v0）。
15. {"action":"source_build_test","args":{"version":"版本id"}} —— 在沙盒里跑 tsc 校验，通过后该版本标记 build-ok。
16. {"action":"source_mark_usable","args":{"version":"版本id"}} —— 用户测试通过后标记为可用。
17. {"action":"source_delete_version","args":{"version":"版本id"}} —— 删除一个沙盒版本（主进程强制保留 2 个可用版本，删除不可恢复）。
18. {"action":"source_package","args":{"version":"版本id"}} —— 把沙盒版本打包成 Windows 安装版（后台执行，首次会下载 Electron 二进制较慢），打包完成后用 source_package_status 查询安装包路径并告诉用户。
19. {"action":"source_package_status","args":{"version":"版本id"}} —— 查询打包进度（running/done/failed + 安装包位置）。
20. {"action":"source_run_command","args":{"version":"版本id","command":"npm run build"}} —— 在沙盒版本目录内执行受限终端命令（白名单：npm/npx/node/git/tsc/vite/dir/echo 等开发命令；危险命令会被拒绝；60s 超时）。需要装依赖/跑构建/查 git 状态时用它。
源码修改流程：request_source_access → source_read_file 定位 → source_write_file 修改 → source_build_test 验证 → 告诉用户去测试沙盒版本；只有用户明确说可用才 source_mark_usable。
注意：JSON 必须合法，不能有注释；做完所有动作后，用 {"reply":"给用户的最终中文回答"} 结束。`;

/* ============ 画布上下文 ============ */
function buildCanvasContext(): string {
  const st = useCanvasStore.getState();
  const nodes = st.nodes.map(n => {
    const d = n.data;
    const cfg = d.config ? Object.entries(d.config as Record<string, unknown>).filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== '' && v !== null).slice(0, 6).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(', ') : '';
    const err = d.error ? `，错误: ${String(d.error).slice(0, 120)}` : '';
    return `- ${d.label || '未命名'} (${d.nodeType}) [${d.status || 'idle'}]${err}${cfg ? ` 配置: ${cfg}` : ''}`;
  }).join('\n');
  const edges = st.edges.map(e => `${st.nodes.find(n => n.id === e.source)?.data.label ?? e.source} → ${st.nodes.find(n => n.id === e.target)?.data.label ?? e.target}`).join('\n');
  return `当前画布节点（${st.nodes.length} 个）：\n${nodes || '（空画布）'}\n当前连线（${st.edges.length} 条）：\n${edges || '（无连线）'}`;
}

/** 节点类型清单（供模型选择） */
export function nodeTypeCatalog(): string {
  return Object.entries(NODE_DEFAULTS).map(([type, v]) => `${type}（${v.label}）`).join('、');
}

/* ============ 工具执行器 ============ */
function resolveNodeId(ref: string): string | null {
  const st = useCanvasStore.getState();
  const n = st.nodes.find(x => x.id === ref) || st.nodes.find(x => x.data.label === ref);
  return n ? n.id : null;
}

let confirmResolver: ((ok: boolean) => void) | null = null;
/** AgentPanel 调用：把用户的确认结果回传给等待中的 agent */
export function resolveSourceConfirm(ok: boolean) { confirmResolver?.(ok); confirmResolver = null; }

function sandboxApi() { return (window as any).electronAPI?.sourceApi; }

async function executeAgentAction(action: string, args: Record<string, any>, onEvent: (e: AgentEvent) => void): Promise<{ ok: boolean; message: string }> {
  const st = useCanvasStore.getState();
  switch (action) {
    case 'list_nodes': {
      const lines = st.nodes.map(n => `${n.id} | ${n.data.label || '未命名'} | ${n.data.nodeType} | ${n.data.status || 'idle'}${n.data.error ? ' | 错误: ' + String(n.data.error).slice(0, 80) : ''}`);
      return { ok: true, message: lines.join('\n') || '画布为空' };
    }
    case 'node_types':
      return { ok: true, message: nodeTypeCatalog() };
    case 'add_node': {
      const type = String(args?.type || '');
      if (!NODE_DEFAULTS[type as keyof typeof NODE_DEFAULTS]) return { ok: false, message: `未知节点类型: ${type}，可用类型见 node_types` };
      const center = ((window as any).__canvasCenter?.() || { x: 320, y: 200 });
      const id = st.addNode(type as any, { x: center.x + (st.nodes.length % 5) * 24, y: center.y + (st.nodes.length % 5) * 24 }, {
        label: args?.label || undefined,
        ...(args?.config ? { config: args.config } : {}),
      } as any);
      return { ok: true, message: `已添加节点 ${args?.label || NODE_DEFAULTS[type as keyof typeof NODE_DEFAULTS]?.label}（id: ${id}）` };
    }
    case 'connect': {
      const source = resolveNodeId(String(args?.source || ''));
      const target = resolveNodeId(String(args?.target || ''));
      if (!source || !target) return { ok: false, message: `找不到节点: ${!source ? args?.source : args?.target}` };
      if (source === target) return { ok: false, message: '不能连接节点自身' };
      st.onConnect({ source, target, sourceHandle: args?.sourceHandle || null, targetHandle: args?.targetHandle || null } as any);
      return { ok: true, message: `已连接 ${args?.source} → ${args?.target}` };
    }
    case 'set_config': {
      const id = resolveNodeId(String(args?.node || ''));
      if (!id) return { ok: false, message: `找不到节点: ${args?.node}` };
      if (args?.config && typeof args.config === 'object') st.setNodeConfig(id, args.config);
      else st.setNodeConfig(id, { [String(args?.key)]: args?.value });
      return { ok: true, message: `已更新节点 ${args?.node} 的配置` };
    }
    case 'run': {
      const id = resolveNodeId(String(args?.node || ''));
      if (!id) return { ok: false, message: `找不到节点: ${args?.node}` };
      void st.executeFromNode(id);
      return { ok: true, message: `已从节点 ${args?.node} 开始执行（含下游链路）` };
    }
    case 'read_errors': {
      const errs = st.nodes.filter(n => n.data.status === 'error' || n.data.error).map(n => `${n.data.label || n.id}: ${String(n.data.error || n.data.status).slice(0, 120)}`);
      return { ok: true, message: errs.length ? errs.join('\n') : '画布没有报错节点 ✓' };
    }
    case 'get_node': {
      const id = resolveNodeId(String(args?.node || ''));
      if (!id) return { ok: false, message: `找不到节点: ${args?.node}` };
      const n = st.nodes.find(x => x.id === id)!;
      return { ok: true, message: JSON.stringify({ label: n.data.label, type: n.data.nodeType, status: n.data.status, error: n.data.error || null, config: n.data.config || {}, results: n.data.results?.length || 0 }, null, 2) };
    }
    case 'delete_node': {
      const id = resolveNodeId(String(args?.node || ''));
      if (!id) return { ok: false, message: `找不到节点: ${args?.node}` };
      st.onNodesChange([{ type: 'remove', id } as any]);
      return { ok: true, message: `已删除节点 ${args?.node}` };
    }
    case 'select_node': {
      const id = resolveNodeId(String(args?.node || ''));
      if (!id) return { ok: false, message: `找不到节点: ${args?.node}` };
      st.setSelectedNodeId(id);
      window.dispatchEvent(new CustomEvent('ai-canvas-focus-node', { detail: { nodeId: id } }));
      return { ok: true, message: `已在画布选中节点 ${args?.node}` };
    }
    case 'request_source_access': {
      const api = sandboxApi();
      if (!api) return { ok: false, message: '源码沙盒不可用（非 Electron 环境）' };
      // 先弹窗让用户确认（AgentPanel 监听 confirm-source 事件后 resolveSourceConfirm）
      onEvent({ kind: 'confirm-source', summary: `用户要求修改源码：${args?.reason || ''}。确认后将复制一份最新源码作为沙盒版本（原版不动）。` });
      const ok = await new Promise<boolean>(res => { confirmResolver = res; });
      if (!ok) return { ok: false, message: '用户取消了源码修改，已停止。如需只读分析可以继续。' };
      const branch = await api.createBranch({});
      return { ok: true, message: `已创建沙盒版本 ${branch.id}（路径 ${branch.path}），只改这个副本，主版本未动。` };
    }
    case 'source_list_versions': {
      const api = sandboxApi();
      if (!api) return { ok: false, message: '源码沙盒不可用' };
      const info = await api.listVersions();
      return { ok: true, message: info.versions.map((v: any) => `${v.id} | ${v.tag} | ${v.status}${v.deletable ? '' : '（主版本，不可删）'}`).join('\n') };
    }
    case 'source_read_file': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      const filePath = String(args?.path || '');
      if (!version || !filePath) return { ok: false, message: '需要 version 和 path' };
      const content = await api.readFile({ versionId: version, path: filePath });
      return { ok: true, message: `文件 ${filePath}（${version}）：\n${String(content).slice(0, 4000)}` };
    }
    case 'source_write_file': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      const filePath = String(args?.path || '');
      const content = String(args?.content ?? '');
      if (!version || !filePath) return { ok: false, message: '需要 version、path、content' };
      if (version === 'v0') return { ok: false, message: '禁止修改主版本！请先 request_source_access 创建沙盒副本' };
      await api.writeFile({ versionId: version, path: filePath, content });
      return { ok: true, message: `已写入 ${filePath}（版本 ${version}）。建议接着 source_build_test 验证。` };
    }
    case 'source_build_test': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      if (!version) return { ok: false, message: '需要 version' };
      const r = await api.buildTest({ versionId: version });
      return { ok: r.ok, message: r.ok ? `构建校验通过（tsc --noEmit），版本 ${version} 已标记 build-ok。` : `构建失败：\n${r.log || ''}` };
    }
    case 'source_mark_usable': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      if (!version) return { ok: false, message: '需要 version' };
      await api.markUsable({ versionId: version, note: args?.note });
      return { ok: true, message: `版本 ${version} 已标记为可用。` };
    }
    case 'source_delete_version': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      if (!version) return { ok: false, message: '需要 version' };
      onEvent({ kind: 'confirm-source', summary: `删除源码版本 ${version} ？删除后不可恢复（系统强制保留 2 个可用版本）。` });
      const ok = await new Promise<boolean>(res => { confirmResolver = res; });
      if (!ok) return { ok: false, message: '已取消删除' };
      try {
        const r = await api.deleteVersion({ versionId: version });
        return { ok: true, message: r.message || `已删除 ${version}` };
      } catch (err: any) {
        return { ok: false, message: `删除被拒绝：${String(err?.message || err)}` };
      }
    }
    case 'source_package': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      if (!version) return { ok: false, message: '需要 version' };
      const r = await api.package({ versionId: version });
      return { ok: r.started, message: r.message || '打包已开始' };
    }
    case 'source_package_status': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      if (!version) return { ok: false, message: '需要 version' };
      const r = await api.packageStatus({ versionId: version });
      if (r.status === 'done') return { ok: true, message: '打包完成！安装包位于 ' + (r.output || '') + (r.exes?.length ? '，文件：' + r.exes.join(', ') : '') };
      if (r.status === 'failed') return { ok: false, message: '打包失败：' + (r.error || '未知') + '（日志：' + (r.logFile || '') + '）' };
      if (r.status === 'running') return { ok: false, message: '正在打包中…（首次需下载 Electron 二进制，可能几分钟）。最新日志：' + String(r.tail || '').slice(-600) };
      return { ok: false, message: '打包状态未知（可能尚未开始）' };
    }
    case 'source_run_command': {
      const api = sandboxApi();
      const version = String(args?.version || '');
      const command = String(args?.command || '');
      if (!version || !command) return { ok: false, message: '需要 version 和 command' };
      try {
        const r = await api.runCommand({ versionId: version, command });
        return { ok: r.ok, message: '命令执行' + (r.ok ? '成功' : '失败/被终止') + '（沙盒目录内，输出已截断）：\n' + String(r.output || '').slice(-3000) };
      } catch (err: any) {
        return { ok: false, message: '命令被拒绝：' + String(err?.message || err).slice(0, 200) };
      }
    }
    default:
      return { ok: false, message: `未知动作: ${action}` };
  }
}

/* ============ JSON 宽松解析 ============ */
function parseAgentJson(text: string): { action?: string; args?: Record<string, any>; reply?: string; thought?: string } | null {
  let t = text.trim();
  // 去掉 markdown 代码块
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 找第一个平衡的 { ... }
  let start = -1;
  for (let i = 0; i < t.length; i++) { if (t[i] === '{') { start = i; break; } }
  if (start === -1) return null;
  let depth = 0, end = -1;
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++;
    else if (t[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) return null;
  try {
    const obj = JSON.parse(t.slice(start, end));
    if (obj && typeof obj === 'object') return obj;
  } catch { /* 尝试剥离尾随逗号等容错 */ }
  try {
    const cleaned = t.slice(start, end).replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === 'object') return obj;
  } catch { /* ignore */ }
  return null;
}

/* ============ 主循环 ============ */
export async function runCanvasAgent(userInput: string, onEvent: (e: AgentEvent) => void, attachments: ChatAttachment[] = []): Promise<string> {
  const system = `你是嵌入在 AI 画布应用里的代码/工作流 Agent。用户会用自然语言请你：添加节点、连接节点、修改配置、检查执行错误并修复、解答小白问题。
规则：
- 先想清楚再动手：需要看画布就 list_nodes/read_errors，需要知道可加什么就 node_types。
- 动手前用 get_node 确认目标节点（尤其修改/删除前）。
- 出错时分析原因（模型名不对/没连上游/缺 API Key/服务器不可达等）并用 set_config / connect / run 修复；无法自动修复时给出明确的中文指导。
- 所有输出用 JSON，一次一个动作；全部完成后用 {"reply":"..."} 给出最终中文回答（简明、小白能懂）。
- 不要编造不存在的节点 id 或配置项。
- 修改软件源代码时：永远只改沙盒副本（request_source_access 创建），绝不改主版本；先读后写、写完构建校验、让用户测试后再标记可用。
${TOOL_DOCS}`;

  const history: ChatTurn[] = [
    { role: 'user', content: attachments.length ? [{ type: 'text', text: userInput }, ...attachmentParts(attachments)] : userInput },
  ];

  let finalReply = '';
  // DevAgent 独立 AI 配置（设置 → DevAgent）：未单独配置时回退聊天 AI 配置并提示
  const st = useSettingsStore.getState();
  const devOverrides: any = { thinkingMode: 'auto' as const };
  if (st.devAgentProvider) devOverrides.provider = st.devAgentProvider;
  if (st.devAgentBaseUrl) devOverrides.baseUrl = st.devAgentBaseUrl;
  if (st.devAgentApiKey) devOverrides.apiKey = st.devAgentApiKey;
  if (st.devAgentModel) devOverrides.model = st.devAgentModel;
  if (!st.devAgentApiKey) onEvent({ kind: 'error', message: 'DevAgent 尚未单独配置 API，当前使用聊天 AI 的配置。可在 设置 → DevAgent 中单独配置接口/模型。' });
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 每轮把最新画布状态拼进 systemPrompt，模型始终看到当前画布
    const res = await sendChat('', [], history, undefined, { ...devOverrides, systemPrompt: system + '\n\n【当前画布状态】\n' + buildCanvasContext() });
    const text = res.text;
    const parsed = parseAgentJson(text);

    if (parsed?.reply) {
      finalReply = parsed.reply;
      onEvent({ kind: 'text', text: finalReply });
      return finalReply;
    }
    if (parsed?.action) {
      const result = await executeAgentAction(parsed.action, parsed.args || {}, onEvent);
      onEvent({ kind: 'tool', action: parsed.action, summary: result.message, ok: result.ok });
      history.push({ role: 'assistant', content: text });
      history.push({ role: 'user', content: `工具 ${parsed.action} 结果：${result.ok ? '成功' : '失败'} — ${result.message}` });
      continue;
    }
    // 非 JSON：当成最终回答
    finalReply = text.trim();
    onEvent({ kind: 'text', text: finalReply });
    return finalReply;
  }
  finalReply = finalReply || '已尽力完成，但步骤较多未全部跑完。你可以再告诉我下一步要做什么。';
  onEvent({ kind: 'text', text: finalReply });
  return finalReply;
}
