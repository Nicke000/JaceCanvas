import type { Node, Edge } from '@xyflow/react';

export type NodeComponentType =
  | 'textInput' | 'scriptInput' | 'sceneSettings' | 'compare' | 'asset' | 'imageGeneration' | 'imageToImage' | 'videoGeneration' | 'preview' | 'note' | 'frame' | 'reroute'
  | 'qwenImageGen' | 'qwenImageEdit' | 'zimageGen' | 'fluxImageGen' | 'sdxlIL'
  | 'fireRedEdit' | 'wanVideoGen' | 'ltxVideoGen' | 'lipSyncHuman' | 'personReplace'
  | 'gaussianSplat' | 'upscaleWatermark' | 'audioGen' | 'motionTransfer'
  | 'storyboardGPT' | 'intentImage' | 'booguImage' | 'kreaImage'
  | 'universalMaker' | 'toolSettings' | 'joyAIEcho'
  | 'refMultiFusion' | 'refWashImage' | 'refImageClear' | 'refImageToVideo'
  | 'storyboardPrompt' | 'storyboardRender' | 'timelineRender' | 'cinematographyKnowledge'
  | 'uploadNode' | 'downloadNode'
  | 'apiNode'  // 通用API节点（17个工作流）
  | 'localWorkflow'  // 本地导入的 ComfyUI 工作流 JSON 节点
  | 'chatNode' | 'videoTrim' | 'imageCrop'
  | 'paidTextToImage' | 'paidImageToImage' | 'paidTextToVideo' | 'paidImageToVideo' | 'paidCapability' | 'bailianTextToImage';

/* ========== IO 定义 ========== */
export type IOType = 'text' | 'image' | 'video' | 'audio' | 'number' | 'select' | '3d';

export interface PortDefinition {
  name: string;
  label: string;
  type: IOType;
  required?: boolean;
  default?: unknown;
  options?: { label: string; value: string }[];
}

export interface NodeConfig {
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  params: Record<string, unknown>;
}

/* ========== 执行状态 ========== */
export type NodeStatus = 'idle' | 'queued' | 'running' | 'paused' | 'success' | 'error';

export interface NodeIOValue {
  [portName: string]: unknown;
}

/* ========== 各节点配置预设 ========== */
export const NODE_CONFIGS: Partial<Record<NodeComponentType, NodeConfig>> = {
  textInput: {
    inputs: [{ name: 'settings', label: '场景设定', type: 'text' }],
    outputs: [{ name: 'text', label: '文本', type: 'text' }],
    params: { text: '' },
  },
  scriptInput: { inputs: [], outputs: [{ name:'scripts',label:'剧本段落',type:'text' }], params:{ scripts:[] } },
  compare: {
    inputs: [{name:'original',label:'原始素材',type:'image',required:true},{name:'processed',label:'处理后素材',type:'image',required:true}],
    outputs: [{name:'processed',label:'处理后素材',type:'image'}], params:{}
  },
  asset: {
    inputs: [],
    outputs: [{ name: 'output', label: '素材', type: 'image' }],
    params: {},
  },
  imageGeneration: {
    inputs: [
      { name: 'text', label: '提示词', type: 'text', required: true },
      { name: 'negative_text', label: '负面提示词', type: 'text', default: '' },
      { name: 'width', label: '宽度', type: 'number', default: 1024 },
      { name: 'height', label: '高度', type: 'number', default: 1024 },
      { name: 'model', label: '模型', type: 'select', default: 'sd-xl', options: [
        { label: 'SD XL', value: 'sd-xl' }, { label: 'SD 3', value: 'sd3' }, { label: 'Flux', value: 'flux' },
      ]},
    ],
    outputs: [{ name: 'image', label: '图片', type: 'image' }],
    params: { negative_text: '', width: 1024, height: 1024, model: 'sd-xl' },
  },
  imageToImage: {
    inputs: [
      { name: 'image', label: '参考图', type: 'image', required: true },
      { name: 'prompt', label: '提示词', type: 'text', default: '' },
      { name: 'strength', label: '变化强度', type: 'number', default: 0.7 },
    ],
    outputs: [{ name: 'image', label: '图片', type: 'image' }],
    params: { prompt: '', strength: 0.7 },
  },
  videoGeneration: {
    inputs: [
      { name: 'image', label: '起始图', type: 'image' },
      { name: 'prompt', label: '提示词', type: 'text', default: '' },
      { name: 'duration', label: '时长(秒)', type: 'number', default: 5 },
    ],
    outputs: [{ name: 'video', label: '视频', type: 'video' }],
    params: { prompt: '', duration: 5 },
  },
  videoTrim: {
    inputs: [{ name: 'video', label: '输入视频', type: 'video', required: true }],
    outputs: [
      { name: 'clip', label: '截取视频', type: 'video' },
      { name: 'firstFrame', label: '首帧', type: 'image' },
      { name: 'lastFrame', label: '尾帧', type: 'image' },
    ],
    params: { startFrame: 0, endFrame: 0, fps: 30 },
  },
  preview: {
    inputs: [{ name: 'media', label: '图片/视频/音频/文本', type: 'image' }],
    outputs: [{ name: 'output', label: '当前预览', type: 'image' }],
    params: {},
  },
  note: {
    inputs: [], outputs: [], params: { text: '' },
  },
  frame: {
    inputs: [], outputs: [], params: { label: '分组' },
  },
  reroute: {
    inputs: [{ name: 'input', label: '输入', type: 'text' }],
    outputs: [{ name: 'output', label: '输出', type: 'text' }],
    params: {},
  },
  // A-F: 图像类节点
  qwenImageGen: { inputs: [
    { name: 'prompt', label: '提示词', type: 'text', required: true },
    { name: 'negative_prompt', label: '负面提示词', type: 'text' },
    { name: 'width', label: '宽度', type: 'number', default: 1024 },
    { name: 'height', label: '高度', type: 'number', default: 1024 },
    { name: 'model', label: '模型', type: 'select', default: 'qwen-image', options: [{label:'Qwen Image',value:'qwen-image'}] },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  qwenImageEdit: { inputs: [
    { name: 'image', label: '输入图片', type: 'image', required: true },
    { name: 'prompt', label: '编辑指令', type: 'text', required: true },
    { name: 'strength', label: '编辑强度', type: 'number', default: 0.7 },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  zimageGen: { inputs: [
    { name: 'prompt', label: '提示词', type: 'text', required: true },
    { name: 'width', label: '宽度', type: 'number', default: 768 },
    { name: 'height', label: '高度', type: 'number', default: 1136 },
    { name: 'steps', label: '步数', type: 'number', default: 15 },
    { name: 'cfg', label: 'CFG', type: 'number', default: 1.5 },
    { name: 'seed', label: '种子', type: 'number', default: -1 },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  fluxImageGen: { inputs: [
    { name: 'prompt', label: '提示词', type: 'text', required: true },
    { name: 'width', label: '宽度', type: 'number', default: 1024 },
    { name: 'height', label: '高度', type: 'number', default: 1024 },
    { name: 'guidance', label: '引导强度', type: 'number', default: 3.5 },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  sdxlIL: { inputs: [
    { name: 'image', label: '输入图片', type: 'image', required: true },
    { name: 'prompt', label: '提示词', type: 'text' },
    { name: 'strength', label: '强度', type: 'number', default: 0.7 },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  fireRedEdit: { inputs: [
    { name: 'image', label: '输入图片', type: 'image', required: true },
    { name: 'prompt', label: '编辑指令', type: 'text', required: true },
    { name: 'mask', label: '蒙版(可选)', type: 'image' },
  ], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: {} },
  wanVideoGen: { inputs: [
    { name: 'image', label: '起始图片', type: 'image', required: true },
    { name: 'prompt', label: '视频描述', type: 'text', required: true },
    { name: 'duration', label: '时长(秒)', type: 'number', default: 5 },
    { name: 'fps', label: '帧率', type: 'number', default: 16 },
  ], outputs: [{ name: 'video', label: '视频', type: 'video' }], params: {} },
  // 上传/下载节点
  uploadNode: { inputs: [],
    outputs: [{ name: 'filename', label: '文件名', type: 'text' }, { name: 'url', label: 'URL', type: 'image' }],
    params: {} },
  downloadNode: { inputs: [{ name: 'url', label: '文件URL', type: 'image', required: true }],
    outputs: [], params: {} },
  apiNode: { inputs: [], outputs: [{ name: 'output', label: '输出', type: 'image' }], params: {} },
  chatNode: { inputs: [{ name: 'image', label: '图片', type: 'image' }, { name:'file', label:'文件/音视频', type:'audio' }], outputs: [{ name: 'text', label: '回复', type: 'text' }, { name: 'image', label: '图片', type: 'image' }, { name: 'video', label: '视频', type: 'video' }], params: { message: '', memory: true, historyLimit: 20 } },
  storyboardRender: { inputs: [{ name: 'script', label: '分镜JSON', type: 'text' }], outputs: [{ name: 'result', label: '结果', type: 'text' }], params: { provider: '', model: '', variants: 1, useEnglish: true, generateVideo: false, videoModel: '' } },
  timelineRender: { inputs: [{ name: 'results', label: '分镜结果', type: 'image' }], outputs: [{ name: 'video', label: '成片视频', type: 'video' }], params: {} },
  imageCrop: { inputs: [{ name: 'image', label: '输入图片', type: 'image', required: true }], outputs: [{ name: 'image', label: '裁切后图片', type: 'image' }], params: { x: 0, y: 0, width: 512, height: 512, aspectRatio: '1:1' } },
  paidTextToImage: { inputs: [{ name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: { prompt: '', aspectRatio: '1:1', width: 1024, height: 1024, model: '' } },
  paidImageToImage: { inputs: [{ name: 'image', label: '参考图', type: 'image', required: true }, { name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: { prompt: '', aspectRatio: '1:1', width: 1024, height: 1024, model: '' } },
  paidTextToVideo: { inputs: [{ name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'video', label: '视频', type: 'video' }], params: { prompt: '', aspectRatio: '16:9', resolution: 1080, width: 1280, height: 720, duration: 5, frameRate: 24, seed: -1, model: '' } },
  paidImageToVideo: { inputs: [{ name: 'image', label: '起始图', type: 'image', required: true }, { name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'video', label: '视频', type: 'video' }], params: { prompt: '', aspectRatio: '16:9', resolution: 1080, width: 1280, height: 720, duration: 5, frameRate: 24, seed: -1, model: '' } },
  paidCapability: { inputs: [{ name: 'image', label: '人物图片', type: 'image' }, { name: 'video', label: '参考视频', type: 'video' }, { name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'output', label: '生成结果', type: 'image' }], params: { capability: 'image-upscale', prompt: '', model: '' } },
  bailianTextToImage: { inputs: [{ name: 'prompt', label: '提示词', type: 'text' }], outputs: [{ name: 'image', label: '图片', type: 'image' }], params: { prompt: '', ratio: '1:1', resolution: 1024, seed: -1 } },
};

/* ========== 画布节点数据 ========== */
export interface CanvasNodeData {
  [key: string]: unknown;
  label: string;
  content?: string;
  color?: string;
  nodeType: NodeComponentType;
  /** 节点绑定的服务器（多服务器并行执行）；留空则跟随当前默认服务器。 */
  serverId?: string;
  /** 锁定：不可拖动/编辑 */
  locked?: boolean;
  /** 隐藏：不在画布显示 */
  hidden?: boolean;
  resultUrl?: string;
  prompt?: string;
  /** 节点配置参数 */
  config: Record<string, unknown>;
  /** 输入端口当前值 */
  inputValues: NodeIOValue;
  /** 输出端口当前值 */
  outputValues: NodeIOValue;
  /** 执行状态 */
  status: NodeStatus;
  /** 进度 0-100 */
  progress?: number;
  /** ComfyUI 当前正在执行节点的进度 0-100 */
  currentNodeProgress?: number;
  currentNodeId?: string;
  promptId?: string;
  results?: Array<{ type: 'image' | 'video' | 'audio' | 'text' | '3d'; url: string; filename?: string }>;
  generationStartedAt?: number;
  generationDurationMs?: number;
  /** 错误信息 */
  error?: string;
  /** 是否禁用 */
  disabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AppNode = Node<CanvasNodeData, NodeComponentType>;
export interface CanvasState { nodes: AppNode[]; edges: Edge[]; selectedNodeId: string | null; }
export interface HistorySnapshot { nodes: AppNode[]; edges: Edge[]; }
export interface Project {
  id: string; name: string; createdAt: number; updatedAt: number;
  canvasData: { nodes: AppNode[]; edges: Edge[]; };
  /** 项目关联的服务器配置快照（换环境时自动补入，防止节点 serverId 失效） */
  servers?: Array<{ id: string; name?: string; baseUrl: string; apiKey?: string; type?: string }>;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  nodeId?: string;
  timestamp: number;
  attachments?: Array<{
    name: string;
    mimeType: string;
    dataUrl?: string;
    url?: string;
    source?: 'local' | 'asset' | 'canvas' | 'history';
  }>;
  status?: 'complete' | 'stopped' | 'error';
}
export interface ChatSession {
  id: string;
  nodeId: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}
export type ToolAction = 'select' | NodeComponentType;

/* ========== 右键菜单 ========== */
export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
}


