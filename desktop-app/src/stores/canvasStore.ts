import { create } from 'zustand';
import { message } from 'antd';
import { applyNodeChanges, applyEdgeChanges, MarkerType, type NodeChange, type EdgeChange, type Connection, type Edge } from '@xyflow/react';
import type { AppNode, CanvasNodeData, ToolAction, HistorySnapshot, NodeComponentType, ContextMenuState, NodeStatus } from '@/types';
import { NODE_CONFIGS } from '@/types';
import { generate, pollResult, uploadFile, getApiBase, bridgeMediaToInput, cancelComfyTask, submitLocalWorkflow, uploadImageToComfy, uploadMediaToComfy, pollLocalWorkflow, type ResultItem } from '@/services/comfyui.service';
import { createStandardTask, createComfyWorkflowTask, prepareRunningHubInputs, waitRunningHubTask } from '@/services/runninghub.service';
import { PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';
import { getPaidModelsForAdapter, getPaidAdapter } from '@/config/paidApiAdapters';
import { generateId, expandPromptVariants } from '@/utils';
import { applyWorkflowParams, workflowImageInputs, workflowPorts, isPositivePromptField, isNegativePromptField } from '@/utils/comfyWorkflow';
import { portTypeColor } from '@/utils/portColor';
import { NODE_MAP } from '@/config/registry';
import { playNodeDoneSound } from '@/utils/nodeSound';
import { mediaTypeForFile } from '@/utils/fileDrop';
import { sendChat, type ChatTurn } from '@/services/chat.service';
import { formatEffects, CINEMATOGRAPHY_EFFECTS } from '@/config/cinematographyKnowledge';
import { generateStoryboard, DEFAULT_STORYBOARD_SYSTEM_PROMPT } from '@/services/storyboard.service';
import { callPaidApi } from '@/services/paidApi.service';
import { getPaidModelsForCapability } from '@/config/paidCapabilityCatalog';
import { useSettingsStore, type PaidApiNodeSettings } from '@/stores/settingsStore';
import { getSupportedPaidCapabilities } from '@/config/paidCapabilityCatalog';
import { getAllStyles } from '@/config/stylePresets';
import { runningHubMediaSlotCount, runningHubOptionalOutputs, runningHubSlotKey } from '@/config/runninghubCatalog';
import { cameraMotionPrompt } from '@/config/cameraMotions';
import { addGenerationHistory, autoSaveToAssets } from '@/utils/generationHistory';

/** 动态端口类型解析（BUG-3 修复）：apiNode 用 _apiFields，localWorkflow 用 workflowPorts()，静态节点用 NODE_CONFIGS；查不到返回 undefined（不拦截） */
function getDynamicPortType(node: AppNode, handleId: string | null | undefined, isOutput: boolean): string | undefined {
  const nt = node.data.nodeType;
  if (nt === 'apiNode') {
    // _apiFields 字段结构：{ key: '节点id:字段名', label, value, field, nodeTitle, fileType, type, options }——handle id 就是 key
    const fields = (node.data.config?._apiFields || []) as Array<{ key: string; field?: string; fileType?: string; type?: string }>;
    const f = fields.find(x => x.key === handleId || x.field === handleId);
    if (!f) return undefined;
    if (f.fileType === 'image' || f.fileType === 'video' || f.fileType === 'audio') return f.fileType;
    return f.type === 'select' ? 'text' : (f.type || 'text');
  }
  if (nt === 'runningHubWorkflow') {
    const contract = node.data.config?.runningHubContract as any;
    const base = contract?.params?.find((param: any) => param.fieldKey === handleId && ['STRING','TEXT','LIST'].includes(param.type));
    if (base) return 'text';
    const media = contract?.params?.find((param: any) => param.fieldKey === handleId || String(handleId || '').startsWith(`${param.fieldKey}__`));
    if (media?.type === 'IMAGE' || media?.type === 'VIDEO' || media?.type === 'AUDIO') return String(media.type).toLowerCase();
    return undefined;
  }
  if (nt === 'localWorkflow') {
    const ports = workflowPorts(node.data.config?.workflowJson as Record<string, any> | undefined);
    const list = isOutput ? ports.outputs : ports.inputs;
    return list.find(x => x.id === handleId)?.type;
  }
  if (nt === 'paidCapability') {
    // 能力节点输出端口随能力动态变化（image↔video↔audio↔3d），从 PAID_CAPABILITIES 解析
    try {
      const cap = String(node.data.config?.capability || '');
      const def = (PAID_CAPABILITIES as any)[cap];
      if (isOutput) return def?.output;
      const ins = def?.input || [];
      const found = ins.find((x: any) => x === handleId);
      if (found) return typeof found === 'string' ? found : (found as any)?.type;
      return 'text';
    } catch { return undefined; }
  }
  const meta = NODE_CONFIGS[nt as NodeComponentType];
  const list = isOutput ? meta?.outputs : meta?.inputs;
  return list?.find(x => x.name === handleId)?.type;
}

export const NODE_DEFAULTS: Record<NodeComponentType, { label: string; color: string }> = {
  textInput:       { label: '文本输入', color: '#1677ff' },
  scriptInput:     { label: '剧本输入', color: '#8b5cf6' },
  sceneSettings:   { label: '场景设定', color: '#f59e0b' },
  compare:         { label: '前后对比', color: '#14b8a6' },
  asset:           { label: '素材',     color: '#0ea5e9' },
  imageGeneration: { label: '文生图',   color: '#722ed1' },
  imageToImage:    { label: '图生图',   color: '#13c2c2' },
  videoGeneration: { label: '视频生成', color: '#eb2f96' },
  preview:         { label: '预览',     color: '#52c41a' },
  note:            { label: '备注',     color: '#d4a72c' },
  frame:           { label: '分组',     color: '#7c6df2' },
  reroute:         { label: '转接点',   color: 'var(--theme-muted)' },
  // All 25 new types come from registry
  qwenImageGen:{label:'Qwen生成',color:'#6366f1'},qwenImageEdit:{label:'Qwen编辑',color:'var(--theme-accent)'},
  zimageGen:{label:'Zimage',color:'#a855f7'},fluxImageGen:{label:'Flux',color:'#06b6d4'},
  sdxlIL:{label:'SDXL-IL',color:'#ec4899'},fireRedEdit:{label:'FireRed编辑',color:'#f97316'},
  wanVideoGen:{label:'Wan图生',color:'#22c55e'},ltxVideoGen:{label:'LTX视频',color:'#10b981'},
  lipSyncHuman:{label:'对口型',color:'#eab308'},personReplace:{label:'人物替换',color:'#ef4444'},
  gaussianSplat:{label:'高斯泼溅',color:'#8b5cf6'},upscaleWatermark:{label:'放大去水印',color:'#14b8a6'},
  audioGen:{label:'声音生成',color:'#f59e0b'},motionTransfer:{label:'动作迁移',color:'#d946ef'},
  storyboardGPT:{label:'分镜图',color:'#0ea5e9'},intentImage:{label:'表意图',color:'#84cc16'},
  booguImage:{label:'Boogu',color:'#f472b6'},kreaImage:{label:'Krea',color:'#fb923c'},
  universalMaker:{label:'通用制作',color:'#6b7280'},toolSettings:{label:'工具设置',color:'var(--theme-muted)'},
  joyAIEcho:{label:'JoyAI-Echo',color:'#c084fc'},
  storyboardPrompt:{label:'剧情分镜',color:'#0ea5e9'},storyboardRender:{label:'分镜批量生成',color:'#8b5cf6'},timelineRender:{label:'时间线合成',color:'#22c55e'},cinematographyKnowledge:{label:'影视知识库',color:'#f59e0b'},
  refMultiFusion:{label:'多图融合',color:'#ec4899'},refWashImage:{label:'洗图',color:'#f43f5e'},
  refImageClear:{label:'变清晰',color:'#22c55e'},refImageToVideo:{label:'图生视频',color:'#3b82f6'},
  uploadNode:{label:'上传文件',color:'#60a5fa'},downloadNode:{label:'下载结果',color:'#f59e0b'},
  imageCrop:{label:'修图裁切',color:'#f97316'}, inpaint:{label:'圈画修图',color:'#22d3ee'}, interpolate:{label:'视频补帧',color:'#34d399'}, apiNode:{label:'API节点',color:'#6366f1'}, chatNode:{label:'AI聊天',color:'#22c55e'}, videoTrim:{label:'视频剪辑',color:'#f97316'},
  paidTextToImage:{label:'付费API·文生图',color:'#a855f7'},paidImageToImage:{label:'付费API·图生图',color:'#0ea5e9'},paidTextToVideo:{label:'付费API·文生视频',color:'#ec4899'},paidImageToVideo:{label:'付费API·图生视频',color:'#f43f5e'},paidCapability:{label:'付费扩展能力',color:'#14b8a6'},bailianTextToImage:{label:'文生图',color:'#ff7a45'},runningHubWorkflow:{label:'RunningHub 工作流',color:'#0ea5e9'},localWorkflow:{label:'本地工作流',color:'#0ea5e9'},
};

const INITIAL: AppNode[] = [];

interface Store {
  nodes: AppNode[]; edges: Edge[]; selectedNodeId: string | null; activeTool: ToolAction; projectName: string;
  history: HistorySnapshot[]; historyIndex: number;
  onNodesChange: (c: NodeChange[]) => void; onEdgesChange: (c: EdgeChange[]) => void; onConnect: (c: Connection) => void;
  deleteEdge: (id: string) => void;
  addNode: (t: NodeComponentType, p: {x:number;y:number}, d?: Partial<CanvasNodeData>) => string;
  updateNodeData: (id: string, d: Partial<CanvasNodeData>) => void;
  updateNodeStyle: (id: string, style: Record<string, unknown>) => void;
  setNodeConfig: (id: string, config: Record<string, unknown>) => void;
  executeNode: (id: string) => Promise<boolean>;
  enqueueNode: (id: string) => void;
  executeFromNode: (id: string) => Promise<void>;
  pauseNode: (id: string) => void;
  setNodeStatus: (id: string, status: NodeStatus, error?: string) => void;
  propagateData: (sourceId: string, outputName: string, value: unknown) => void;
  contextMenu: ContextMenuState;
  showContextMenu: (x: number, y: number, nodeId: string | null) => void;
  hideContextMenu: () => void;
  toggleNodeDisabled: (id: string) => void;
  toggleNodeLocked: (id: string) => void;
  toggleNodeHidden: (id: string) => void;
  clipboard: AppNode[] | null;
  copySelectedNodes: () => void;
  pasteNodesAt: (x: number, y: number) => void;
  setSelectedNodeId: (id: string | null) => void;
  alignSelectedNodes: (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeH' | 'distributeV') => void;
  groupSelectedNodes: () => void;
  ungroupSelected: () => void;

  setActiveTool: (t: ToolAction) => void;
  setProjectName: (n: string) => void;
  undo: () => void;
  redo: () => void;
  deleteSelectedNode: () => void;
  duplicateSelectedNode: () => void;
  clearCanvas: () => void;
  loadCanvas: (n: AppNode[], e: Edge[], opts?: { preserveEdgeType?: boolean }) => void;
  _pushHistory: () => void;
  promoteCanvasFiles: (nodes?: AppNode[]) => Promise<void>;
}

const runningControllers = new Map<string, AbortController>();

/** 付费生成结果自动下载到本地【永久素材目录】（不随 48h 缓存清理丢失），
 * 图片/视频/音频/3D 全部落盘（含多结果变体，每个 url 单独保存）；失败回退远程 URL */
export async function cachePaidMedia(url: string, outputKind: string): Promise<string> {
  if (outputKind === 'text' || !url) return url;
  // dataURL / 本地文件直接保留（已可访问且不依赖远端）；http(s) 下载到本地
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    // 关闭「自动保存」时下载到缓存目录（48h 自动清理）；开启时下载到永久素材目录
    const autoSave = useSettingsStore.getState().assetAutoSave !== false;
    const saved = await (window as any).electronAPI?.cacheMedia?.({ url, dir: autoSave ? 'assets' : undefined });
    if (saved?.url) return saved.url;
  } catch { /* 下载失败时回退远程 URL */ }
  return url;
}
const queuedTaskIds = new Set<string>();
// 按端口（服务器）分别排队：每台服务器一个独立队列 + 独立 worker（端内串行，端间并行）。
// 节点按 data.serverId 归队；未绑定端口的进默认队列。以后新增端口自动多一个队列。
const localExecutionQueues = new Map<string, string[]>();
const queueRunningSet = new Set<string>();
const queueKeyOf = (node: { data?: { serverId?: string } } | undefined): string => node?.data?.serverId || '__default__';
export const getRunningTaskCount = () => runningControllers.size;
export const getQueuedTaskIds = () => [...queuedTaskIds];

function snap(nodes: AppNode[], edges: Edge[]): HistorySnapshot {
  // 快照裁剪大字段（content 截断、results 限量），50 条历史在媒体多的画布上可省数 MB 内存
  const trimmed = JSON.parse(JSON.stringify(nodes)).map((n: any) => {
    if (typeof n?.data?.content === 'string' && n.data.content.length > 2000) n.data.content = n.data.content.slice(0, 2000);
    if (Array.isArray(n?.data?.results) && n.data.results.length > 20) n.data.results = n.data.results.slice(0, 20);
    return n;
  });
  return { nodes: trimmed, edges: JSON.parse(JSON.stringify(edges)) };
}

function migrateNodes(nodes: AppNode[]): AppNode[] {
  return nodes.map(node => {
    if (node.data.nodeType === 'preview' && node.data.config?.assetUrl) {
      return { ...node, type:'asset', data:{...node.data,nodeType:'asset'} } as AppNode;
    }
    if (node.data.nodeType === 'preview' && node.style?.width == null && node.style?.height == null) {
      return { ...node, style:{...node.style,width:240,height:180} } as AppNode;
    }
    return node;
  });
}

export const useCanvasStore = create<Store>((set, get) => ({
  nodes: INITIAL, edges: [], selectedNodeId: null, clipboard: null as AppNode[] | null, activeTool: 'select', projectName: '未命名项目',
  history: [snap(INITIAL, [])], historyIndex: 0,

  promoteCanvasFiles: async (nodesArg) => {
    // 把画布中引用「缓存目录」的 file:// 结果复制到永久素材目录（不随 48h 缓存清理丢失），并更新节点引用
    try {
      const list = nodesArg ?? get().nodes;
      const candidates: Array<{ nodeId: string; url: string }> = [];
      list.forEach(n => {
        const d = n.data as any;
        const urls: string[] = [];
        if (typeof d?.resultUrl === 'string') urls.push(d.resultUrl);
        if (Array.isArray(d?.results)) urls.push(...d.results.map((r: any) => r?.url).filter(Boolean));
        Object.values(d?.outputValues || {}).forEach(v => { if (typeof v === 'string' && /^file:/.test(v)) urls.push(v); });
        urls.filter((u, idx, arr) => u.startsWith('file://') && arr.indexOf(u) === idx).forEach(url => candidates.push({ nodeId: n.id, url }));
      });
      if (!candidates.length) return;
      for (const c of candidates) {
        try {
          const saved = await (window as any).electronAPI?.promoteCache?.({ url: c.url });
          if (saved?.url && saved.url !== c.url) {
            const replace = (v: unknown): unknown => typeof v === 'string' && v === c.url ? saved.url : v;
            get().updateNodeData(c.nodeId, {
              resultUrl: replace((get().nodes.find(n => n.id === c.nodeId)?.data as any)?.resultUrl),
              outputValues: Object.fromEntries(Object.entries((get().nodes.find(n => n.id === c.nodeId)?.data as any)?.outputValues || {}).map(([k, v]) => [k, replace(v)])),
              results: ((get().nodes.find(n => n.id === c.nodeId)?.data as any)?.results || []).map((r: any) => ({ ...r, url: replace(r.url) })),
            } as any);
          }
        } catch { /* 缓存提升失败（非 cache 目录文件等）保持原样 */ }
      }
    } catch { /* ignore */ }
  },
  _pushHistory: () => {
    const s = get(); const ns = snap(s.nodes, s.edges);
    const h = s.history.slice(0, s.historyIndex + 1); h.push(ns); if (h.length > 50) h.shift();
    set({ history: h, historyIndex: h.length - 1 });
  },

  undo: () => { const { historyIndex: i, history: h } = get(); if (i <= 0) return; const s = h[i - 1]; set({ nodes: JSON.parse(JSON.stringify(s.nodes)), edges: JSON.parse(JSON.stringify(s.edges)), historyIndex: i - 1, selectedNodeId: null }); },
  redo: () => { const { historyIndex: i, history: h } = get(); if (i >= h.length - 1) return; const s = h[i + 1]; set({ nodes: JSON.parse(JSON.stringify(s.nodes)), edges: JSON.parse(JSON.stringify(s.edges)), historyIndex: i + 1, selectedNodeId: null }); },

  onNodesChange: (c) => {
    // locked 节点不可拖动：过滤 position/dimensions 变化（keep draggable 由 CSS 处理，避免每次 nodes 变化全量 map 展开）
    const current = get().nodes;
    const locked = new Set(current.filter(n => n.data?.locked).map(n => n.id));
    if (locked.size) {
      c = c.filter(ch => {
        const id = (ch as { id?: string }).id;
        if (id == null) return true; // add 等无 id 的变化不过滤
        return !locked.has(id) || (ch.type !== 'position' && ch.type !== 'dimensions');
      });
    }
    set({ nodes: applyNodeChanges(c, current) as AppNode[] });
    if (c.some(x => x.type === 'remove' || x.type === 'add')) get()._pushHistory();
  },
  onEdgesChange: (c) => { set({ edges: applyEdgeChanges(c, get().edges) }); if (c.some(x => x.type === 'remove')) get()._pushHistory(); },
  deleteEdge: (id) => {
    const edge=get().edges.find(item=>item.id===id);const remaining=get().edges.filter(item=>item.id!==id);
    let nodes=get().nodes;
    if(edge?.target&&edge.targetHandle&&!remaining.some(item=>item.target===edge.target&&item.targetHandle===edge.targetHandle)) {
      nodes=nodes.map(node=>{if(node.id!==edge.target)return node;const inputValues={...node.data.inputValues};delete inputValues[edge.targetHandle!];return {...node,data:{...node.data,inputValues}}});
    }
    // 输入被移除 → 下游已生成的结果作废，状态重置为 idle（避免"成功但输入已变"的假象）
    if (edge?.target) {
      nodes = nodes.map(node => node.id === edge.target && node.data.status === 'success' ? { ...node, data: { ...node.data, status: 'idle', content: '' } } : node);
    }
    set({edges:remaining,nodes});get()._pushHistory();
  },

  onConnect: (c) => {
    const source = get().nodes.find(n=>n.id===c.source);
    const target = get().nodes.find(n=>n.id===c.target);
    if (source && target) {
      if (c.source === c.target) { message.warning('不能连接到节点自身'); return; }
      // 端口类型校验：静态 + 动态端口（apiNode/_apiFields、localWorkflow/workflowPorts）都校验；查不到类型才跳过
      const sPortType = getDynamicPortType(source, c.sourceHandle, true);
      const tPortType = getDynamicPortType(target, c.targetHandle, false);
      if (sPortType && tPortType && String(sPortType) !== String(tPortType) && String(sPortType) !== 'media' && String(tPortType) !== 'media') {
        message.warning(`端口类型不匹配：${source.data.label}「${sPortType}」→ ${target.data.label}「${tPortType}」，已取消连线`);
        return;
      }
      // 同一输入端口重复连线：移除旧连接，避免 inputValues 互相覆盖
      const dup = get().edges.find(e => e.target === c.target && e.targetHandle === c.targetHandle && e.source !== c.source);
      if (dup) set({ edges: get().edges.filter(e => e.id !== dup.id) });
    }
    // 连线颜色按端口数据类型区分（与连接点一致）；查不到类型时回退到源节点色
    const sPortType = source ? getDynamicPortType(source, c.sourceHandle, true) : undefined;
    const edgeColor = sPortType ? portTypeColor(sPortType) : (source?.data.color || '#7c6df2');
    const edge = { ...c, id: `e-${c.source}-${c.target}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type:'deletable', className: `edge--${String(sPortType || 'default')}`, animated: true, style: { stroke: edgeColor, strokeWidth: 2.2 } } as Edge;
    const sourceValues=source?.data.outputValues||{};
    const sourceKey=c.sourceHandle||''; const targetKey=c.targetHandle||sourceKey||'input';
    const scriptId=sourceKey.startsWith('script-')?sourceKey.slice(7):'';
    const scriptValue=scriptId?((source?.data.config?.scripts as Array<{id:string;text:string}>)||[]).find(item=>item.id===scriptId)?.text:undefined;
    const configValue=sourceKey?(source?.data.config?.[sourceKey]??(typeof source?.data.config?.text==='string'?source.data.config.text:undefined)):undefined;
    const resultIndex = sourceKey.match(/^result-(\d+)$/)?.[1];
     const resultValue = resultIndex != null ? (source?.data.results?.[Number(resultIndex)] as any)?.url : undefined;
     const directValue=sourceKey&&sourceKey in sourceValues?sourceValues[sourceKey]:resultValue??scriptValue??configValue??sourceValues.output??sourceValues.url??sourceValues.image??sourceValues.video??sourceValues.audio??sourceValues.text;
    if (source?.data?.nodeType === 'textInput' || (target?.data?.nodeType === 'apiNode' || target?.data?.nodeType === 'localWorkflow')) {
      try { const logs = (window as any).__submitLogs || []; logs.push({ t: Date.now(), kind: 'connect', src: source?.data?.nodeType, srcCfg: JSON.stringify(source?.data?.config || {}).slice(0, 300), target: target?.data?.nodeType, sourceKey, targetKey, directValue: String(directValue ?? '').slice(0, 120) }); (window as any).__submitLogs = logs.slice(-30); } catch { /* ignore */ }
    }
    const nodes = get().nodes.map(n=>n.id===target?.id?{...n,data:{...n.data,inputValues:{...n.data.inputValues,
      ...(c.targetHandle?{[targetKey]:directValue}:sourceValues),...(source?.data.results?{results:source.data.results}:{})}}}:n);
    set({ edges: [...get().edges, edge], nodes });
    get()._pushHistory();
  },

  addNode: (t, p, d) => {
    const now = Date.now(); const nd = NODE_DEFAULTS[t];
    const defaults: Record<string, Record<string,unknown>> = {
      imageGeneration: { workflow_id: 'Z-image-Nunchaku\u52a0\u901f\u6587\u751f\u56fe', text: '', width: 768, height: 1136, steps: 15, cfg: 1.5, seed: -1, batch_size: 1 },
      imageToImage: { prompt: '', strength: 0.7 },
      videoGeneration: { prompt: '', duration: 5 },
      textInput: { text: '' },
      scriptInput: { scripts: [{id:generateId(),label:'场景 1',text:''}] },
      sceneSettings: { era:'', time:'', location:'', scene:'', style:'', camera:'', notes:'' },
      compare: {},
      asset: {},
      preview: {},
      storyboardPrompt: { script:'',personCount:2,sceneCount:2,personNotes:{},sceneNotes:{},segmentCount:3,segmentRule:'每段 5 秒',totalDuration:15,inheritPrevious:'true',effects:'',customRequirements:'',systemPrompt:'' },
      cinematographyKnowledge: { selectedEffectIds:[],customTerms:[],presetName:'' },
      imageCrop: { x: 0, y: 0, width: 512, height: 512, aspectRatio: '1:1' },
      inpaint: { prompt: '', brushSize: 24 },
      interpolate: { fps: 60 },
      paidTextToImage: { prompt:'', model:'', aspectRatio:'1:1', width:1024, height:1024 },
      paidImageToImage: { prompt:'', model:'', aspectRatio:'1:1', width:1024, height:1024 },
      paidTextToVideo: { prompt:'', model:'', aspectRatio:'16:9', width:1280, height:720, duration:5, cameraMotion:'' },
      paidImageToVideo: { prompt:'', model:'', aspectRatio:'16:9', width:1280, height:720, duration:5, cameraMotion:'' },
      paidCapability: { capability:'image-upscale', prompt:'', model:'' },
      bailianTextToImage: { prompt:'', ratio:'1:1', resolution:1024, seed:-1 },
      chatNode: { message: '', memory: true, historyLimit: 20, history: [] },
      videoTrim: { startFrame: 0, endFrame: 0, fps: 30 },
    };
    let dynCfg = defaults[t];
    if (!dynCfg) { const e = NODE_MAP.get(t); if (e) dynCfg = { ...e.defaultParams }; else dynCfg = {}; }
    const initialStyle = t === 'preview' ? { width: 240, height: 180 } : t === 'compare' ? {width:460,height:260} : t === 'chatNode' ? {width:520,height:620,minWidth:420,minHeight:420} : t === 'storyboardPrompt' ? {width:680,minWidth:620} : t === 'cinematographyKnowledge' ? {width:520,minWidth:420} : undefined;
    const nodeId=generateId();
    // 自动绑定当前激活服务器端口（用户可再手动改；显式传入的 serverId 优先）
    const settings = useSettingsStore.getState();
    const autoServerId = d?.serverId ?? settings.activeServerId ?? settings.servers[0]?.id ?? undefined;
    set({ nodes: [...get().nodes, { id: nodeId, type: t, position: p, style: initialStyle,
      data: { label: nd.label, content: '', color: nd.color, nodeType: t,
        config: dynCfg, inputValues: {}, outputValues: {}, status: 'idle',
        serverId: autoServerId, createdAt: now, updatedAt: now, ...d } } as AppNode] });
    get()._pushHistory();
    return nodeId;
  },

  updateNodeData: (id, d) => set({ nodes: get().nodes.map(n => {
    if (n.id !== id) return n;
    const nextStatus = d.status;
    // 状态切换为 success/error 时播放完成提示音（仅在真正发生变更时，避免重复渲染误触发）。
    if ((nextStatus === 'success' || nextStatus === 'error') && n.data.status !== nextStatus) playNodeDoneSound();
    return { ...n, data: { ...n.data, ...d, inputValues: d.inputValues ? { ...(n.data.inputValues || {}), ...d.inputValues } : n.data.inputValues, updatedAt: Date.now() } };
  }) }),
  updateNodeStyle: (id, style) => set({ nodes: get().nodes.map(n => {
    if (n.id !== id) return n;
    const next = { ...n, style: { ...n.style, ...style } };
    // React Flow 的外层用 measured/width/height 决定节点盒子；同步更新它，否则自动高度/手动缩放不会反映到节点盒子上。
    // 传入 height/width 为 undefined 时清空固定尺寸，让 React Flow 回退到 DOM 内容原生测量（用于自动高度）。
    const clearH = style.height == null;
    const clearW = style.width == null;
    if (clearH || clearW) {
      const m = { ...(next.measured || {}) };
      const st = { ...next.style };
      if (clearH) { delete next.height; delete next.initialHeight; delete m.height; delete st.height; }
      if (clearW) { delete next.width; delete next.initialWidth; delete m.width; delete st.width; }
      next.measured = m;
      next.style = st;
    } else {
      const w = Number(style.width);
      const h = Number(style.height);
      next.measured = { ...(next.measured || {}), ...(style.width != null ? { width: w } : {}), ...(style.height != null ? { height: h } : {}) };
      // React Flow 外层盒子的最终尺寸取自 node.width/node.height 顶层字段，必须同步。
      if (style.width != null) next.width = w;
      if (style.height != null) next.height = h;
    }
    return next;
  }) as AppNode[] }),

  deleteSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    const targets = nodes.filter(n => n.selected).map(n => n.id);
    if (!targets.length && selectedNodeId) targets.push(selectedNodeId);
    if (!targets.length) return;
    const allTargets = new Set<string>(targets);
    let grew = true;
    while (grew) { grew = false; nodes.forEach(n => { if (n.parentId && allTargets.has(n.parentId) && !allTargets.has(n.id)) { allTargets.add(n.id); grew = true; } }); }
    set({ nodes: nodes.filter(n => !allTargets.has(n.id)), edges: get().edges.filter(e => !allTargets.has(e.source) && !allTargets.has(e.target)), selectedNodeId: null });
    get()._pushHistory();
  },

  duplicateSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    const targets = nodes.filter(n => n.selected);
    if (!targets.length && selectedNodeId) { const n = nodes.find(x => x.id === selectedNodeId); if (n) targets.push(n); }
    if (!targets.length) return;
    const dupIdMap = new Map<string, string>();
    targets.forEach(n => dupIdMap.set(n.id, generateId()));
    const dups = targets.map(n => { const base = JSON.parse(JSON.stringify(n)) as AppNode; const newId = dupIdMap.get(n.id)!; return { ...base, id: newId, position: { x: n.position.x + 50, y: n.position.y + 50 }, selected: false, parentId: n.parentId ? (dupIdMap.get(n.parentId) || n.parentId) : undefined, data: { ...base.data, label: base.data.label + ' (副本)', createdAt: Date.now(), updatedAt: Date.now() } } as AppNode; });
    // 同步复制选中节点之间的连线（与 pasteNodesAt 行为一致），避免复制出"孤岛"节点
    const newEdges = get().edges.filter(e => dupIdMap.has(e.source) && dupIdMap.has(e.target)).map(e => ({ ...e, id: generateId(), source: dupIdMap.get(e.source)!, target: dupIdMap.get(e.target)! }));
    set({ nodes: [...nodes, ...dups], edges: [...get().edges, ...newEdges], selectedNodeId: dups[0].id }); get()._pushHistory();
  },

  copySelectedNodes: () => {
    const targets = get().nodes.filter(n => n.selected);
    if (!targets.length && get().selectedNodeId) { const n = get().nodes.find(x => x.id === get().selectedNodeId); if (n) targets.push(n); }
    if (!targets.length) return;
    set({ clipboard: targets.map(n => JSON.parse(JSON.stringify(n)) as AppNode) });
  },
  pasteNodesAt: (x: number, y: number) => {
    const { clipboard } = get();
    if (!clipboard?.length) return;
    const minX = Math.min(...clipboard.map(n => n.position.x));
    const minY = Math.min(...clipboard.map(n => n.position.y));
    const idMap = new Map<string, string>();
    clipboard.forEach(n => idMap.set(n.id, generateId()));
    const pasted = clipboard.map(n => { const newId = idMap.get(n.id)!; const base = JSON.parse(JSON.stringify(n)) as AppNode; return { ...base, id: newId, position: { x: x + (n.position.x - minX) + 20, y: y + (n.position.y - minY) + 20 }, selected: true, parentId: n.parentId ? (idMap.get(n.parentId) || undefined) : undefined, data: { ...base.data, label: base.data.label, createdAt: Date.now(), updatedAt: Date.now() } } as AppNode; });
    const newEdges = get().edges.filter(e => idMap.has(e.source) && idMap.has(e.target)).map(e => ({ ...e, id: generateId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));
    set({ nodes: [...get().nodes.map(n => ({ ...n, selected: false })), ...pasted], edges: [...get().edges, ...newEdges], selectedNodeId: pasted[0].id });
    get()._pushHistory();
  },
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  alignSelectedNodes: (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeH' | 'distributeV') => {
    const { nodes } = get();
    const sel = nodes.filter(n => n.selected);
    if (sel.length < 2) return;
    const w = (n: AppNode) => Number(n.measured?.width ?? n.style?.width ?? 200);
    const h = (n: AppNode) => Number(n.measured?.height ?? n.style?.height ?? 80);
    const x0 = Math.min(...sel.map(n => n.position.x));
    const x1 = Math.max(...sel.map(n => n.position.x + w(n)));
    const y0 = Math.min(...sel.map(n => n.position.y));
    const y1 = Math.max(...sel.map(n => n.position.y + h(n)));
    const cx = x0 + (x1 - x0) / 2;
    const cy = y0 + (y1 - y0) / 2;
    const next = nodes.map(n => {
      if (!n.selected) return n;
      const p = { ...n.position };
      const nw = w(n); const nh = h(n);
      if (mode === 'left') p.x = x0;
      else if (mode === 'centerX') p.x = cx - nw / 2;
      else if (mode === 'right') p.x = x1 - nw;
      else if (mode === 'top') p.y = y0;
      else if (mode === 'centerY') p.y = cy - nh / 2;
      else if (mode === 'bottom') p.y = y1 - nh;
      return { ...n, position: p };
    });
    let updated = next;
    if (mode === 'distributeH' || mode === 'distributeV') {
      const sorted = [...sel].sort((a, b) => mode === 'distributeH' ? a.position.x - b.position.x : a.position.y - b.position.y);
      const total = sorted.reduce((s, n) => s + (mode === 'distributeH' ? w(n) : h(n)), 0);
      const span = mode === 'distributeH' ? (x1 - x0) : (y1 - y0);
      const gap = sorted.length > 1 ? (span - total) / (sorted.length - 1) : 0;
      const posMap = new Map<string, { x: number; y: number }>();
      let cursor = 0;
      for (const n of sorted) {
        posMap.set(n.id, mode === 'distributeH' ? { x: x0 + cursor, y: n.position.y } : { x: n.position.x, y: y0 + cursor });
        cursor += (mode === 'distributeH' ? w(n) : h(n)) + gap;
      }
      updated = nodes.map(n => n.selected && posMap.has(n.id) ? { ...n, position: posMap.get(n.id)! } : n);
    }
    set({ nodes: updated });
    get()._pushHistory();
  },

  groupSelectedNodes: () => {
    const { nodes } = get();
    const sel = nodes.filter(n => n.selected);
    if (sel.length < 2) return;
    const w = (n: AppNode) => Number(n.measured?.width ?? n.style?.width ?? 200);
    const h = (n: AppNode) => Number(n.measured?.height ?? n.style?.height ?? 80);
    const pad = 24;
    const x0 = Math.min(...sel.map(n => n.position.x)) - pad;
    const y0 = Math.min(...sel.map(n => n.position.y)) - pad;
    const x1 = Math.max(...sel.map(n => n.position.x + w(n))) + pad;
    const y1 = Math.max(...sel.map(n => n.position.y + h(n))) + pad;
    const frameId = generateId();
    const frame = {
      id: frameId, type: 'frame', position: { x: x0, y: y0 }, selected: true,
      style: { width: Math.max(200, x1 - x0), height: Math.max(120, y1 - y0) },
      data: { label: '分组', color: '#7c6df2', nodeType: 'frame', config: {}, inputValues: {}, outputValues: {}, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() },
    } as AppNode;
    const children = nodes.map(n => {
      if (!n.selected) return n;
      return { ...n, parentId: frameId, extent: 'parent' as const, position: { x: n.position.x - x0, y: n.position.y - y0 }, selected: false };
    });
    set({ nodes: [...children, frame], selectedNodeId: frameId });
    get()._pushHistory();
  },

  ungroupSelected: () => {
    const { nodes } = get();
    const frames = nodes.filter(n => n.selected && n.type === 'frame');
    if (!frames.length) return;
    const frameIds = new Set(frames.map(f => f.id));
    const updated = nodes.flatMap(n => {
      if (frameIds.has(n.id)) return [];
      if (n.parentId && frameIds.has(n.parentId)) {
        const parent = nodes.find(f => f.id === n.parentId);
        return [{ ...n, parentId: undefined, extent: undefined, position: { x: n.position.x + (parent?.position.x || 0), y: n.position.y + (parent?.position.y || 0) } }];
      }
      return [n];
    }) as AppNode[];
    set({ nodes: updated, selectedNodeId: null });
    get()._pushHistory();
  },


  setActiveTool: (t) => set({ activeTool: t }),
  setProjectName: (n) => set({ projectName: n }),
  clearCanvas: () => { set({ nodes: [], edges: [], selectedNodeId: null }); get()._pushHistory(); },
  loadCanvas: (n, e, opts) => { queuedTaskIds.clear(); localExecutionQueues.clear(); queueRunningSet.clear(); runningControllers.forEach(ctrl => ctrl.abort()); runningControllers.clear(); const migrated=migrateNodes(n).map(node => (node.data.status === 'running' || node.data.status === 'queued') ? { ...node, data: { ...node.data, status: 'idle' as const, queuedAt: undefined, queueOrder: undefined } } : node); const smooth=opts?.preserveEdgeType ? e.map(edge=>({...edge})) : e.map(edge=>({...edge,type:'deletable'})); // 已有连线按端口数据类型自动校正颜色（与连接点一致），便于分辨数据流；查不到类型则保持原色
  const colorized=smooth.map(edge=>{const source=migrated.find(nn=>nn.id===edge.source);if(!source)return edge;const pt=getDynamicPortType(source,(edge.sourceHandle??null) as string|null,true);if(!pt)return edge;const color=portTypeColor(pt);const style={...(edge.style||{}),stroke:color};const markerEnd=edge.markerEnd?{...(typeof edge.markerEnd==='object'&&edge.markerEnd?edge.markerEnd:{}),color}:undefined;return {...edge,style,...(markerEnd?{markerEnd}:{})} as Edge;}); set({ nodes:migrated,edges:colorized,selectedNodeId:null,history:[snap(migrated,colorized)],historyIndex:0 }); void get().promoteCanvasFiles(migrated); },

  setNodeConfig: (id, partialConfig) => {
    const current = get().nodes.find(n => n.id === id);
    const nextConfig = { ...(current?.data.config || {}), ...partialConfig };
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, config: nextConfig, updatedAt: Date.now() } } : n) });
    window.dispatchEvent(new Event('ai-canvas-autosave-project'));
    if (current?.data.nodeType === 'sceneSettings') {
      get().propagateData(id, 'settings', Object.entries(nextConfig).filter(([,value]) => String(value).trim()).map(([key,value]) => `${key}: ${value}`).join('\n'));
    }
    // 控制面板修改提示词时，同步回上游文本节点，避免节点内文本与控制面板分叉。
    const promptKey = Object.keys(partialConfig).find(key => /^(text|prompt|positive_prompt|description|script)$/i.test(key));
    if (promptKey && typeof partialConfig[promptKey] === 'string') {
      const text = String(partialConfig[promptKey]);
      get().edges.filter(edge => edge.target === id).forEach(edge => {
        const source = get().nodes.find(n => n.id === edge.source);
        if (source?.data.nodeType === 'textInput') {
          set({ nodes: get().nodes.map(n => n.id === source.id ? { ...n, data: { ...n.data, config: { ...n.data.config, text }, outputValues: { ...n.data.outputValues, text }, updatedAt: Date.now() } } : n) });
          get().propagateData(source.id, 'text', text);
        }
      });
    }
  },

  setNodeStatus: (id, status, error) => {
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, status, error, updatedAt: Date.now() } } : n) });
    if (status === 'success' || status === 'error') playNodeDoneSound();
  },

  pauseNode: (id) => {
    const node = get().nodes.find(n => n.id === id);
    const promptId = node?.data.promptId;
    void cancelComfyTask(promptId, node?.data.serverId as string | undefined).catch(() => undefined);
    runningControllers.get(id)?.abort();
    runningControllers.delete(id);
    const q = localExecutionQueues.get(queueKeyOf(node)) || [];
    const queuedIndex = q.indexOf(id);
    if (queuedIndex >= 0) q.splice(queuedIndex, 1);
    if (!q.length) localExecutionQueues.delete(queueKeyOf(node));
    queuedTaskIds.delete(id);
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, status: 'paused', content: '已取消任务，已通知 ComfyUI 中断', error: undefined, updatedAt: Date.now() } } : n) });
  },

  enqueueNode: (id) => {
    const node = get().nodes.find(item => item.id === id);
    if (!node || node.data.disabled || node.data.status === 'running') return;
    // 付费 API 节点：按官方接口并发（不排队，厂商自行限流），各算各的
    if (node.data.nodeType.startsWith('paid')) {
      void get().executeNode(id).catch(() => {});
      return;
    }
    // 按端口（服务器）分队列：同一端口的任务排同一队（端内串行），不同端口并行执行
    const key = queueKeyOf(node);
    const q = localExecutionQueues.get(key) || [];
    if (q.includes(id)) return;
    q.push(id);
    localExecutionQueues.set(key, q);
    queuedTaskIds.add(id);
    get().updateNodeData(id, { status: 'idle', queuedAt: Date.now(), queueOrder: Date.now(), error: undefined, content: '已加入执行队列' });
    if (queueRunningSet.has(key)) return;
    queueRunningSet.add(key);
    void (async () => {
      try {
        // 每端口并发数 = concurrency（设置→性能，默认 3，最大 6）；端内按队列取任务，端间互不干扰
        const workerCount = Math.max(1, Math.min(useSettingsStore.getState().concurrency || 1, 6));
        const worker = async () => {
          while ((localExecutionQueues.get(key) || []).length) {
            const nextId = localExecutionQueues.get(key)!.shift()!;
            queuedTaskIds.delete(nextId);
            const current = get().nodes.find(item => item.id === nextId);
            if (!current || current.data.status === 'paused' || current.data.disabled) continue;
            get().updateNodeData(nextId, { queuedAt: undefined, queueOrder: undefined });
            await get().executeNode(nextId);
          }
        };
        await Promise.all(Array.from({ length: workerCount }, worker));
      } finally {
        queueRunningSet.delete(key);
        if (!(localExecutionQueues.get(key) || []).length) localExecutionQueues.delete(key);
      }
    })();
  },

  toggleNodeDisabled: (id) => {
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n) });
  },
  toggleNodeLocked: (id) => set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, locked: !n.data.locked } } : n) }),
  toggleNodeHidden: (id) => set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, hidden: !n.data.hidden } } : n) }),

  propagateData: (sourceId, outputName, value) => {
    const { edges, nodes } = get();
    const targets = edges.filter(e => e.source === sourceId).map(e => ({ edgeId: e.id, targetId: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }));
    set({
      nodes: nodes.map(n => {
        if (n.id === sourceId) {
          return { ...n, data: { ...n.data, outputValues: { ...n.data.outputValues, [outputName]: value } } };
        }
        const mediaNames=['image','video','audio','3d','media']; const matches = targets.filter(t => t.targetId === n.id && (outputName==='results'||!t.sourceHandle||t.sourceHandle === outputName || (outputName === 'output' && mediaNames.concat('input').includes(t.sourceHandle || '')) || (mediaNames.includes(outputName) && t.sourceHandle === 'output') || (outputName === 'text' && /(^|:)text|^text-/.test(t.sourceHandle || '')) || (outputName === 'settings' && /settings|scene/i.test(t.sourceHandle || ''))));
        if (matches.length) {
          const additions:Record<string,unknown>={};
          matches.forEach(match=>{ additions[match.targetHandle || outputName] = value; });
          // Keep the full result set and update the connected destination port.
          if (outputName === 'results') {
            additions.results = value;
            matches.forEach(match => {
              const targetKey = match.targetHandle || 'results';
              if (targetKey !== 'results') additions[targetKey] = Array.isArray(value) ? (value[0] as any)?.url : value;
            });
          }
          return { ...n, data: { ...n.data, inputValues: { ...n.data.inputValues, ...additions }, ...(outputName === 'results' ? { results: value as any, resultUrl: Array.isArray(value) ? value[0]?.url : undefined } : {}) } };
        }
        return n;
      }),
    });
  },

  executeNode: async (id) => {
    const node = get().nodes.find(n => n.id === id);
    if (!node || node.data.disabled || node.data.status === 'running') return false;
    const startedAt = Date.now();
    get().updateNodeData(id, { status:'running', error:undefined, generationStartedAt:startedAt, generationDurationMs:undefined, progress:0, currentNodeProgress:0, currentNodeId:undefined });
    const controller = new AbortController();
    runningControllers.set(id, controller);
    const config = node.data.config || {};
    const nt = node.data.nodeType;
    try {
      let workflow_id = '';
      const input_values: Record<string, unknown> = {};

      if (nt === 'runningHubWorkflow') {
        const rh = useSettingsStore.getState().runningHub;
        if (!rh.enabled || !rh.apiKey) throw new Error(`RunningHub 设置未就绪：${!rh.enabled ? '开关未启用' : ''}${!rh.enabled && !rh.apiKey ? '，' : ''}${!rh.apiKey ? 'API Key 为空' : ''}。请在“设置 → RunningHub 独立接入”中启用并保存。`);
        if (!/^https:\/\/www\.runninghub\.cn\/openapi\/v2$/i.test(String(rh.baseUrl).replace(/\/+$/, ''))) throw new Error(`RunningHub API 地址不符合当前官方标准：${rh.baseUrl}。应填写 https://www.runninghub.cn/openapi/v2`);
        Object.assign(input_values, node.data.inputValues || {});
        const contractForInputs = config.runningHubContract as { params?: Array<{ fieldKey: string; type?: string; description?: string }> } | undefined;
        // Numbered UI slots are an internal representation; collapse them into the official array field in slot order.
        for (const param of contractForInputs?.params || []) {
          if (!['IMAGE', 'VIDEO', 'AUDIO'].includes(String(param.type))) continue;
          const count = runningHubMediaSlotCount(param as any);
          if (count <= 1) continue;
          const values = Array.from({ length: count }, (_, index) => input_values[runningHubSlotKey(param.fieldKey, index)]).filter(value => value !== undefined && value !== null && value !== '');
          if (values.length) input_values[param.fieldKey] = values;
          for (let index = 0; index < count; index += 1) delete input_values[runningHubSlotKey(param.fieldKey, index)];
        }
        Object.entries(config).forEach(([key, value]) => {
          const isContractField = contractForInputs?.params?.some(param => param.fieldKey === key);
          const hasPortValue = input_values[key] !== undefined && input_values[key] !== null && input_values[key] !== '';
          // Every official input port wins over a local form value, not only media fields.
          if (value !== '' && value !== undefined && value !== null && !(isContractField && hasPortValue)) input_values[key] = value;
        });
        // Collapse slots again after merging node-local values; file picker values live in config slot keys.
        for (const param of contractForInputs?.params || []) {
          if (!['IMAGE', 'VIDEO', 'AUDIO'].includes(String(param.type))) continue;
          const count = runningHubMediaSlotCount(param as any);
          if (count <= 1) continue;
          const values = Array.from({ length: count }, (_, index) => input_values[runningHubSlotKey(param.fieldKey, index)]).filter(value => value !== undefined && value !== null && value !== '');
          if (values.length) input_values[param.fieldKey] = values;
          for (let index = 0; index < count; index += 1) delete input_values[runningHubSlotKey(param.fieldKey, index)];
        }
        const mode = String(config.executionMode || rh.executionMode) as 'standard-model' | 'comfy-workflow';
        await (window as any).electronAPI?.logRenderError?.({ type: 'runninghub-runtime', enabled: rh.enabled, baseUrl: String(rh.baseUrl).replace(/\/+$/, ''), hasApiKey: Boolean(rh.apiKey), mode, endpoint: String((config.runningHubContract as any)?.endpoint || config.endpoint || ''), fields: Object.fromEntries(Object.entries(input_values).map(([key, value]) => [key, { present: value !== undefined && value !== null && value !== '', arrayLength: Array.isArray(value) ? value.length : undefined, kind: typeof value === 'string' && /^data:|^https?:|^file:|^blob:/i.test(value) ? 'media-or-url' : typeof value }])) });
        if (mode === 'standard-model') {
          const requiredParams = (contractForInputs?.params || []).filter(param => (param as any).required === true);
          const missingFields = requiredParams.filter(param => {
            const value = input_values[param.fieldKey];
            if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null && item !== '').length === 0;
            return value === undefined || value === null || value === '';
          }).map(param => param.fieldKey);
          await (window as any).electronAPI?.logRenderError?.({ type: 'runninghub-required-missing', endpoint: String((config.runningHubContract as any)?.endpoint || ''), missing: missingFields });
        }
        if (mode === 'standard-model') {
          const requiredParams = (contractForInputs?.params || []).filter(param => (param as any).required === true);
          const missing = requiredParams.filter(param => {
            const value = input_values[param.fieldKey];
            if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null && item !== '').length === 0;
            return value === undefined || value === null || value === '';
          });
          if (missing.length) {
            const mediaMissing = missing.filter(param => ['IMAGE', 'VIDEO', 'AUDIO'].includes(String(param.type)));
            const otherMissing = missing.filter(param => !['IMAGE', 'VIDEO', 'AUDIO'].includes(String(param.type)));
            const detail = missing.map(param => `${param.fieldKey}${param.description ? `（${param.description}）` : ''}`).join('、');
            const guidance = mediaMissing.length && !otherMissing.length ? '请先执行上游媒体节点并连接到对应编号端口，或在节点内选择文件；仅有连线但上游没有生成结果时仍视为空。' : otherMissing.length && !mediaMissing.length ? '请在节点参数面板填写这些字段，或连接对应的文本/内容端口。' : '请补齐节点面板参数，并确认上游媒体节点已经生成结果。';
            throw new Error(`RunningHub 缺少官方必填参数：${detail}。${guidance}`);
          }
        }
        await (window as any).electronAPI?.logRenderError?.({ type: 'runninghub-pre-upload', mode, endpoint: String((config.runningHubContract as any)?.endpoint || config.endpoint || '') });
        const runningHubInputs = await prepareRunningHubInputs(input_values, (config.mediaFields && typeof config.mediaFields === 'object' ? config.mediaFields : undefined) as Record<string, string> | undefined);
        let results: ResultItem[];
        if (mode === 'standard-model') {
          const contract = config.runningHubContract as { endpoint?: string; params?: Array<{ fieldKey: string; multipleInputs?: boolean; type?: string }> } | undefined;
          if (!contract?.endpoint || !Array.isArray(contract.params)) throw new Error('标准模型节点缺少官方模型合同，请从 RunningHub 节点库重新添加');
          const endpoint = contract.endpoint;
          // Any media field the official schema marks as multipleInputs must be sent as an array,
          // even when only a single value is present (e.g. imageUrls: ["url"]).
          for (const param of contract.params) {
            if (param.multipleInputs && ['IMAGE', 'VIDEO', 'AUDIO'].includes(String(param.type)) && param.fieldKey in runningHubInputs) {
              const current = runningHubInputs[param.fieldKey];
              if (!Array.isArray(current)) runningHubInputs[param.fieldKey] = [current];
            }
          }
          const allowedFields = new Set(contract.params.map(param => param.fieldKey));
          const payload = Object.fromEntries(Object.entries(runningHubInputs).filter(([key]) => allowedFields.has(key)));
          delete (payload as any).workflowId; delete (payload as any).executionMode; delete (payload as any).endpoint; delete (payload as any).runningHubContract; delete (payload as any).runningHubClassName; delete (payload as any).mediaFields;
          const task = await createStandardTask(endpoint, payload);
          get().updateNodeData(id, { promptId: task.taskId });
          results = await waitRunningHubTask(task, (content, progress) => get().updateNodeData(id, { content, progress, generationDurationMs: Date.now() - startedAt }), controller.signal);
        } else {
          const workflowId = String(config.workflowId || rh.defaultWorkflowId || '');
          const nodeInfoList = Object.entries(runningHubInputs).filter(([key, value]) => value !== undefined && value !== null && value !== '').map(([fieldName, value]) => ({ nodeId: String(config.nodeId || '0'), fieldName, fieldValue: String(value) }));
          const task = await createComfyWorkflowTask(workflowId, nodeInfoList, config.workflow);
          get().updateNodeData(id, { promptId: task.taskId });
          results = await waitRunningHubTask(task, (content, progress) => get().updateNodeData(id, { content, progress, generationDurationMs: Date.now() - startedAt }), controller.signal);
        }
        if (!results.length) throw new Error('RunningHub 任务完成，但没有返回结果');
        const first = results[0];
        const outputValues: Record<string, unknown> = { results, output: first.url, url: first.url };
        results.forEach(item => { if (!outputValues[item.type]) outputValues[item.type] = item.url; });
        get().updateNodeData(id, { resultUrl: first.url, results, outputValues, content: `RunningHub 完成 · ${results.length} 个结果`, progress: 100, generationDurationMs: Date.now() - startedAt });
        results.forEach(item => get().propagateData(id, item.type, item.url));
        if (mode === 'standard-model' && runningHubOptionalOutputs(config.runningHubContract as any).some(output => output.id === 'lastFrame') && Boolean(input_values.returnLastFrame)) {
          const lastFrame = results.find(item => item.type === 'image' && item.url !== first.url);
          if (lastFrame) get().propagateData(id, 'lastFrame', lastFrame.url);
        }
        get().propagateData(id, 'results', results);
        get().setNodeStatus(id, 'success'); runningControllers.delete(id);
        addGenerationHistory({ id: id + '-' + Date.now(), nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl: first.url, results, status: 'success', timestamp: Date.now() });
        autoSaveToAssets(first.url, results, node.data.label);
        return true;
      } else if (nt === 'interpolate') {
        const input = String(node.data.inputValues?.video || node.data.inputValues?.url || config.videoUrl || config.assetUrl || node.data.resultUrl || '');
        if (!input) throw new Error('请先连接或选择视频');
        const fps = Math.max(24, Math.min(120, Number(config.fps) || 60));
        const result = await (window as any).electronAPI?.ffmpegInterpolate?.({ input, fps });
        if (!result?.url) throw new Error('补帧失败，请确认 Electron 桌面版和 FFmpeg 可用');
        const results = [{ type: 'video' as const, url: result.url, filename: 'interpolated.mp4' }];
        get().updateNodeData(id, { outputValues: { video: result.url, results }, results, resultUrl: result.url, status: 'success', progress: 100, content: `补帧完成 · ${result.fps || fps} FPS`, generationDurationMs: Date.now() - startedAt });
        get().propagateData(id, 'video', result.url);
        get().propagateData(id, 'results', results);
        addGenerationHistory({ id: `interpolate-${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label || '视频补帧', nodeType: 'interpolate', params: { fps }, resultUrl: result.url, results, status: 'success', timestamp: Date.now() });
        runningControllers.delete(id);
        return true;
      } else if (nt === 'imageCrop' || nt === 'videoTrim' || nt === 'reroute' || nt === 'note' || nt === 'frame') {
        // 本地工具节点：无后端执行步骤，直接标记完成
        get().updateNodeData(id, { status: 'success', progress: 100, content: '本地节点（无执行步骤）' });
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'cinematographyKnowledge') {
        const ids = Array.isArray(config.selectedEffectIds) ? config.selectedEffectIds.map(String) : [];
        const search = String(config.search || '').trim().toLowerCase();
        const selected = search ? CINEMATOGRAPHY_EFFECTS.filter(e=>e.term.toLowerCase().includes(search)).map(e=>e.id) : ids;
        const result = formatEffects([...new Set([...ids,...selected])]);
        const custom = Array.isArray(config.customTerms) ? config.customTerms.map(String).filter(Boolean) : String(config.customTerms||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
        const output = { ...result, promptText: [result.promptText,...custom].filter(Boolean).join('、') };
        get().updateNodeData(id,{outputValues:output,content:output.promptText||'未选择效果',results:[{type:'text',url:output.promptText}],status:'success'});
        Object.entries(output).forEach(([key,value])=>get().propagateData(id,key,value));
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'storyboardPrompt') {
        const requestVersion = `${id}-${startedAt}`;
        get().updateNodeData(id,{content:'正在请求分镜 AI…',config:{...config,_requestVersion:requestVersion}});
        const sourceEdges = get().edges.filter(e=>e.target===id);
        const sourceNodes = sourceEdges.map(e=>get().nodes.find(n=>n.id===e.source)).filter(Boolean) as AppNode[];
        const upstreamText = sourceEdges.map(edge=>{const source=get().nodes.find(n=>n.id===edge.source);const value=source?.data.outputValues?.text||source?.data.outputValues?.script||source?.data.config?.text||'';return edge.targetHandle==='customRequirements'?`专业修改输入：${String(value)}`:String(value);}).filter(Boolean).join('\n');
        const personNotes=(config.personNotes||{}) as Record<string,string>; const sceneNotes=(config.sceneNotes||{}) as Record<string,string>;
        const imageContext = sourceEdges.flatMap(edge=>{const source=get().nodes.find(n=>n.id===edge.source);const values=source?.data.results?.map(r=>r.url)||Object.values(source?.data.outputValues||{}).filter(v=>typeof v==='string'&&/^https?:\/\//i.test(v as string)) as string[];const handle=String(edge.targetHandle||'');const group=handle.startsWith('scene_')?'场景':'人物';const index=handle.match(/_(\d+)$/)?.[1]||'1';const note=(group==='场景'?sceneNotes[`scene_${index}`]:personNotes[`person_${index}`])||'';return values.map(url=>`${group}${index}${note?`（${note}）`:''}参考图：${url}`);});
        const effects=String(config.effects||sourceNodes.filter(n=>n.data.nodeType==='cinematographyKnowledge').map(n=>String(n.data.outputValues?.promptText||'')).filter(Boolean).join('、'));
        const result = await generateStoryboard({script:String(config.script||upstreamText),segmentCount:Number(config.segmentCount)||0,segmentRule:String(config.segmentRule||''),totalDuration:Number(config.totalDuration)||0,characterNotes:Object.entries(personNotes).map(([k,v])=>`${k}:${v}`).join('\n'),sceneNotes:Object.entries(sceneNotes).map(([k,v])=>`${k}:${v}`).join('\n'),effects,customRequirements:String(config.customRequirements||''),inheritPrevious:String(config.inheritPrevious)!=='false',systemPrompt:String(config.systemPrompt||''),imageContext},controller.signal);
        if (get().nodes.find(n=>n.id===id)?.data.config?._requestVersion !== requestVersion) { runningControllers.delete(id); return false; }
        const output:Record<string,unknown>={storyboard_list:JSON.stringify(result,null,2),error_warning:result.warnings.join('\n')};
        result.segments.forEach((segment,index)=>{const no=index+1;output[`segment_${no}_first_prompt`]=segment.firstFrame.prompt;output[`segment_${no}_last_prompt`]=segment.lastFrame.prompt;output[`segment_${no}_video_prompt`]=segment.videoPrompt;});
        get().updateNodeData(id,{outputValues:output,config:{...config,_segments:result.segments},content:`已生成 ${result.segments.length} 段分镜`,status:'success',generationDurationMs:Date.now()-startedAt});
        Object.entries(output).forEach(([key,value])=>get().propagateData(id,key,value));
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'imageGeneration') {
        workflow_id = (config.workflow_id as string) || 'Z-image-Nunchaku\u52a0\u901f\u6587\u751f\u56fe';
        const promptText = (config.text as string) || (node.data.inputValues?.text as string) || '';
        const w = (config.width as number) ?? 768;
        const h = (config.height as number) ?? 1136;
        const steps = (config.steps as number) ?? 15;
        const cfg = (config.cfg as number) ?? 1.5;
        const seed = (config.seed as number);
        input_values['93:text'] = promptText;
        input_values['94:width'] = w;
        input_values['94:height'] = h;
        input_values['94:batch_size'] = 1;
        input_values['95:filename_prefix'] = 'ai-canvas';
        input_values['99:seed'] = (seed && seed > 0) ? seed : Math.floor(Math.random() * 1e15);
        input_values['99:steps'] = steps;
        input_values['99:cfg'] = cfg;
      } else if (nt === 'zimageGen') {
        // Zimage uses same ComfyUI workflow as imageGeneration (Nunchaku)
        workflow_id = 'Z-image-Nunchaku\u52a0\u901f\u6587\u751f\u56fe';
        const promptText = (config.prompt as string) || (node.data.inputValues?.text as string) || '';
        const w = (config.width as number) ?? 768;
        const h = (config.height as number) ?? 1136;
        const steps = (config.steps as number) ?? 15;
        const cfg = (config.cfg as number) ?? 1.5;
        const seed = (config.seed as number);
        input_values['93:text'] = promptText;
        input_values['94:width'] = w;
        input_values['94:height'] = h;
        input_values['94:batch_size'] = 1;
        input_values['95:filename_prefix'] = 'ai-canvas';
        input_values['99:seed'] = (seed && seed > 0) ? seed : Math.floor(Math.random() * 1e15);
        input_values['99:steps'] = steps;
        input_values['99:cfg'] = cfg;
      } else if (nt === 'uploadNode') {
        // 标题执行按钮也支持批量文件；目录请直接拖入节点或点“选择文件夹”。
        const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
        input.accept = 'image/*,video/*,audio/*,.mp3,.wav,.mp4,.mov,.avi';
        const files = await new Promise<File[]>(resolve => {
          input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
          input.addEventListener('cancel', () => resolve([]), { once: true });
          input.click();
        });
        if (!files.length) { get().setNodeStatus(id, 'idle'); runningControllers.delete(id); return false; }
        const results: ResultItem[] = [];
        for (let index = 0; index < files.length; index++) {
          const file = files[index]; const filename = await uploadFile(file);
          const url = getApiBase() + '/api/comfy/view?filename=' + encodeURIComponent(filename) + '&type=input';
          results.push({ type: mediaTypeForFile(file), url, filename });
          get().updateNodeData(id, { progress: Math.round((index + 1) / files.length * 100), content: `正在上传 ${index + 1}/${files.length}` });
        }
        const first = results[0];
        const outputValues: Record<string, unknown> = { results, files: results, filename:first.filename, url:first.url };
        for (const type of ['image','video','audio'] as const) {
          const urls = results.filter(item => item.type === type).map(item => item.url);
          if (urls.length) { outputValues[type] = urls[0]; outputValues[`${type}s`] = urls; }
        }
        get().updateNodeData(id, { outputValues, results, resultUrl:first.url, content:`已读取 ${results.length} 个媒体文件` });
        Object.entries(outputValues).forEach(([key,value]) => get().propagateData(id,key,value));
        get().updateNodeData(id,{status:'success',generationDurationMs:Date.now()-startedAt});
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (['paidTextToImage','paidImageToImage','paidTextToVideo','paidImageToVideo','paidCapability','bailianTextToImage'].includes(nt)) {
        const paid = useSettingsStore.getState();
        const legacyCapability = nt === 'paidImageToImage' ? 'image-to-image' : nt === 'paidTextToVideo' ? 'text-to-video' : nt === 'paidImageToVideo' ? 'image-to-video' : 'text-to-image';
        const capability = String(config.capability || legacyCapability) as PaidCapability;
        const capabilityInfo = capability ? PAID_CAPABILITIES[capability] : undefined;
        const isVideo = capabilityInfo?.output === 'video';
        const outputKind = capabilityInfo?.output === 'audio' ? ('audio' as const) : capabilityInfo?.output === '3d' ? ('3d' as const) : isVideo ? ('video' as const) : ('image' as const);
        const needsImage = Boolean(capabilityInfo && capabilityInfo.input !== 'text');
        const providerRaw = String(config.provider || (nt === 'bailianTextToImage' ? 'bailian' : ''));
        // 节点未显式选厂商时：自动用第一个已配置 API Key 的厂商（避免默认 openai 但用户配的是别的）
        const configuredProvider = Object.entries((paid.paidApiProviders || {}) as Record<string, { apiKey?: string }>).find(([, p]) => p?.apiKey)?.[0] || '';
        const provider = providerRaw || configuredProvider;
        let profile = paid.paidApiProviders?.[provider as keyof typeof paid.paidApiProviders];
        // 回退：供应商配置为空时，尝试旧「付费 API 档案」或全局单供应商（打通旧面板 & 第三方自定义），避免"配置了但节点读不到"
        if (!profile?.apiKey) {
          const legacyMap: Record<string, string> = { custom: 'openaiCompatible', gateway: 'openaiCompatible', openai: 'openai', google: 'gemini', kling: 'kling', minimax: 'minimax', jimeng: 'volcengine', tongyi: 'bailian' };
          const prof = (paid.paidApiProfiles || []).find(p => p?.apiKey && (legacyMap[p.provider] === provider || p.provider === provider));
          if (prof) {
            profile = { provider: provider as any, apiKey: prof.apiKey, baseUrl: String(prof.baseUrl || ''), models: Array.isArray(prof.models) ? prof.models : [], selectedModel: String(prof.selectedModel || '') };
          } else if (String(paid.paidApiProvider) === provider && paid.paidApiKey) {
            profile = { provider: provider as any, apiKey: paid.paidApiKey, baseUrl: String(paid.paidApiBaseUrl || ''), models: Array.isArray(paid.paidApiModels) ? paid.paidApiModels : [], selectedModel: String(paid.paidApiSelectedModel || '') } as any;
          }
        }
        if (!provider || !profile?.apiKey) throw new Error(`请先在设置 → 付费 API 厂商配置中填写 API Key（当前节点厂商：${providerRaw || '未选择'}${configuredProvider ? `，已配置可用：${configuredProvider}` : ''}）`);
        const variants = Math.max(1, Math.min(8, Number(config.variants) || 1));
        const styleId = String(config.style || '');
        const styleSuffix = styleId ? (getAllStyles().find(x => x.id === styleId)?.suffix || '') : '';
        const cameraSuffix = cameraMotionPrompt(String(config.cameraMotion || ''));
        const rawPrompt = (String(config.prompt || node.data.inputValues?.prompt || node.data.inputValues?.text || '').trim()) + (styleSuffix ? `, ${styleSuffix}` : '') + (cameraSuffix ? `, ${cameraSuffix}` : '');
        if (!rawPrompt) throw new Error('请输入提示词，或连接文本节点到提示词输入端口');
        const imageUrl = String(node.data.inputValues?.image || node.data.inputValues?.firstImage || node.data.inputValues?.url || '');
        const lastImageUrl = String(node.data.inputValues?.lastImage || '');
        const videoUrl = String(node.data.inputValues?.video || '');
        const audioUrl = String(node.data.inputValues?.audio || '');
        if (capability === 'element-manage' || capability === 'voice-manage') {
          throw new Error('主体 / 音色管理请在节点内直接创建、查询和删除，无需在画布中执行任务');
        }
        if (capability === 'lipsync') {
          if (!videoUrl) throw new Error('对口型需要连接人物视频输入端口');
          if (!audioUrl) throw new Error('对口型需要连接音频输入端口');
        } else if (needsImage && !imageUrl) throw new Error('请连接图片输入端口，或拖入图片素材');
        if (capabilityInfo?.input === 'image-video' && capability !== 'lipsync' && !videoUrl) throw new Error('该节点还需要连接参考视频输入端口');
        const type = capability;
        const chosenModel = String(config.model || profile.selectedModel || (profile.models || [])[0] || '');
        if (!chosenModel) throw new Error('请选择当前厂商支持的模型');
        const outputKey = outputKind;
        const paidResults: Array<{ type: typeof outputKind; url: string }> = [];
        let firstUrl = '';
        for (let v = 0; v < variants; v++) {
          // 每次执行重新展开占位符 {a|b|c}，得到不同变体
          const prompt = expandPromptVariants(rawPrompt);
          const nodeCfg = (useSettingsStore.getState().paidApiNodes as any)?.[nt];
          const adapterAuthMode = getPaidAdapter(String(profile.provider))?.authMode;
          const result = await callPaidApi({ provider: profile.provider, apiKey: profile.apiKey, baseUrl: profile.baseUrl, model: String(config.model || profile.selectedModel || ''), region: profile.region, workspaceId: profile.workspaceId, authMode: nodeCfg?.authMode || adapterAuthMode, ...(nodeCfg?.imagePath ? { imagePath: nodeCfg.imagePath } : {}), ...(nodeCfg?.videoPath ? { videoPath: nodeCfg.videoPath } : {}), ...(nodeCfg?.taskPath ? { taskPath: nodeCfg.taskPath } : {}), ...(nodeCfg?.capabilityPath ? { capabilityPath: nodeCfg.capabilityPath } : {}) }, {
            type,
            prompt,
            negativePrompt: String(config.negativePrompt || config.negative_prompt || ''),
            imageUrl: needsImage ? imageUrl : undefined,
            images: (() => { const iv = node.data.inputValues || {}; return [iv.image, iv.image2, iv.image3, iv.image4, iv.image5, iv.image6, iv.image7, iv.image8].filter((x: unknown): x is string => typeof x === 'string' && !!x).slice(0, 10); })(),
            videos: (() => { const iv = node.data.inputValues || {}; return [iv.video, iv.video2, iv.video3].filter((x: unknown): x is string => typeof x === 'string' && !!x) || undefined; })(),
            audios: (() => { const iv = node.data.inputValues || {}; return [iv.audio, iv.audio2].filter((x: unknown): x is string => typeof x === 'string' && !!x) || undefined; })(),
            lastImageUrl: lastImageUrl || undefined,
            videoUrl: videoUrl || undefined,
            audioUrl: audioUrl || undefined,
            width: Number(config.width) || undefined,
            height: Number(config.height) || undefined,
            aspectRatio: String(config.aspectRatio || ''),
            resolution: isVideo ? Number(config.resolution) || undefined : undefined,
            duration: isVideo ? Number(config.duration) || 5 : undefined,
            frameRate: isVideo ? Number(config.frameRate) || 24 : undefined,
            seed: v > 0 && variants > 1 ? Math.floor(Math.random() * 1e15) : Number.isFinite(Number(config.seed)) ? Number(config.seed) : undefined,
            voiceId: String(config.voice_id || '') || undefined,
            cfgScale: typeof config.cfgScale === 'number' ? config.cfgScale : undefined,
            variants: 1,
          });
          if (!result.url) throw new Error('接口已返回成功状态，但未提供可访问的生成结果地址');
          // 图片/音频/3D 结果自动下载到本地缓存（Flux 等签名 URL 有效期短）；未主动保存 48 小时后由主进程清理
          const cachedUrl = await cachePaidMedia(result.url, outputKind);
          if (!firstUrl) firstUrl = cachedUrl;
          paidResults.push({ type: outputKind, url: cachedUrl });
          if (v < variants - 1 && variants > 1) get().updateNodeData(id, { content: `正在生成变体 ${v + 2}/${variants} · ${chosenModel}`, status: 'running' });
        }
        const outputValues: Record<string, unknown> = { [outputKey]: firstUrl, output: firstUrl };
        if (variants > 1) outputValues[`${outputKind}s`] = paidResults.map(r => r.url);
        get().updateNodeData(id, { resultUrl: firstUrl, outputValues, results: paidResults, content: `付费 API 生成完成 · ${chosenModel}${variants > 1 ? ` · ${variants} 个变体` : ''}`, status:'success' });
        get().propagateData(id, outputKey, firstUrl);
        get().propagateData(id, 'output', firstUrl);
        get().propagateData(id, 'results', paidResults);
        if (variants > 1) get().propagateData(id, `${outputKind}s`, paidResults.map(r => r.url));
        addGenerationHistory({ id: `${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl: firstUrl, results: paidResults, status: 'success', timestamp: Date.now() });
        autoSaveToAssets(firstUrl, paidResults, node.data.label);
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'storyboardRender') {
        // 分镜批量生成：解析分镜 JSON → 逐镜生成首帧图（付费文生图）
        const paidSettings = useSettingsStore.getState();
        const renderProvider = String(config.provider || '');
        const renderProfile = paidSettings.paidApiProviders?.[renderProvider as keyof typeof paidSettings.paidApiProviders];
        if (!renderProvider || !renderProfile?.apiKey) throw new Error('请先在设置 → 付费 API 厂商配置中填写当前厂商的 API Key');
        const renderModel = String(config.model || renderProfile.selectedModel || '');
        if (!renderModel) throw new Error('请选择当前厂商支持的模型');
        const variants = Math.max(1, Math.min(4, Number(config.variants) || 1));
        const useEnglish = config.useEnglish !== false;
        let segments: any[] = [];
        const rawScript = String(node.data.inputValues?.script || node.data.inputValues?.storyboard_list || config._segmentsJson || '');
        if (rawScript) {
          try { const parsed = JSON.parse(rawScript); segments = Array.isArray(parsed) ? parsed : parsed?.segments || []; }
          catch { throw new Error('分镜 JSON 解析失败，请连接剧情分镜节点的分镜列表输出'); }
        }
        if (!segments.length) throw new Error('未获取到分镜数据，请连接剧情分镜节点');
        const charNotes = String(config.characterNotes || '').trim();
        const generateVideo = config.generateVideo === true;
        const generateAudio = config.generateAudio === true;
        if (generateAudio && !paidSettings.paidApiProviders?.minimax?.apiKey) throw new Error('配音需要先配置 MiniMax API Key');
        let videoModel = '';
        if (generateVideo) {
          videoModel = String(config.videoModel || '');
          const videoModels = getPaidModelsForAdapter(renderProvider, 'image-to-video');
          if (!videoModel) videoModel = videoModels[0]?.id || '';
          if (!videoModel) throw new Error('当前厂商不支持图生视频，请切换厂商或关闭视频生成');
        }
        const results: Array<{ type: 'image' | 'video' | 'audio'; url: string; shot: number; label: string }> = [];
        const outputValues: Record<string, unknown> = {};
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const promptText = (useEnglish ? (seg?.firstFrame?.promptEn || seg?.firstFrame?.prompt || '') : (seg?.firstFrame?.prompt || '')) + (charNotes ? `。角色设定：${charNotes}` : '');
          if (!promptText) throw new Error(`第 ${i + 1} 镜没有可用的提示词`);
          const shotResults: string[] = [];
          for (let v = 0; v < variants; v++) {
            const prompt = expandPromptVariants(String(promptText));
            get().updateNodeData(id, { content: `正在生成第 ${i + 1}/${segments.length} 镜${variants > 1 ? ` · 变体 ${v + 1}/${variants}` : ''}`, status: 'running', progress: Math.round(((i * variants + v) / (segments.length * variants)) * 99) });
            const result = await callPaidApi({ provider: renderProfile.provider, apiKey: renderProfile.apiKey, baseUrl: renderProfile.baseUrl, model: renderModel, region: renderProfile.region, workspaceId: renderProfile.workspaceId, authMode: getPaidAdapter(String(renderProfile.provider))?.authMode }, {
              type: 'text-to-image', prompt,
            });
            if (!result.url) throw new Error(`第 ${i + 1} 镜没有返回结果`);
            const cachedUrl = await cachePaidMedia(result.url, 'image');
            shotResults.push(cachedUrl);
            results.push({ type: 'image', url: cachedUrl, shot: i + 1, label: `镜头 ${i + 1} · 变体 ${v + 1}` });
          }
          outputValues[`shot_${i + 1}_image`] = shotResults[0];
          outputValues[`shot_${i + 1}_images`] = shotResults;
          if (generateVideo) {
            const videoPrompt = (useEnglish ? (seg?.videoPromptEn || seg?.videoPrompt || '') : (seg?.videoPrompt || '')) || promptText;
            get().updateNodeData(id, { content: `正在生成第 ${i + 1}/${segments.length} 镜视频…`, status: 'running', progress: Math.min(99, Math.round(((i + 1) / segments.length) * 90 + 5)) });
            const vResult = await callPaidApi({ provider: renderProfile.provider, apiKey: renderProfile.apiKey, baseUrl: renderProfile.baseUrl, model: videoModel, region: renderProfile.region, workspaceId: renderProfile.workspaceId, authMode: getPaidAdapter(String(renderProfile.provider))?.authMode }, {
              type: 'image-to-video', imageUrl: shotResults[0], prompt: String(videoPrompt), duration: Number(seg?.duration) || 5,
            });
            if (!vResult.url) throw new Error(`第 ${i + 1} 镜视频没有返回结果`);
            const cachedVideo = await cachePaidMedia(vResult.url, 'video');
            outputValues[`shot_${i + 1}_video`] = cachedVideo;
            results.push({ type: 'video', url: cachedVideo, shot: i + 1, label: `镜头 ${i + 1} 视频` });
          }
          if (generateAudio) {
            const dialogue = String(seg?.dialogue || '').trim();
            if (dialogue) {
              const audioProfile = paidSettings.paidApiProviders?.minimax;
              get().updateNodeData(id, { content: `正在配音第 ${i + 1}/${segments.length} 镜…`, status: 'running', progress: Math.min(99, Math.round(((i + 1) / segments.length) * 90 + 5)) });
              const audioResult = await callPaidApi({ provider: 'minimax', apiKey: audioProfile?.apiKey || '', baseUrl: audioProfile?.baseUrl || 'https://api.minimaxi.com', model: 'speech-2.8-turbo', authMode: 'bearer' }, { type: 'text-to-speech', prompt: dialogue, voiceId: String(config.voiceId || 'female-tianmei') });
              if (audioResult.url) {
                const cachedAudio = await cachePaidMedia(audioResult.url, 'audio');
                outputValues[`shot_${i + 1}_audio`] = cachedAudio;
                results.push({ type: 'audio', url: cachedAudio, shot: i + 1, label: `镜头 ${i + 1} 配音` });
              }
            }
          }
        }
        outputValues.results = results;
        outputValues.images = results.map(r => r.url);
        get().updateNodeData(id, { resultUrl: results[0]?.url, outputValues, results, content: `分镜批量生成完成 · ${segments.length} 镜${generateVideo ? ' · 含视频' : ''}${generateAudio ? ' · 含配音' : ''}${variants > 1 ? ` × ${variants} 变体` : ''}`, status: 'success', progress: 100 });
        for (let i = 0; i < segments.length; i++) {
          get().propagateData(id, `shot_${i + 1}_image`, outputValues[`shot_${i + 1}_image`]);
          if (generateVideo) get().propagateData(id, `shot_${i + 1}_video`, outputValues[`shot_${i + 1}_video`]);
          if (generateAudio) get().propagateData(id, `shot_${i + 1}_audio`, outputValues[`shot_${i + 1}_audio`]);
        }
        get().propagateData(id, 'results', results);
        get().propagateData(id, 'images', outputValues.images);
        addGenerationHistory({ id: `${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl: results[0]?.url, results, status: 'success', timestamp: Date.now() });
        autoSaveToAssets(results[0]?.url, results, node.data.label);
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'timelineRender') {
        // 时间线合成：分镜视频 + 配音 → ffmpeg 合成成片
        const rawResults = node.data.inputValues?.results || node.data.results;
        const itemsList = Array.isArray(rawResults) ? rawResults as Array<{ type?: string; url?: string; shot?: number }> : [];
        if (!itemsList.length) throw new Error('请连接分镜批量生成节点的全部结果输出');
        const byShot = new Map<number, { video: string; audio: string }>();
        itemsList.forEach(r => {
          if (r.type === 'video' || r.type === 'audio') {
            const arr = byShot.get(Number(r.shot) || 0) || { video: '', audio: '' };
            if (r.type === 'video') arr.video = r.url || '';
            else if (r.type === 'audio') arr.audio = r.url || '';
            byShot.set(Number(r.shot) || 0, arr);
          }
        });
        const items = [...byShot.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => ({ video: v.video, audio: v.audio }));
        if (!items.length || items.some(i => !i.video)) throw new Error('没有可合成的视频片段（请先生成分镜视频）');
        get().updateNodeData(id, { content: `正在合成 ${items.length} 段成片（ffmpeg）…`, status: 'running', progress: 30 });
        const composed = await (window as any).electronAPI?.ffmpegCompose?.({ items });
        if (!composed?.url) throw new Error('合成失败，请确认 FFmpeg 可用（设置 → 视频剪辑）');
        get().updateNodeData(id, { resultUrl: composed.url, outputValues: { video: composed.url, output: composed.url, results: [{ type: 'video', url: composed.url }] }, results: [{ type: 'video', url: composed.url }], content: `成片合成完成 · ${items.length} 段`, status: 'success', progress: 100 });
        get().propagateData(id, 'video', composed.url);
        get().propagateData(id, 'output', composed.url);
        addGenerationHistory({ id: `${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl: composed.url, results: [{ type: 'video', url: composed.url }], status: 'success', timestamp: Date.now() });
        autoSaveToAssets(composed.url, [{ type: 'video', url: composed.url }], node.data.label);
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'chatNode') {
        const message = String(config.message || node.data.inputValues?.prompt || node.data.inputValues?.text || '').trim();
        const inputImage = String(node.data.inputValues?.image || '');
        const inputFile = String(node.data.inputValues?.file || node.data.inputValues?.video || node.data.inputValues?.audio || node.data.inputValues?.url || '');
        if (!message && !inputImage && !inputFile) throw new Error('请输入消息或连接图片/文件');
        const history = (Array.isArray(config.history) ? config.history : []) as ChatTurn[];
        const attachments = [...(Array.isArray(config.attachments) ? config.attachments : []), ...(inputImage ? [{ name: 'input-image', mimeType: 'image/*', url: inputImage }] : []), ...(inputFile ? [{ name: 'input-file', mimeType: 'application/octet-stream', url: inputFile }] : [])];
        const result = await sendChat(message || '请分析这个文件。', attachments, config.memory === false ? [] : history.slice(-Math.max(0, Number(config.historyLimit) || 20)), controller.signal, { model:String(config.selectedModel || '') || undefined, thinkingMode:(config.thinkingMode as any) || undefined });
        const nextHistory = [...history, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: result.text }];
        const image = result.text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/i)?.[0];
        const video = result.text.match(/https?:\/\/[^\s)]+\.(?:mp4|webm|mov)(?:\?[^\s)]*)?/i)?.[0];
        const outputValues: Record<string, unknown> = { text: result.text, output: result.text };
        if (image) outputValues.image = image;
        if (video) outputValues.video = video;
        get().updateNodeData(id, { content: result.text, outputValues, config: { ...config, history: nextHistory }, status: 'success', error: undefined });
        get().propagateData(id, 'text', result.text); get().propagateData(id, 'output', result.text);
        if (image) get().propagateData(id, 'image', image);
        if (video) get().propagateData(id, 'video', video);
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'downloadNode') {
        // 下载节点：从 input URL 下载
        const url = (config.url as string) || (node.data.inputValues?.url as string);
        if (!url) { get().setNodeStatus(id, 'error', '无输入URL'); runningControllers.delete(id); return false; }
        try {
          const a = document.createElement('a'); a.href = url; a.download = url.split('/').pop() || 'download';
          a.target = '_blank'; a.click();
          get().updateNodeData(id,{status:'success',generationDurationMs:Date.now()-startedAt});
          get().updateNodeData(id, { content: '下载已触发: ' + url.slice(-30) });
        } catch (e: any) { get().setNodeStatus(id, 'error', e.message); }
        return get().nodes.find(n => n.id === id)?.data.status !== 'error';
      } else if (nt === 'localWorkflow') {
        // 本地工作流节点：深拷贝 JSON → 用户参数覆盖 → 直连 ComfyUI /prompt → 轮询结果
        const wfJson = config.workflowJson as Record<string, any>;
        if (!wfJson || typeof wfJson !== 'object') { get().setNodeStatus(id, 'error', '未配置工作流 JSON（请在节点库「导入 JSON」或右侧面板配置）'); runningControllers.delete(id); return false; }
        const prompt = applyWorkflowParams(wfJson, (config.params || {}) as Record<string, unknown>);
        // 上游图片 → 上传到 ComfyUI → 填入 LoadImage 节点。
        // 端口 id 就是 ComfyUI 工作流节点 id（workflowPorts 生成），按端口 id 精确匹配 inputValues；兼容旧全局 image/url
        const imageInputIds = workflowImageInputs(wfJson);
        let imageMatched = false;
        for (const nid of imageInputIds) {
          const v = node.data.inputValues?.[nid];
          if (v && typeof v === 'string' && v) {
            const uploaded = await uploadImageToComfy(getApiBase(node.data.serverId), v);
            const targetNode = prompt[nid] as any;
            if (targetNode && targetNode.inputs) { targetNode.inputs.image = uploaded; imageMatched = true; }
          }
        }
        if (!imageMatched) {
          const upstreamImg = node.data.inputValues?.image || node.data.inputValues?.url;
          if (upstreamImg && imageInputIds.length) {
            const uploaded = await uploadImageToComfy(getApiBase(node.data.serverId), String(upstreamImg));
            const first = imageInputIds[0];
            const targetNode = prompt[first] as any;
            if (targetNode && targetNode.inputs) targetNode.inputs.image = uploaded;
          }
        }
        // 上游视频/音频 → 上传 ComfyUI → 填入 LoadVideo/VHS_LoadVideo/LoadAudio 节点（同样需要数组格式）
        for (const [nid, n] of Object.entries(prompt)) {
          const ins = (n as any)?.inputs || {};
          const ct = String((n as any)?.class_type || '');
          const vInput = node.data.inputValues?.[nid] || node.data.inputValues?.video;
          const aInput = node.data.inputValues?.[nid] || node.data.inputValues?.audio;
          if ((/^LoadVideo/i.test(ct) || /^VHS_LoadVideo/i.test(ct) || /^VHS_VideoLoad/i.test(ct)) && vInput && typeof vInput === 'string') {
            const uploaded = await uploadMediaToComfy(getApiBase(node.data.serverId), vInput, 'video');
            if (ins.video !== undefined || Object.keys(ins).some(k => /video/i.test(k))) {
              const key = Object.keys(ins).find(k => /video/i.test(k)) || 'video';
              ins[key] = uploaded;
            }
          } else if ((/^LoadAudio/i.test(ct) || /^VHS_LoadAudio/i.test(ct)) && aInput && typeof aInput === 'string') {
            const uploaded = await uploadMediaToComfy(getApiBase(node.data.serverId), aInput, 'audio');
            if (ins.audio !== undefined || Object.keys(ins).some(k => /audio/i.test(k))) {
              const key = Object.keys(ins).find(k => /audio/i.test(k)) || 'audio';
              ins[key] = uploaded;
            }
          }
        }
        // 上游文本 → 覆盖工作流的文本/prompt 参数（CLIPTextEncode 的 text / NunchakuSana 的 prompt 等）
        // 支持多个文本输入端口 text / text-1 / text-2 ...：按顺序覆盖工作流中非负向的 text/prompt 字段；
        // 负向字段（含 negative）用 inputValues.negative 单独覆盖。
        const textInputs: string[] = [];
        const collectText = (v: unknown) => { const s = String(v ?? '').trim(); if (s) textInputs.push(s); };
        collectText(node.data.inputValues?.text);
        collectText(node.data.inputValues?.prompt);
        for (let i = 1; i <= 8; i++) collectText(node.data.inputValues?.[`text-${i}`]);
        const upstreamNeg = String(node.data.inputValues?.negative || '').trim();
        if (textInputs.length) {
          let ti = 0; // 已使用的文本输入序号
          // 收集所有可覆盖的正向提示词字段（text/prompt/value），负向字段用 inputValues.negative 单独覆盖
          const targets: Array<{ node: any; field: string }> = [];
          Object.entries(prompt).forEach(([, n]) => {
            const ins = (n as any)?.inputs || {};
            Object.entries(ins).forEach(([f, v]) => {
              if (typeof v !== 'string') return;
              if (isNegativePromptField(f, n, v)) { if (upstreamNeg) ins[f] = upstreamNeg; return; }
              if (isPositivePromptField(f, n)) targets.push({ node: ins, field: f });
            });
          });
          // 非占位字段优先（正向 CLIPTextEncode），占位字段（负向空格）最后填
          targets.sort((a, b) => (String(a.node[a.field]).trim() === '' ? 1 : 0) - (String(b.node[b.field]).trim() === '' ? 1 : 0));
          for (const t of targets) {
            if (ti >= textInputs.length) break;
            t.node[t.field] = textInputs[ti]; ti++;
          }
        } else if (upstreamNeg) {
          // 只有负面提示词时也单独映射
          Object.entries(prompt).forEach(([, n]) => {
            const ins = (n as any)?.inputs || {};
            Object.entries(ins).forEach(([f, v]) => {
              if (typeof v !== 'string') return;
              if (isNegativePromptField(f, n, v)) ins[f] = upstreamNeg;
            });
          });
        }
        const pid = await submitLocalWorkflow(prompt, node.data.serverId);
        const results = await pollLocalWorkflow(pid, (msg, pct) => get().updateNodeData(id, { content: msg, progress: pct ?? undefined }), controller.signal, node.data.serverId);
        if (!results.length) throw new Error('工作流执行完成但没有输出媒体');
        const res = results.map(r => ({ type: r.type, url: r.url }));
        // 结果下载到本地缓存（非主控/远程服务器的 /view 地址可能失效或加载慢，图片拉回本地保证画布可见）
        const cachedRes: typeof res = [];
        let downloadFailed = 0;
        for (const r of res) {
          const local = await cachePaidMedia(r.url, r.type).catch(() => r.url);
          if (local === r.url && r.type !== 'video') downloadFailed++; // 仍是远程地址且非视频 = 下载没成功
          cachedRes.push({ type: r.type, url: local });
        }
        const shown = cachedRes.length ? cachedRes : res;
        const warn = downloadFailed > 0 ? `（注意：${downloadFailed} 个结果未能下载到本地，使用的是服务器地址，若图片不显示请检查服务器网络）` : '';
        get().updateNodeData(id, { status: 'success', resultUrl: shown[0].url, outputValues: { image: shown[0].url, url: shown[0].url, results: shown }, results: shown, progress: 100, content: `本地工作流完成 · ${shown.length} 个结果${warn}` });
        // 推送给下游（预览/对比节点等），否则上游出新图时下游不更新
        get().propagateData(id, 'results', shown);
        get().propagateData(id, 'image', shown[0]?.url);
        get().propagateData(id, 'output', shown[0]?.url);
        addGenerationHistory({ id: `${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label, nodeType: 'localWorkflow', params: config, resultUrl: shown[0]?.url, results: shown, status: 'success', timestamp: Date.now() });
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else if (nt === 'apiNode') {
        // API节点：从 config 中取 workflow_id，其他 kv 参数直接传
        workflow_id = (config.workflow_id as string) || (config._apiName as string) || '';
        if (!workflow_id) { get().setNodeStatus(id, 'error', '未配置工作流API'); runningControllers.delete(id); return false; }
        Object.entries(config).forEach(([k, v]) => {
          if (!k.startsWith('_') && k !== 'workflow_id' && typeof v !== 'object' && v !== null && v !== undefined) {
            input_values[k] = v;
          }
        });
        // ResolutionSelector 的 aspect_ratio 兼容：旧数据/手填可能是纯比例 "1:1" / "16:9"（无方向后缀），
        // 补全成 ComfyUI 官方合法值（"1:1 (Square)" / "16:9 (Widescreen)"），否则服务器校验报 "Value not in list"（用户改比例后必现）
        // 字段名是带节点前缀的 "115:aspect_ratio"（不是裸 aspect_ratio），需遍历所有键
        const AR_MAP: Record<string, string> = {
          '1:1': '1:1 (Square)', '2:3': '2:3 (Portrait Photo)', '3:2': '3:2 (Photo)', '3:4': '3:4 (Portrait Standard)',
          '4:3': '4:3 (Standard)', '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)',
        };
        for (const k of Object.keys(input_values)) {
          if (!/:aspect_ratio$/.test(k) && k !== 'aspect_ratio') continue;
          const ar = String(input_values[k] ?? '').trim();
          if (/^(\d+(?:\.\d+)?\s*[:：xX]\s*\d+(?:\.\d+)?)$/.test(ar)) {
            const norm = ar.replace(/\s+/g, '').replace(/[：xX]/g, ':');
            input_values[k] = AR_MAP[norm] || ar;
          }
        }
        // 通用 select 字段兼容：任何 type=select 的字段，若当前值不在合法选项里，
        // 尝试按「前缀匹配」补全为完整选项值（如 "16:9" → "16:9 (Widescreen)"、"euler" → "euler" 已在列表则不动）。
        // 覆盖 aspect_ratio 之外的其它 Combo 字段（ResolutionSelector 等），避免 "Value not in list"
        ((config._apiFields as Array<{ key: string; type?: string; options?: Array<{ label: string; value: unknown }> }>) || []).forEach((f) => {
          if (f.type !== 'select' || !Array.isArray(f.options) || !f.options.length) return;
          const val = input_values[f.key];
          if (val == null || typeof val !== 'string') return;
          const v = val.trim();
          if (!v) return;
          const values = f.options.map(o => String(o.value));
          if (values.includes(v)) return; // 已在列表，无需处理
          // 前缀匹配：找一个选项以「当前值 + 分隔符」开头（如 "16:9" 匹配 "16:9 (Widescreen)"）
          const hit = f.options.find(o => {
            const ov = String(o.value);
            return ov.startsWith(v + ' ') || ov.startsWith(v + '|') || ov.startsWith(v + '（') || ov.startsWith(v + '(') || ov.startsWith(v + ':');
          }) || f.options.find(o => String(o.value).toLowerCase().startsWith(v.toLowerCase()));
          if (hit) input_values[f.key] = String(hit.value);
        });
        // ComfyUI 校验：数字类型字段必须是 number（配置里可能是字符串 "1024"，或带描述的 "0.4 | 864 x 480"）
        ((config._apiFields as Array<{ key: string; type?: string }>) || []).forEach((f) => {
          if (f.type === 'number' && input_values[f.key] != null) {
            let n = Number(input_values[f.key]);
            // 兼容带描述字符串（megapixels 曾被存成 "0.4 | 864 x 480"）：提取前导数字
            if (!Number.isFinite(n)) {
              const m = String(input_values[f.key]).match(/^\s*(-?\d+(?:\.\d+)?)/);
              if (m) n = Number(m[1]);
            }
            if (Number.isFinite(n)) {
              input_values[f.key] = n;
            } else {
              // 文本被误连到数值字段（如 start_time/end_time 收到文字）：不是合法数字就移除，
              // 避免把文字传给服务器导致 int() 解析崩溃。回退用字段默认值（若无默认则移除）。
              const def = (config as any)[f.key];
              if (def != null && /^\s*-?\d+(?:\.\d+)?\s*$/.test(String(def))) input_values[f.key] = Number(def);
              else delete input_values[f.key];
            }
          }
        });
        const fields = (config._apiFields as Array<{key:string;fileType?:string}>) || [];
        const upstream = node.data.inputValues || {};
        const sourceNodes = get().edges.filter(e=>e.target===id).map(e=>get().nodes.find(n=>n.id===e.source)).filter(Boolean) as AppNode[];
        const settingText = sourceNodes.filter(source=>source.data.nodeType==='sceneSettings').map(source=>Object.entries(source.data.config||{}).filter(([,value])=>String(value).trim()).map(([key,value])=>`${key}: ${value}`).join('\n')).filter(Boolean).join('\n');
        if (settingText) Object.keys(input_values).filter(key=>/text|prompt|description|script/i.test(key)).forEach(key=>{input_values[key]=`${settingText}\n\n${String(input_values[key] || '')}`.trim()});
        const sourceResults = sourceNodes.flatMap(source=>source.data.results?.length ? source.data.results : Object.entries(source.data.outputValues||{}).flatMap(([key,value])=>{
          if (['image','video','audio','text'].includes(key) && typeof value==='string') return [{type:key as ResultItem['type'],url:value}];
          if (key==='images'&&Array.isArray(value)) return value.map(url=>({type:'image' as const,url:String(url)}));
          if (key==='videos'&&Array.isArray(value)) return value.map(url=>({type:'video' as const,url:String(url)}));
          if (key==='audios'&&Array.isArray(value)) return value.map(url=>({type:'audio' as const,url:String(url)}));
          return [];
        }));
        for (const mediaType of ['image','video','audio'] as const) {
          const mediaFields = fields.filter(f=>f.fileType===mediaType);
          const mediaValues = sourceResults.filter(r=>r.type===mediaType).map(r=>r.url);
          for (let index=0;index<mediaFields.length;index++) {
            const field=mediaFields[index];const direct=upstream[field.key];const value=direct??mediaValues[index]??upstream[mediaType]??upstream.url;
            if(value!=null){
              const bridged = await bridgeMediaToInput(String(value),mediaType,(node.data.serverId as string | undefined));
              // 直连 ComfyUI 的 LoadImage 等节点 media 输入是字符串文件名（服务器实测：数组会被校验拒绝 'list' object has no attribute 'endswith'）；主控（control）也已自行适配字符串，一律不包数组
              input_values[field.key] = bridged;
            }
          }
        }
        // 所有非媒体字符串字段都可接收文本；不能只依赖 prompt/text 等字段名，
        // 否则模型自定义节点的第二、第三个文本输入会被遗漏。
        const textFields = fields.filter((f:any)=>!f.fileType && ['string','text','textarea'].includes(String(f.type || 'string').toLowerCase()));
        const texts = sourceNodes.flatMap(source=>{
          const direct=source.data.outputValues?.text ?? source.data.config?.text;
          return direct==null?[]:[String(direct)];
        });
        textFields.forEach((field,index)=>{const isNeg=/negative/i.test(field.key);const portEdge = get().edges.find(e => e.target === id && (e.sourceHandle === field.key || e.sourceHandle === `text-${index}` || (!isNeg && e.sourceHandle === 'text')));const portSource = portEdge ? get().nodes.find(n => n.id === portEdge.source) : undefined;const portText = portSource ? String(portSource.data.outputValues?.text ?? portSource.data.config?.text ?? '') : '';const value = upstream[field.key] ?? portText ?? (isNeg ? upstream['negative'] : upstream[`text-${index}`] ?? upstream['text']) ?? texts[index];if (value != null && String(value) !== '') input_values[field.key]=`${settingText ? settingText+'\n\n' : ''}${String(value)}`});
        // 最终安全兜底：数值字段无论从哪条路径（config / 上游文本 / 端口）混入非数字文本，
        // 一律剔除或回退默认值，避免把文字传给服务器导致 int() 解析崩溃（如 start_time/end_time 收到文字）。
        ((config._apiFields as Array<{ key: string; field?: string; type?: string }>) || []).forEach((f) => {
          const kind = String(f.type || '').toLowerCase();
          const isNum = ['number', 'int', 'float', 'integer'].includes(kind) || /(start_time|end_time|start_end|frame|fps|seed|width|height|count|num_|loop|steps?|cfg|strength|duration|batch)/i.test(String(f.field || f.key));
          if (isNum && input_values[f.key] != null && !Number.isFinite(Number(String(input_values[f.key]).trim()))) {
            const def = (config as any)[f.key];
            if (def != null && /^\s*-?\d+(?:\.\d+)?\s*$/.test(String(def))) input_values[f.key] = Number(def);
            else delete input_values[f.key];
          }
        });


      } else if (nt === 'imageToImage') {
        workflow_id = 'img2img-workflow';
        if(node.data.inputValues?.image!=null)input_values['image']=await bridgeMediaToInput(node.data.inputValues.image,'image',(node.data.serverId as string | undefined));
        input_values['prompt'] = config.prompt || node.data.inputValues?.prompt || '';
        input_values['strength'] = config.strength ?? 0.7;
      } else if (nt === 'videoGeneration') {
        workflow_id = 'txt2video-workflow';
        if(node.data.inputValues?.image!=null)input_values['image']=await bridgeMediaToInput(node.data.inputValues.image,'image',(node.data.serverId as string | undefined));
        input_values['prompt'] = config.prompt || node.data.inputValues?.prompt || '';
        input_values['duration'] = config.duration ?? 5;
      } else if (nt === 'textInput' || nt === 'scriptInput' || nt === 'sceneSettings' || nt === 'compare' || nt === 'asset' || nt === 'preview') {
        // 文本/预览节点：直接传递
        if (nt === 'textInput') { const scene = String(node.data.inputValues?.settings || ''); const text = String(config.text || ''); get().propagateData(id, 'text', scene ? `${scene}\n\n${text}` : text); }
        if (nt === 'scriptInput') ((config.scripts as Array<{id:string;text:string}>)||[]).forEach(item=>get().propagateData(id,`script-${item.id}`,item.text));
        if (nt === 'sceneSettings') get().propagateData(id, 'settings', Object.entries(config).filter(([,value])=>String(value).trim()).map(([key,value])=>`${key}: ${value}`).join('\n'));
        if (nt === 'compare') { const processed=node.data.inputValues?.processed; if(processed!=null)get().propagateData(id,'processed',processed); }
        if (nt === 'asset') Object.entries(node.data.outputValues || {}).forEach(([key,value])=>get().propagateData(id,key,value));
        if (nt === 'preview') Object.entries(node.data.outputValues || {}).forEach(([key,value])=>get().propagateData(id,key,value));
        get().updateNodeData(id,{status:'success',generationDurationMs:Date.now()-startedAt});
        runningControllers.delete(id); // 提前返回前清理 AbortController（防任务计数泄漏）
        return true;
      } else {
        // 通用处理：registry 查找 + 先合并上游输入，再合并用户配置
        try {
          const entry = NODE_MAP.get(nt);
          if (entry) { workflow_id = entry.workflowId; }
          // 1) 上游节点的输出作为输入（文本节点连接的 prompt/text 等）
          Object.assign(input_values, node.data.inputValues || {});
          // 2) 用户配置覆盖：仅当「上游已连接该字段（有非空值）且 config 为默认空值」时保留上游值，
          //    否则文本节点连到 prompt 输入后，config 默认空 prompt 会把上游文本吞掉（"文本节点传不到下游"根因）；
          //    config 为空且上游也没有该字段时照常写入空值（保持原行为，registry 文生图等节点不丢字段）
          Object.entries(config).forEach(([k, v]) => {
            const hasUpstream = input_values[k] !== undefined && input_values[k] !== null && String(input_values[k]) !== '';
            if (hasUpstream && (v === '' || v === null || v === undefined)) return;
            input_values[k] = v;
          });
          // 合并 kv 参数
          Object.entries(config).forEach(([k, v]) => { if (k.includes(':')) input_values[k] = v; });
        } catch (error) { throw new Error(error instanceof Error ? error.message : '节点配置无效'); }
      }
      // New types: use registry workflow_id + config as input_values

      // 批处理占位符：所有文本输入支持 {a|b|c} 随机变体
      for (const k of Object.keys(input_values)) {
        if (typeof input_values[k] === 'string') (input_values as Record<string, any>)[k] = expandPromptVariants(String(input_values[k]));
      }
      try { const logs = (window as any).__submitLogs || []; logs.push({ t: Date.now(), wf: workflow_id, sid: node.data.serverId, input: JSON.stringify(input_values).slice(0, 2500) }); (window as any).__submitLogs = logs.slice(-20); } catch { /* ignore */ }
      const resp = await generate({ workflow_id, input_values }, node.data.serverId as string | undefined);
      get().updateNodeData(id, { promptId: resp.prompt_id });
      // 轮询结果
      const result = await pollResult(resp.prompt_id, (msg, pct) => {
        get().updateNodeData(id, { content: msg, progress: pct ?? undefined, generationDurationMs:Date.now()-startedAt });
      }, 2000, undefined, controller.signal, node.data.serverId as string | undefined);

      let resultUrl: string | undefined;
      if (result.success && result.data && result.data.length > 0) {
        // 结果自动下载到本地缓存（远程服务器关闭/换地址后结果仍可用）；视频大文件保持远程直链
        const all = await Promise.all(result.data.map(async item => {
          const cached = await cachePaidMedia(item.url, item.type);
          return cached !== item.url ? { ...item, url: cached } : item;
        }));
        const first = all[0];
        resultUrl = first.url;
        const outputVal: Record<string, unknown> = { results:all, output:first.url, url:first.url };
        for (const type of ['image','video','audio','text','3d'] as const) {
          const urls=all.filter(item=>item.type===type).map(item=>item.url);
          if(urls.length){outputVal[type]=urls[0];outputVal[`${type}s`]=urls;}
        }
        if (first.filename) outputVal['filename'] = first.filename;

        // 每次生成都完整替换结果，避免预览节点继续使用上一轮结果。
        get().updateNodeData(id, { resultUrl: first.url, results:all, outputValues: outputVal, inputValues: { ...get().nodes.find(n=>n.id===id)?.data.inputValues, results: all }, content: `生成完成 · ${all.length} 个结果`, generationDurationMs:Date.now()-startedAt });
        const cfg = NODE_CONFIGS[nt];
        get().propagateData(id, cfg?.outputs[0]?.name || 'output', first.url);
        get().propagateData(id, 'output', first.url);
        if (first.filename) get().propagateData(id, 'filename', first.filename);
        get().propagateData(id,'results',all);
        for (const type of ['image','video','audio','text','3d'] as const) {
          const urls=all.filter(item=>item.type===type).map(item=>item.url);
          if(urls.length){get().propagateData(id,type,urls[0]);get().propagateData(id,`${type}s`,urls);}
        }
      }
      if (!resultUrl) throw new Error('任务完成，但没有返回可用结果');
      get().updateNodeData(id, { progress: 100, generationDurationMs:Date.now()-startedAt });
      get().setNodeStatus(id, 'success');
      runningControllers.delete(id);
      // 记录历史，不依赖生成历史面板是否已经挂载。
      addGenerationHistory({ id: id + '-' + Date.now(), nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl, results:get().nodes.find(n=>n.id===id)?.data.results, status: 'success', timestamp: Date.now() });
      autoSaveToAssets(resultUrl, get().nodes.find(n=>n.id===id)?.data.results, node.data.label);
      return true;
    } catch (e: any) {
      runningControllers.delete(id);
      if (e?.name === 'AbortError') { get().updateNodeData(id,{status:'paused',generationDurationMs:Date.now()-startedAt}); return false; }
      get().updateNodeData(id,{generationDurationMs:Date.now()-startedAt});
      get().setNodeStatus(id, 'error', e?.message || '执行失败');
      addGenerationHistory({ id: id + '-' + Date.now(), nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, status: 'error', timestamp: Date.now(), error: e?.message });
      return false;
    }
  },

  executeFromNode: async (id) => {
    // 拓扑排序：每个节点等所有上游（计划集内、且未成功的）执行完才执行，避免下游缺输入
    const planned = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      if (planned.has(current)) continue;
      planned.add(current);
      get().edges.filter(e => e.source === current).forEach(e => queue.push(e.target));
    }
    // 不再过滤 success：起始节点及下游链路即使已成功也要重跑（改上游后能级联刷新结果）
    const planNodes = [...planned].filter(tid => get().nodes.some(n => n.id === tid));
    if (planNodes.length > 1) message.info(`将从该节点重新生成 ${planNodes.length} 个节点（含下游链路，付费节点会再次调用）`);
    const indegree = new Map<string, number>();
    planNodes.forEach(tid => {
      const up = get().edges.filter(e => e.target === tid && planNodes.includes(e.source) && e.source !== tid);
      indegree.set(tid, up.length);
    });
    planNodes.forEach(taskId => { queuedTaskIds.add(taskId); get().updateNodeData(taskId, { queuedAt: Date.now(), status: 'queued', content: '等待上游完成' }); });
    const ready = planNodes.filter(tid => (indegree.get(tid) || 0) === 0);
    const failedSet = new Set<string>(); // 失败/暂停的上游：其下游短路，不执行（防用残留旧输入生成"假成功"）
    const markDownstream = (current: string, reason: string) => {
      get().edges.filter(e => e.source === current && planNodes.includes(e.target)).forEach(e => {
        const dn = get().nodes.find(n => n.id === e.target);
        if (dn && dn.data.status !== 'error' && dn.data.status !== 'paused') get().setNodeStatus(e.target, 'error', reason);
      });
    };
    while (ready.length) {
      ready.sort((a, b) => { const na = get().nodes.find(n => n.id === a); const nb = get().nodes.find(n => n.id === b); return (na?.position.y || 0) - (nb?.position.y || 0); });
      const current = ready.shift()!;
      queuedTaskIds.delete(current);
      if (!get().nodes.some(n => n.id === current)) continue;
      const currentNode = get().nodes.find(n => n.id === current);
      if (currentNode?.data.status === 'paused') { failedSet.add(current); markDownstream(current, '上游已暂停，已跳过'); continue; }
      get().updateNodeData(current, { queuedAt: undefined, queueOrder: undefined });
      const succeeded = await get().executeNode(current);
      if (!succeeded) {
        // 上游失败：直接下游标记"上游失败"并跳过，避免用残留旧输入继续生成
        failedSet.add(current); markDownstream(current, '上游节点执行失败，已跳过');
      }
      get().edges.filter(e => e.source === current && planNodes.includes(e.target)).forEach(e => {
        const d = (indegree.get(e.target) || 1) - 1;
        indegree.set(e.target, d);
        if (d <= 0 && !ready.includes(e.target)) {
          const targetNode = get().nodes.find(n => n.id === e.target);
          if (targetNode && !failedSet.has(e.source)) ready.push(e.target);
        }
      });
    }
    planNodes.forEach(taskId => {
      queuedTaskIds.delete(taskId);
      const node = get().nodes.find(item => item.id === taskId);
      if (node && node.data.status === 'queued') get().updateNodeData(taskId, { queuedAt: undefined, queueOrder: undefined, status: 'idle' });
    });
  },

  contextMenu: { visible: false, x: 0, y: 0, nodeId: null },
  showContextMenu: (x, y, nodeId) => set({ contextMenu: { visible: true, x, y, nodeId } }),
  hideContextMenu: () => set({ contextMenu: { visible: false, x: 0, y: 0, nodeId: null } }),
}));
