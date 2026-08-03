import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, type NodeChange, type EdgeChange, type Connection, type Edge } from '@xyflow/react';
import type { AppNode, CanvasNodeData, ToolAction, HistorySnapshot, NodeComponentType, ContextMenuState, NodeStatus } from '@/types';
import { NODE_CONFIGS } from '@/types';
import { generate, pollResult, uploadFile, getApiBase, bridgeMediaToInput, cancelComfyTask, type ResultItem } from '@/services/comfyui.service';
import { PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';
import { generateId } from '@/utils';
import { NODE_MAP } from '@/config/registry';
import { mediaTypeForFile } from '@/utils/fileDrop';
import { sendChat, type ChatTurn } from '@/services/chat.service';
import { formatEffects, CINEMATOGRAPHY_EFFECTS } from '@/config/cinematographyKnowledge';
import { generateStoryboard, DEFAULT_STORYBOARD_SYSTEM_PROMPT } from '@/services/storyboard.service';
import { callPaidApi } from '@/services/paidApi.service';
import { getPaidModelsForCapability } from '@/config/paidCapabilityCatalog';
import { useSettingsStore, type PaidApiNodeSettings } from '@/stores/settingsStore';
import { getSupportedPaidCapabilities } from '@/config/paidCapabilityCatalog';
import { callBailianTextToImage } from '@/services/bailianTextToImage.service';
import { addGenerationHistory } from '@/utils/generationHistory';

const NODE_DEFAULTS: Record<NodeComponentType, { label: string; color: string; icon: string }> = {
  textInput:       { label: '文本输入', color: '#1677ff', icon: '📝' },
  scriptInput:     { label: '剧本输入', color: '#8b5cf6', icon: '▤' },
  sceneSettings:   { label: '场景设定', color: '#f59e0b', icon: '🎬' },
  compare:         { label: '前后对比', color: '#14b8a6', icon: '◐' },
  asset:           { label: '素材',     color: '#0ea5e9', icon: '↥' },
  imageGeneration: { label: '文生图',   color: '#722ed1', icon: '🎨' },
  imageToImage:    { label: '图生图',   color: '#13c2c2', icon: '🔄' },
  videoGeneration: { label: '视频生成', color: '#eb2f96', icon: '🎬' },
  preview:         { label: '预览',     color: '#52c41a', icon: '👁️' },
  // All 25 new types come from registry
  qwenImageGen:{label:'Qwen生成',color:'#6366f1',icon:'🖼️'},qwenImageEdit:{label:'Qwen编辑',color:'#818cf8',icon:'✏️'},
  zimageGen:{label:'Zimage',color:'#a855f7',icon:'⚡'},fluxImageGen:{label:'Flux',color:'#06b6d4',icon:'🌊'},
  sdxlIL:{label:'SDXL-IL',color:'#ec4899',icon:'🎯'},fireRedEdit:{label:'FireRed编辑',color:'#f97316',icon:'🔥'},
  wanVideoGen:{label:'Wan图生',color:'#22c55e',icon:'🎬'},ltxVideoGen:{label:'LTX视频',color:'#10b981',icon:'🎥'},
  lipSyncHuman:{label:'对口型',color:'#eab308',icon:'👄'},personReplace:{label:'人物替换',color:'#ef4444',icon:'👤'},
  gaussianSplat:{label:'高斯泼溅',color:'#8b5cf6',icon:'🔮'},upscaleWatermark:{label:'放大去水印',color:'#14b8a6',icon:'🔍'},
  audioGen:{label:'声音生成',color:'#f59e0b',icon:'🎵'},motionTransfer:{label:'动作迁移',color:'#d946ef',icon:'🏃'},
  storyboardGPT:{label:'分镜图',color:'#0ea5e9',icon:'📋'},intentImage:{label:'表意图',color:'#84cc16',icon:'💡'},
  booguImage:{label:'Boogu',color:'#f472b6',icon:'B'},kreaImage:{label:'Krea',color:'#fb923c',icon:'🎨'},
  universalMaker:{label:'通用制作',color:'#6b7280',icon:'🔧'},toolSettings:{label:'工具设置',color:'#4b5563',icon:'⚙️'},
  joyAIEcho:{label:'JoyAI-Echo',color:'#c084fc',icon:'🎭'},
  storyboardPrompt:{label:'剧情分镜',color:'#0ea5e9',icon:'🎞️'},cinematographyKnowledge:{label:'影视知识库',color:'#f59e0b',icon:'🎥'},
  refMultiFusion:{label:'多图融合',color:'#ec4899',icon:'🔄'},refWashImage:{label:'洗图',color:'#f43f5e',icon:'🖌️'},
  refImageClear:{label:'变清晰',color:'#22c55e',icon:'✨'},refImageToVideo:{label:'图生视频',color:'#3b82f6',icon:'📹'},
  uploadNode:{label:'上传文件',color:'#60a5fa',icon:'📤'},downloadNode:{label:'下载结果',color:'#f59e0b',icon:'📥'},
  imageCrop:{label:'修图裁切',color:'#f97316',icon:'✂'}, apiNode:{label:'API节点',color:'#6366f1',icon:'🔌'}, chatNode:{label:'AI聊天',color:'#22c55e',icon:'💬'}, directorStudio:{label:'JA导演台',color:'#f59e0b',icon:'🎬'}, videoTrim:{label:'视频剪辑',color:'#f97316',icon:'✂'}, video2xLocal:{label:'Video2X超分/补帧（开源本地）',color:'#06b6d4',icon:'⚙'},
  paidTextToImage:{label:'付费API·文生图',color:'#a855f7',icon:'🎨'},paidImageToImage:{label:'付费API·图生图',color:'#0ea5e9',icon:'🖼️'},paidTextToVideo:{label:'付费API·文生视频',color:'#ec4899',icon:'🎬'},paidImageToVideo:{label:'付费API·图生视频',color:'#f43f5e',icon:'📹'},paidCapability:{label:'付费扩展能力',color:'#14b8a6',icon:'✦'},bailianTextToImage:{label:'文生图',color:'#ff7a45',icon:'🔥'},
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
  showContextMenu: (x: number, y: number, nodeId: string) => void;
  hideContextMenu: () => void;
  toggleNodeDisabled: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveTool: (t: ToolAction) => void;
  setProjectName: (n: string) => void;
  undo: () => void;
  redo: () => void;
  deleteSelectedNode: () => void;
  duplicateSelectedNode: () => void;
  clearCanvas: () => void;
  loadCanvas: (n: AppNode[], e: Edge[]) => void;
  _pushHistory: () => void;
}

const runningControllers = new Map<string, AbortController>();
const queuedTaskIds = new Set<string>();
const localExecutionQueue: string[] = [];
let localQueueRunning = false;
export const getRunningTaskCount = () => runningControllers.size;
export const getQueuedTaskIds = () => [...queuedTaskIds];

function snap(nodes: AppNode[], edges: Edge[]): HistorySnapshot {
  return { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
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
  nodes: INITIAL, edges: [], selectedNodeId: null, activeTool: 'select', projectName: '未命名项目',
  history: [snap(INITIAL, [])], historyIndex: 0,

  _pushHistory: () => {
    const s = get(); const ns = snap(s.nodes, s.edges);
    const h = s.history.slice(0, s.historyIndex + 1); h.push(ns); if (h.length > 50) h.shift();
    set({ history: h, historyIndex: h.length - 1 });
  },

  undo: () => { const { historyIndex: i, history: h } = get(); if (i <= 0) return; const s = h[i - 1]; set({ nodes: JSON.parse(JSON.stringify(s.nodes)), edges: JSON.parse(JSON.stringify(s.edges)), historyIndex: i - 1, selectedNodeId: null }); },
  redo: () => { const { historyIndex: i, history: h } = get(); if (i >= h.length - 1) return; const s = h[i + 1]; set({ nodes: JSON.parse(JSON.stringify(s.nodes)), edges: JSON.parse(JSON.stringify(s.edges)), historyIndex: i + 1, selectedNodeId: null }); },

  onNodesChange: (c) => { set({ nodes: applyNodeChanges(c, get().nodes) as AppNode[] }); if (c.some(x => x.type === 'remove' || x.type === 'add')) get()._pushHistory(); },
  onEdgesChange: (c) => { set({ edges: applyEdgeChanges(c, get().edges) }); if (c.some(x => x.type === 'remove')) get()._pushHistory(); },
  deleteEdge: (id) => {
    const edge=get().edges.find(item=>item.id===id);const remaining=get().edges.filter(item=>item.id!==id);
    let nodes=get().nodes;
    if(edge?.target&&edge.targetHandle&&!remaining.some(item=>item.target===edge.target&&item.targetHandle===edge.targetHandle)) {
      nodes=nodes.map(node=>{if(node.id!==edge.target)return node;const inputValues={...node.data.inputValues};delete inputValues[edge.targetHandle!];return {...node,data:{...node.data,inputValues}}});
    }
    set({edges:remaining,nodes});get()._pushHistory();
  },

  onConnect: (c) => {
    const source = get().nodes.find(n=>n.id===c.source);
    const target = get().nodes.find(n=>n.id===c.target);
    const color = source?.data.color || '#7c6df2';
    const edge = { ...c, id: `e-${c.source}-${c.target}-${Date.now()}`, type:'deletable', animated: true, style: { stroke: color, strokeWidth: 2.2 } } as Edge;
    const sourceValues=source?.data.outputValues||{};
    const sourceKey=c.sourceHandle||''; const targetKey=c.targetHandle||sourceKey||'input';
    const scriptId=sourceKey.startsWith('script-')?sourceKey.slice(7):'';
    const scriptValue=scriptId?((source?.data.config?.scripts as Array<{id:string;text:string}>)||[]).find(item=>item.id===scriptId)?.text:undefined;
    const configValue=sourceKey?source?.data.config?.[sourceKey]:undefined;
    const directValue=sourceKey&&sourceKey in sourceValues?sourceValues[sourceKey]:scriptValue??configValue??sourceValues.output??sourceValues.url??sourceValues.image??sourceValues.text;
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
      directorStudio: { actors: [], scene: '', camera: {}, shot: {}, workflow: '', prompt: '', snapshot: '' },
      imageCrop: { x: 0, y: 0, width: 512, height: 512, aspectRatio: '1:1' },
      paidTextToImage: { prompt:'', model:'', aspectRatio:'1:1', width:1024, height:1024 },
      paidImageToImage: { prompt:'', model:'', aspectRatio:'1:1', width:1024, height:1024 },
      paidTextToVideo: { prompt:'', model:'', aspectRatio:'16:9', width:1280, height:720, duration:5 },
      paidImageToVideo: { prompt:'', model:'', aspectRatio:'16:9', width:1280, height:720, duration:5 },
      paidCapability: { capability:'image-upscale', prompt:'', model:'' },
      bailianTextToImage: { prompt:'', ratio:'1:1', resolution:1024, seed:-1 },
      chatNode: { message: '', memory: true, historyLimit: 20, history: [] },
      videoTrim: { startFrame: 0, endFrame: 0, fps: 30 },
    };
    let dynCfg = defaults[t];
    if (!dynCfg) { const e = NODE_MAP.get(t); if (e) dynCfg = { ...e.defaultParams }; else dynCfg = {}; }
    const initialStyle = t === 'preview' ? { width: 240, height: 180 } : t === 'compare' ? {width:460,height:260} : t === 'chatNode' ? {width:520,height:620,minWidth:420,minHeight:420} : t === 'storyboardPrompt' ? {width:680,minWidth:620} : t === 'cinematographyKnowledge' ? {width:520,minWidth:420} : undefined;
    const nodeId=generateId();
    set({ nodes: [...get().nodes, { id: nodeId, type: t, position: p, style: initialStyle,
      data: { label: nd.label, content: '', color: nd.color, nodeType: t,
        config: dynCfg, inputValues: {}, outputValues: {}, status: 'idle',
        createdAt: now, updatedAt: now, ...d } } as AppNode] });
    get()._pushHistory();
    return nodeId;
  },

  updateNodeData: (id, d) => set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...d, updatedAt: Date.now() } } : n) }),
  updateNodeStyle: (id, style) => set({ nodes: get().nodes.map(n => n.id === id ? { ...n, style: { ...n.style, ...style } } : n) }),

  deleteSelectedNode: () => {
    const id = get().selectedNodeId; if (!id) return;
    set({ nodes: get().nodes.filter(n => n.id !== id), edges: get().edges.filter(e => e.source !== id && e.target !== id), selectedNodeId: null });
    get()._pushHistory();
  },

  duplicateSelectedNode: () => {
    const { selectedNodeId: id, nodes } = get(); if (!id) return;
    const n = nodes.find(x => x.id === id); if (!n) return;
    const dup = { ...JSON.parse(JSON.stringify(n)), id: generateId(), position: { x: n.position.x + 50, y: n.position.y + 50 }, selected: false, data: { ...n.data, label: n.data.label + ' (副本)', createdAt: Date.now(), updatedAt: Date.now() } } as AppNode;
    set({ nodes: [...nodes, dup], selectedNodeId: dup.id }); get()._pushHistory();
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setActiveTool: (t) => set({ activeTool: t }),
  setProjectName: (n) => set({ projectName: n }),
  clearCanvas: () => { set({ nodes: [], edges: [], selectedNodeId: null }); get()._pushHistory(); },
  loadCanvas: (n, e) => { const migrated=migrateNodes(n);const smooth=e.map(edge=>({...edge,type:'deletable'}));set({ nodes:migrated,edges:smooth,selectedNodeId:null,history:[snap(migrated,smooth)],historyIndex:0 }); },

  setNodeConfig: (id, partialConfig) => {
    const current = get().nodes.find(n => n.id === id);
    const nextConfig = { ...(current?.data.config || {}), ...partialConfig };
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, config: nextConfig, updatedAt: Date.now() } } : n) });
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
  },

  pauseNode: (id) => {
    const promptId = get().nodes.find(n => n.id === id)?.data.promptId;
    void cancelComfyTask(promptId).catch(() => undefined);
    runningControllers.get(id)?.abort();
    runningControllers.delete(id);
    const queuedIndex = localExecutionQueue.indexOf(id);
    if (queuedIndex >= 0) localExecutionQueue.splice(queuedIndex, 1);
    queuedTaskIds.delete(id);
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, status: 'paused', content: '已取消任务，已通知 ComfyUI 中断', error: undefined, updatedAt: Date.now() } } : n) });
  },

  enqueueNode: (id) => {
    const node = get().nodes.find(item => item.id === id);
    if (!node || node.data.disabled || node.data.status === 'running' || localExecutionQueue.includes(id)) return;
    localExecutionQueue.push(id);
    queuedTaskIds.add(id);
    get().updateNodeData(id, { status: 'idle', queuedAt: Date.now(), queueOrder: Date.now(), error: undefined, content: '已加入本地执行队列' });
    if (localQueueRunning) return;
    localQueueRunning = true;
    void (async () => {
      try {
        while (localExecutionQueue.length) {
          const nextId = localExecutionQueue.shift()!;
          queuedTaskIds.delete(nextId);
          const current = get().nodes.find(item => item.id === nextId);
          if (!current || current.data.status === 'paused' || current.data.disabled) continue;
          get().updateNodeData(nextId, { queuedAt: undefined, queueOrder: undefined });
          await get().executeNode(nextId);
        }
      } finally {
        localQueueRunning = false;
      }
    })();
  },

  toggleNodeDisabled: (id) => {
    set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n) });
  },

  propagateData: (sourceId, outputName, value) => {
    const { edges, nodes } = get();
    const targets = edges.filter(e => e.source === sourceId).map(e => ({ edgeId: e.id, targetId: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }));
    set({
      nodes: nodes.map(n => {
        if (n.id === sourceId) {
          return { ...n, data: { ...n.data, outputValues: { ...n.data.outputValues, [outputName]: value } } };
        }
        const matches = targets.filter(t => t.targetId === n.id && (outputName==='results'||!t.sourceHandle||t.sourceHandle === outputName || (outputName === 'output' && ['image','video','audio','media','input'].includes(t.sourceHandle || ''))));
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

      if (nt === 'cinematographyKnowledge') {
        const ids = Array.isArray(config.selectedEffectIds) ? config.selectedEffectIds.map(String) : [];
        const search = String(config.search || '').trim().toLowerCase();
        const selected = search ? CINEMATOGRAPHY_EFFECTS.filter(e=>e.term.toLowerCase().includes(search)).map(e=>e.id) : ids;
        const result = formatEffects([...new Set([...ids,...selected])]);
        const custom = Array.isArray(config.customTerms) ? config.customTerms.map(String).filter(Boolean) : String(config.customTerms||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
        const output = { ...result, promptText: [result.promptText,...custom].filter(Boolean).join('、') };
        get().updateNodeData(id,{outputValues:output,content:output.promptText||'未选择效果',results:[{type:'text',url:output.promptText}],status:'success'});
        Object.entries(output).forEach(([key,value])=>get().propagateData(id,key,value));
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
        if (get().nodes.find(n=>n.id===id)?.data.config?._requestVersion !== requestVersion) return false;
        const output:Record<string,unknown>={storyboard_list:JSON.stringify(result,null,2),error_warning:result.warnings.join('\n')};
        result.segments.forEach((segment,index)=>{const no=index+1;output[`segment_${no}_first_prompt`]=segment.firstFrame.prompt;output[`segment_${no}_last_prompt`]=segment.lastFrame.prompt;output[`segment_${no}_video_prompt`]=segment.videoPrompt;});
        get().updateNodeData(id,{outputValues:output,config:{...config,_segments:result.segments},content:`已生成 ${result.segments.length} 段分镜`,status:'success',generationDurationMs:Date.now()-startedAt});
        Object.entries(output).forEach(([key,value])=>get().propagateData(id,key,value));
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
        if (!files.length) { get().setNodeStatus(id, 'idle'); return false; }
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
        return true;
      } else if (false && nt === 'bailianTextToImage') {
        const bailian = useSettingsStore.getState().bailianTextToImage;
        const prompt = String(config.prompt || node?.data.inputValues?.prompt || node?.data.inputValues?.text || '').trim();
        if (!prompt) throw new Error('请输入提示词，或连接文本节点到提示词输入端口');
        const result = await callBailianTextToImage(bailian, {
          prompt,
          ratio: String(config.ratio || '1:1'),
          resolution: Number(config.resolution) || 1024,
          seed: Number(config.seed),
        }, controller.signal);
        const results = [{ type: 'image' as const, url: result.url }];
        const outputValues = { image: result.url, output: result.url, url: result.url, results };
        get().updateNodeData(id, { resultUrl: result.url, outputValues, results, content: '文生图生成完成', status: 'success' });
        get().propagateData(id, 'image', result.url);
        get().propagateData(id, 'output', result.url);
        get().propagateData(id, 'results', results);
        return true;
      } else if (['paidTextToImage','paidImageToImage','paidTextToVideo','paidImageToVideo','paidCapability','bailianTextToImage'].includes(nt)) {
        const paid = useSettingsStore.getState();
        const legacyCapability = nt === 'paidImageToImage' ? 'image-to-image' : nt === 'paidTextToVideo' ? 'text-to-video' : nt === 'paidImageToVideo' ? 'image-to-video' : 'text-to-image';
        const capability = String(config.capability || legacyCapability) as PaidCapability;
        const capabilityInfo = capability ? PAID_CAPABILITIES[capability] : undefined;
        const isVideo = capabilityInfo?.output === 'video';
        const needsImage = Boolean(capabilityInfo && capabilityInfo.input !== 'text');
        const provider = String(config.provider || (nt === 'bailianTextToImage' ? 'bailian' : ''));
        const profile = paid.paidApiProviders?.[provider as keyof typeof paid.paidApiProviders];
        if (!provider || !profile?.apiKey) throw new Error(`请先在设置 → 付费 API 厂商配置中填写当前厂商的 API Key`);
        const prompt = String(config.prompt || node.data.inputValues?.prompt || node.data.inputValues?.text || '').trim();
        const imageUrl = String(node.data.inputValues?.image || node.data.inputValues?.firstImage || node.data.inputValues?.url || '');
        const lastImageUrl = String(node.data.inputValues?.lastImage || '');
        const videoUrl = String(node.data.inputValues?.video || '');
        const audioUrl = String(node.data.inputValues?.audio || '');
        if (!prompt) throw new Error('请输入提示词，或连接文本节点到提示词输入端口');
        if (capability === 'element-manage' || capability === 'voice-manage') {
          throw new Error('主体 / 音色管理请在节点内直接创建、查询和删除，无需在画布中执行任务');
        }
        if (capability === 'lipsync') {
          if (!videoUrl) throw new Error('对口型需要连接人物视频输入端口');
          if (!audioUrl) throw new Error('对口型需要连接音频输入端口');
        } else if (needsImage && !imageUrl) throw new Error('请连接图片输入端口，或拖入图片素材');
        if (capabilityInfo?.input === 'image-video' && capability !== 'lipsync' && !videoUrl) throw new Error('该节点还需要连接参考视频输入端口');
        const type = capability;
        const chosenModel = String(config.model || profile.selectedModel || '');
        if (!chosenModel) throw new Error('请选择当前厂商支持的模型');
        const result = await callPaidApi({ provider: profile.provider, apiKey: profile.apiKey, baseUrl: profile.baseUrl, model: String(config.model || profile.selectedModel || ''), region: profile.region, workspaceId: profile.workspaceId, authMode: profile.provider === 'gemini' ? 'query-key' : 'bearer' }, {
          type,
          prompt,
          negativePrompt: String(config.negativePrompt || config.negative_prompt || ''),
          imageUrl: needsImage ? imageUrl : undefined,
          lastImageUrl: lastImageUrl || undefined,
          videoUrl: videoUrl || undefined,
          audioUrl: audioUrl || undefined,
          width: Number(config.width) || undefined,
          height: Number(config.height) || undefined,
          aspectRatio: String(config.aspectRatio || ''),
          resolution: isVideo ? Number(config.resolution) || undefined : undefined,
          duration: isVideo ? Number(config.duration) || 5 : undefined,
          frameRate: isVideo ? Number(config.frameRate) || 24 : undefined,
          seed: Number.isFinite(Number(config.seed)) ? Number(config.seed) : undefined,
        });
        if (!result.url) throw new Error('接口已返回成功状态，但未提供可访问的生成结果地址');
        const outputKey = isVideo ? 'video' : 'image';
        const outputValues = { [outputKey]: result.url, output: result.url };
        const paidResults = [{ type: isVideo ? ('video' as const) : ('image' as const), url: result.url }];
        get().updateNodeData(id, { resultUrl: result.url, outputValues, results: paidResults, content: `付费 API 生成完成 · ${chosenModel}`, status:'success' });
        get().propagateData(id, outputKey, result.url);
        get().propagateData(id, 'output', result.url);
        addGenerationHistory({ id: `${id}-${Date.now()}`, nodeId: id, nodeName: node.data.label, nodeType: nt, params: config, resultUrl: result.url, results: paidResults, status: 'success', timestamp: Date.now() });
        return true;
      } else if (nt === 'chatNode') {
        const message = String(config.message || node.data.inputValues?.prompt || node.data.inputValues?.text || '').trim();
        const inputImage = String(node.data.inputValues?.image || '');
        const inputFile = String(node.data.inputValues?.file || node.data.inputValues?.video || node.data.inputValues?.audio || node.data.inputValues?.url || '');
        if (!message && !inputImage && !inputFile) throw new Error('请输入消息或连接图片/文件');
        const history = (Array.isArray(config.history) ? config.history : []) as ChatTurn[];
        const attachments = [...(Array.isArray(config.attachments) ? config.attachments : []), ...(inputImage ? [{ name: 'input-image', mimeType: 'image/*', url: inputImage }] : []), ...(inputFile ? [{ name: 'input-file', mimeType: 'application/octet-stream', url: inputFile }] : [])];
        const result = await sendChat(message || '请分析这个文件。', attachments, config.memory === false ? [] : history.slice(-Math.max(0, Number(config.historyLimit) || 20)), undefined, { model:String(config.selectedModel || '') || undefined, thinkingMode:(config.thinkingMode as any) || undefined });
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
        return true;
      } else if (nt === 'video2xLocal') {
        const input = String(config.inputPath || node.data.inputValues?.video || '');
        const api = (window as any).electronAPI;
        if (!input) throw new Error('请先连接视频，或在 Video2X 节点中选择本地视频');
        if (!api?.video2xProcess) throw new Error('请使用 Electron 桌面版运行 Video2X 本地节点');
        const result = await api.video2xProcess({ input, mode: config.mode || 'upscale', scale: config.scale || 2, model: config.model || 'realesr-animevideov3', frameRateMul: config.frameRateMul || 2 });
        const values = { video: result.url, output: result.url };
        get().updateNodeData(id, { resultUrl: result.url, outputValues: values, results: [{ type:'video', url:result.url, filename:result.filename }], content:'Video2X 处理完成' });
        get().propagateData(id, 'video', result.url); get().propagateData(id, 'output', result.url);
        get().setNodeStatus(id, 'success');
        return true;
      } else if (nt === 'downloadNode') {
        // 下载节点：从 input URL 下载
        const url = (config.url as string) || (node.data.inputValues?.url as string);
        if (!url) { get().setNodeStatus(id, 'error', '无输入URL'); return false; }
        try {
          const a = document.createElement('a'); a.href = url; a.download = url.split('/').pop() || 'download';
          a.target = '_blank'; a.click();
          get().updateNodeData(id,{status:'success',generationDurationMs:Date.now()-startedAt});
          get().updateNodeData(id, { content: '下载已触发: ' + url.slice(-30) });
        } catch (e: any) { get().setNodeStatus(id, 'error', e.message); }
        return get().nodes.find(n => n.id === id)?.data.status !== 'error';
      } else if (nt === 'apiNode') {
        // API节点：从 config 中取 workflow_id，其他 kv 参数直接传
        workflow_id = (config.workflow_id as string) || (config._apiName as string) || '';
        if (!workflow_id) { get().setNodeStatus(id, 'error', '未配置工作流API'); return false; }
        Object.entries(config).forEach(([k, v]) => {
          if (!k.startsWith('_') && k !== 'workflow_id' && typeof v !== 'object' && v !== null && v !== undefined && v !== '') {
            input_values[k] = v;
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
            if(value!=null)input_values[field.key]=await bridgeMediaToInput(String(value),mediaType);
          }
        }
        // 所有非媒体字符串字段都可接收文本；不能只依赖 prompt/text 等字段名，
        // 否则模型自定义节点的第二、第三个文本输入会被遗漏。
        const textFields = fields.filter((f:any)=>!f.fileType && ['string','text','textarea'].includes(String(f.type || 'string').toLowerCase()));
        const texts = sourceNodes.flatMap(source=>{
          const direct=source.data.outputValues?.text ?? source.data.config?.text;
          return direct==null?[]:[String(direct)];
        });
        textFields.forEach((field,index)=>{const value=upstream[field.key]??texts[index];if(value!=null)input_values[field.key]=`${settingText ? settingText+'\n\n' : ''}${String(value)}`});
      } else if (nt === 'directorStudio') {
        const shotText = String(config.prompt || config.scene || '');
        get().propagateData(id, 'shot', shotText);
        if (config.snapshot) get().propagateData(id, 'preview', config.snapshot);
        get().updateNodeData(id, { status:'success', content:'JA导演台镜头已发布，可连接到 API 节点', generationDurationMs:Date.now()-startedAt });
        return true;
      } else if (nt === 'imageToImage') {
        workflow_id = 'img2img-workflow';
        if(node.data.inputValues?.image!=null)input_values['image']=await bridgeMediaToInput(node.data.inputValues.image,'image');
        input_values['prompt'] = config.prompt || node.data.inputValues?.prompt || '';
        input_values['strength'] = config.strength ?? 0.7;
      } else if (nt === 'videoGeneration') {
        workflow_id = 'txt2video-workflow';
        if(node.data.inputValues?.image!=null)input_values['image']=await bridgeMediaToInput(node.data.inputValues.image,'image');
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
        return true;
      } else {
        // 通用处理：registry 查找 + 先合并上游输入，再合并用户配置
        try {
          const entry = NODE_MAP.get(nt);
          if (entry) { workflow_id = entry.workflowId; }
          // 1) 上游节点的输出作为输入
          Object.assign(input_values, node.data.inputValues || {});
          // 2) 用户配置覆盖
          Object.assign(input_values, config);
          // 合并 kv 参数
          Object.entries(config).forEach(([k, v]) => { if (k.includes(':')) input_values[k] = v; });
        } catch (error) { throw new Error(error instanceof Error ? error.message : '节点配置无效'); }
      }
      // New types: use registry workflow_id + config as input_values

      const resp = await generate({ workflow_id, input_values });
      get().updateNodeData(id, { promptId: resp.prompt_id });
      // 轮询结果
      const result = await pollResult(resp.prompt_id, (msg, pct) => {
        get().updateNodeData(id, { content: msg, progress: pct ?? undefined, generationDurationMs:Date.now()-startedAt });
      }, 2000, undefined, controller.signal);

      let resultUrl: string | undefined;
      if (result.success && result.data && result.data.length > 0) {
        const all = result.data;
        const first = all[0];
        resultUrl = first.url;
        const outputVal: Record<string, unknown> = { results:all, output:first.url, url:first.url };
        for (const type of ['image','video','audio','text'] as const) {
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
        for (const type of ['image','video','audio','text'] as const) {
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
    const visited = new Set<string>();
    const planned = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const current = queue.shift()!;
      if (planned.has(current)) continue;
      planned.add(current);
      get().edges.filter(e => e.source === current).forEach(e => queue.push(e.target));
    }
    planned.forEach((taskId, index) => {
      queuedTaskIds.add(taskId);
      get().updateNodeData(taskId, { queuedAt: Date.now(), queueOrder: index, status: 'queued', content: '已加入本地执行队列' });
    });
    const executionQueue = [id];
    while (executionQueue.length > 0) {
      executionQueue.sort((left, right) => Number(get().nodes.find(node => node.id === left)?.data.queueOrder ?? 0) - Number(get().nodes.find(node => node.id === right)?.data.queueOrder ?? 0));
      const current = executionQueue.shift()!;
      queuedTaskIds.delete(current);
      if (visited.has(current)) continue;
      visited.add(current);
      const currentNode = get().nodes.find(node => node.id === current);
      if (currentNode?.data.status === 'paused') continue;
      get().updateNodeData(current, { queuedAt: undefined, queueOrder: undefined });
      const succeeded = await get().executeNode(current);
      if (!succeeded) continue;
      const downstream = get().edges.filter(e => e.source === current).map(e => e.target);
      downstream.forEach(taskId => executionQueue.push(taskId));
    }
    planned.forEach(taskId => {
      queuedTaskIds.delete(taskId);
      const node = get().nodes.find(item => item.id === taskId);
      if (node && node.data.status === 'queued') get().updateNodeData(taskId, { queuedAt: undefined, queueOrder: undefined, status: 'idle' });
    });
  },

  contextMenu: { visible: false, x: 0, y: 0, nodeId: null },
  showContextMenu: (x, y, nodeId) => set({ contextMenu: { visible: true, x, y, nodeId } }),
  hideContextMenu: () => set({ contextMenu: { visible: false, x: 0, y: 0, nodeId: null } }),
}));
