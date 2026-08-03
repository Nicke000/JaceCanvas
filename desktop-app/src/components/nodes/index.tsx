import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CanvasNodeData } from '@/types';
import { useCanvasStore } from '@/stores/canvasStore';
import { getApiBase, uploadFile, type ResultItem } from '@/services/comfyui.service';
import { mediaFilesFromDrop, mediaTypeForFile } from '@/utils/fileDrop';
import { PromptActions } from '@/components/PromptActions';
import { CINEMATOGRAPHY_EFFECTS, EFFECT_GROUPS, formatEffects } from '@/config/cinematographyKnowledge';
import { optimizePrompt } from '@/services/promptOptimizer.service';
import { message } from 'antd';
import { useSettingsStore, type PaidApiNodeSettings } from '@/stores/settingsStore';
import { fetchModelsFromApi, sendChat, type ChatAttachment, type ChatTurn } from '@/services/chat.service';
import { ASPECT_RATIOS, PAID_CAPABILITIES, type PaidCapability } from '@/services/paidApi.service';
import { callPaidManage, type PaidManageItem } from '@/services/paidApi.service';
import { getPaidModelsForCapability } from '@/config/paidCapabilityCatalog';
import { getSupportedPaidCapabilities, PAID_CAPABILITY_LABELS } from '@/config/paidCapabilityCatalog';
import { PAID_API_ADAPTERS, getPaidModelsForAdapter, getPaidProvidersForCapability, type PaidProviderId } from '@/config/paidApiAdapters';
import { BAILIAN_RATIO_OPTIONS, BAILIAN_RESOLUTION_OPTIONS, BAILIAN_VIDEO_RATIO_OPTIONS, BAILIAN_VIDEO_RESOLUTION_OPTIONS } from '@/services/bailianTextToImage.service';
import { generateId, saveChatSession } from '@/utils';
import { getBailianImageSize } from '@/services/bailianTextToImage.service';

const ST: Record<string, { bg: string; icon: string; glow: string }> = {
  idle:    { bg: '#444', icon: '\u25CB', glow: '#444' },
  queued:  { bg: '#f59e0b', icon: '…', glow: '#f59e0b' },
  running: { bg: '#6366f1', icon: '\u25CF', glow: '#6366f1' },
  paused:  { bg: '#f59e0b', icon: 'Ⅱ', glow: '#f59e0b' },
  success: { bg: '#22c55e', icon: '\u2713', glow: '#22c55e' },
  error:   { bg: '#ef4444', icon: '\u2715', glow: '#ef4444' },
};

const DIMS = [{ l:'512',w:512,h:512 },{ l:'HD',w:768,h:1136 },{ l:'FHD',w:1080,h:1920 },{ l:'2K',w:1440,h:2560 },{ l:'4K',w:2160,h:3840 },{ l:'1:1',w:1024,h:1024 }];

type PortSpec = { id:string; label:string; type?:string };
type SP = { data: any; id: string; selected: boolean; icon: string; color: string; hasInput?: boolean; hasOutput?: boolean; inputs?:PortSpec[]; outputs?:PortSpec[]; resizable?: boolean; hideExec?: boolean; children?: React.ReactNode };

const portColor=(type?:string)=>type==='text'?'#a78bfa':type==='video'?'#f472b6':type==='audio'?'#fbbf24':'#38bdf8';
const openTextEditor=(nodeId:string,field:string,value:string,label:string,kind:'text'|'script'|'scene')=>window.dispatchEvent(new CustomEvent('ai-canvas-open-text-editor',{detail:{nodeId,field,value,label,kind}}));

function formatDuration(ms?: number) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  const seconds=Math.floor(ms/1000); return seconds<60?`${seconds}.${Math.floor(ms%1000/100)}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
}

/** 本地视频剪辑：由 Electron 主进程调用 FFmpeg 输出 MP4/H.264 和 PNG 帧。 */
export const VideoTrimNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const update = useCanvasStore(s => s.setNodeConfig);
  const input = String(d.inputValues?.video || d.inputValues?.url || d.config?.videoUrl || d.config?.assetUrl || d.resultUrl || '');
  const exportInput = String(d.config?.videoPath || input);
  const ref = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState({ duration: 0, fps: Number(d.config?.fps) || 30 });
  const [range, setRange] = useState({ start: Number(d.config?.startFrame) || 0, end: Number(d.config?.endFrame) || 0 });
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<{clip?:string;firstFrame?:string;lastFrame?:string}>({});
  const frame = 1 / Math.max(1, meta.fps);
  const maxFrame = Math.max(0, Math.round(meta.duration * meta.fps) - 1);
  const setFrame = (key: 'start'|'end', value: number) => {
    const next = Math.max(0, Math.min(maxFrame, Math.round(value)));
    setRange(r => { const n = key === 'start' ? {start:Math.min(next,r.end||maxFrame),end:r.end} : {start:r.start,end:Math.max(next,r.start+1)}; update(p.id,{config:{...d.config,startFrame:n.start,endFrame:n.end,fps:meta.fps}}); return n; });
  };
  const download = (url: string, name: string) => { const a=document.createElement('a');a.href=url;a.download=name;a.click(); };
  const exportAll = async () => {
    if (!exportInput || !meta.duration) return; setBusy(true);
    try {
      const api=(window as any).electronAPI;
      if (!api?.ffmpegTrimVideo) throw new Error('请使用 Electron 桌面版执行 FFmpeg 导出');
      const result=await api.ffmpegTrimVideo({input:exportInput,fps:meta.fps,startFrame:range.start,endFrame:range.end||maxFrame});
      const next={clip:result.clip,firstFrame:result.firstFrame,lastFrame:result.lastFrame}; setOutputs(next);
      const values={clip:result.clip,firstFrame:result.firstFrame,lastFrame:result.lastFrame}; useCanvasStore.getState().updateNodeData(p.id,{outputValues:values,results:[{type:'video',url:result.clip,filename:'trimmed.mp4'},{type:'image',url:result.firstFrame,filename:'first-frame.png'},{type:'image',url:result.lastFrame,filename:'last-frame.png'}],resultUrl:result.clip,status:'success',error:undefined}); Object.entries(values).forEach(([k,val])=>useCanvasStore.getState().propagateData(p.id,k,val));
    } catch (e) { useCanvasStore.getState().updateNodeData(p.id,{error:e instanceof Error?e.message:'导出失败',status:'error'}); } finally { setBusy(false); }
  };
  const chooseVideo = () => fileInputRef.current?.click();
  const onChooseVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) { useCanvasStore.getState().updateNodeData(p.id,{status:'error',error:'请选择视频文件'}); return; }
    try {
      const api = (window as any).electronAPI;
      if (api?.saveLocalAsset) {
        const saved = await api.saveLocalAsset({ name:file.name, folder:'video-trim', data:await file.arrayBuffer() });
        update(p.id,{videoUrl:saved.url,videoPath:saved.path,videoName:file.name});
      } else {
        const reader = new FileReader();
        reader.onload = () => update(p.id,{videoUrl:String(reader.result),videoName:file.name});
        reader.readAsDataURL(file);
      }
    } catch (error) { useCanvasStore.getState().updateNodeData(p.id,{status:'error',error:error instanceof Error ? error.message : '视频读取失败'}); }
    event.target.value = '';
  };
  useEffect(()=>{ setOutputs({}); if(!input)return; },[input]);
  return <NodeShell {...p} icon="✂" color="#f97316" inputs={[{id:'video',label:'输入视频',type:'video'}]} outputs={[{id:'clip',label:'剪辑后视频',type:'video'},{id:'firstFrame',label:'首帧',type:'image'},{id:'lastFrame',label:'尾帧',type:'image'}]} resizable>
    <div className="video-trim-node">
      {input?<video ref={ref} src={input} controls playsInline className="video-trim-preview" onLoadedMetadata={e=>{const v=e.currentTarget;const duration=v.duration||0;setMeta(m=>({duration,fps:m.fps}));setRange(r=>({start:Math.min(r.start,Math.max(0,Math.round(duration*meta.fps)-1)),end:r.end||Math.max(1,Math.round(duration*meta.fps)-1)}));}}/>:<div className="video-trim-empty">连接视频、从素材库拖入，或选择本地文件</div>}
      <button className="nodrag" onClick={chooseVideo} style={{marginBottom:5,fontSize:10}}>选择本地视频</button><input ref={fileInputRef} hidden type="file" accept="video/*,.mp4,.mov,.mkv,.avi,.webm" onChange={onChooseVideo}/>
      <div className="video-trim-time">{(range.start/frame).toFixed(2)}s — {((range.end||maxFrame)*frame).toFixed(2)}s · {meta.fps} FPS</div>
      <input className="video-trim-range" type="range" min={0} max={maxFrame||1} value={range.start} onChange={e=>setFrame('start',Number(e.target.value))}/><input className="video-trim-range" type="range" min={1} max={maxFrame||1} value={Math.max(1,range.end||1)} onChange={e=>setFrame('end',Number(e.target.value))}/>
      <div className="video-trim-controls"><button className="nodrag" onClick={()=>setFrame('start',range.start-1)}>入点 −1帧</button><button className="nodrag" onClick={()=>setFrame('start',range.start+1)}>入点 +1帧</button><button className="nodrag" onClick={()=>setFrame('end',(range.end||1)-1)}>出点 −1帧</button><button className="nodrag" onClick={()=>setFrame('end',(range.end||1)+1)}>出点 +1帧</button></div>
      <div className="video-trim-actions"><button className="nodrag video-trim-primary" disabled={!input||busy} onClick={exportAll}>{busy?'FFmpeg 导出中…':'截取并生成 MP4 输出'}</button>{outputs.clip&&<button className="nodrag" onClick={()=>download(outputs.clip!,'trimmed.mp4')}>下载 MP4</button>}{outputs.firstFrame&&<button className="nodrag" onClick={()=>download(outputs.firstFrame!,'first-frame.png')}>首帧</button>}{outputs.lastFrame&&<button className="nodrag" onClick={()=>download(outputs.lastFrame!,'last-frame.png')}>尾帧</button>}</div>
    </div>
  </NodeShell>;
});

export const ChatNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const update = useCanvasStore(s => s.setNodeConfig);
  const config = d.config || {};
  const [draft, setDraft] = useState(String(config.message || ''));
  const [busy, setBusy] = useState(false);
  const history = (Array.isArray(config.history) ? config.history : []) as ChatTurn[];
  const attachments = (Array.isArray(config.attachments) ? config.attachments : []) as ChatAttachment[];
  const settings = useSettingsStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [chatModels, setChatModels] = useState<string[]>(settings.chatModels || []);
  const [selectedModel, setSelectedModel] = useState(String(config.selectedModel || settings.chatModel || ''));
  const thinkingMode = String(config.thinkingMode || settings.chatThinkingMode) as 'auto' | 'fast' | 'deep';
  const [fetching, setFetching] = useState(false);
  const fetchModels = async () => {
    setFetching(true);
    try {
      const models = await fetchModelsFromApi(settings.chatProvider, settings.chatBaseUrl, settings.chatApiKey);
      setChatModels(models);
      if (models.length > 0) { if (!selectedModel || !models.includes(selectedModel)) setSelectedModel(models[0]); message.success('成功获取 ' + models.length + ' 个模型'); }
      else message.warning('未获取到模型列表');
    } catch (e: any) { message.error('拉取模型失败: ' + (e.message || '未知错误')); }
    finally { setFetching(false); }
  };
  useEffect(() => {
    if (selectedModel && selectedModel !== config.selectedModel) update(p.id, { selectedModel });
  }, [selectedModel, config.selectedModel, p.id, update]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);
  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const attachments = await Promise.all(files.map(file => new Promise<Record<string, string>>(resolve => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: String(reader.result) }); reader.readAsDataURL(file); })));
    update(p.id, { attachments: [...(Array.isArray(config.attachments) ? config.attachments : []), ...attachments] });
    event.target.value = '';
  };
  const send = async () => {
    const message = draft.trim();
    // 读取上游连接点的输入数据
    const inputPrompt = String(d.inputValues?.prompt || '');
    const inputImage = String(d.inputValues?.image || '');
    const inputFile = String(d.inputValues?.file || d.inputValues?.video || d.inputValues?.audio || d.inputValues?.url || '');
    const effectiveMessage = message || inputPrompt;
    if (!effectiveMessage && !attachments.length && !inputImage && !inputFile) return;
    setBusy(true);
    const inputHistory = config.memory === false ? [] : history.slice(-Math.max(0, Number(config.historyLimit) || 20));
    // 将上游图片作为附件加入
    const allAttachments = [...attachments];
    if (inputImage && !allAttachments.some(a => a.url === inputImage || a.dataUrl === inputImage)) {
      allAttachments.push({ name: '上游输入图片', mimeType: 'image/png', url: inputImage });
    }
    if (inputFile && !allAttachments.some(a => a.url === inputFile || a.dataUrl === inputFile)) {
      const isVideo = /\.(mp4|mov|mkv|webm|avi)(?:\?|$)/i.test(inputFile);
      const isAudio = /\.(mp3|wav|m4a|aac|flac|ogg)(?:\?|$)/i.test(inputFile);
      allAttachments.push({ name: '上游连接文件', mimeType: isVideo ? 'video/*' : isAudio ? 'audio/*' : 'application/octet-stream', url: inputFile });
    }
    try {
      const result = await sendChat(message || inputPrompt || '请分析我提供的文件。', allAttachments, inputHistory, undefined, { model: selectedModel || undefined, thinkingMode });
      const nextHistory = [...history, { role: 'user' as const, content: message }, { role: 'assistant' as const, content: result.text }];
      const outputValues: Record<string, unknown> = { text: result.text, output: result.text };
      const image = result.text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)]*)?/i)?.[0];
      const video = result.text.match(/https?:\/\/[^\s)]+\.(?:mp4|webm|mov)(?:\?[^\s)]*)?/i)?.[0];
      if (image) outputValues.image = image;
      if (video) outputValues.video = video;
      const attachmentHistory = [...((config.attachmentHistory as ChatAttachment[][]) || []), allAttachments];
      update(p.id, { message: '', history: nextHistory, attachmentHistory, attachments: [], outputValues, content: result.text, status: 'success', error: undefined });
      useCanvasStore.getState().propagateData(p.id, 'text', result.text);
      useCanvasStore.getState().propagateData(p.id, 'output', result.text);
      if (image) useCanvasStore.getState().propagateData(p.id, 'image', image);
      if (video) useCanvasStore.getState().propagateData(p.id, 'video', video);
      const sessionId = String(config.sessionId || generateId());
      update(p.id, { sessionId });
      await saveChatSession({ id: sessionId, nodeId: p.id, title: message.slice(0, 36) || '文件分析', messages: nextHistory.map((turn, index) => ({ id: `${p.id}-${index}`, role: turn.role, content: typeof turn.content === 'string' ? turn.content : '[多媒体消息]', nodeId: p.id, timestamp: Date.now() })), updatedAt: Date.now() });
      setDraft('');
    } catch (error) {
      useCanvasStore.getState().updateNodeData(p.id, { status: 'error', error: error instanceof Error ? error.message : '聊天请求失败' });
    } finally { setBusy(false); }
  };
  const removeAttachment = (index: number) => update(p.id, { attachments: attachments.filter((_, itemIndex) => itemIndex !== index) });
  const modelInitial = (selectedModel || settings.chatModel || 'AI').charAt(0).toUpperCase();
  const renderAttachThumb = (att: ChatAttachment) => {
    const url = att.dataUrl || att.url || '';
    if (att.mimeType?.startsWith('image/') && url) return <img src={url} alt={att.name} className="chat-bubble-attach-thumb" />;
    if (att.mimeType?.startsWith('video/') && url) return <span className="chat-bubble-attach-icon">🎬</span>;
    return <span className="chat-bubble-attach-icon">📎</span>;
  };
  return <NodeShell {...p} icon="✦" color="#22d3ee" inputs={[{ id: 'prompt', label: '消息', type: 'text' }, { id: 'image', label: '图片', type: 'image' }, { id: 'file', label: '文件/音视频', type: 'audio' }]} outputs={[{ id: 'text', label: '回复', type: 'text' }, { id: 'image', label: '图片', type: 'image' }, { id: 'video', label: '视频', type: 'video' }]} resizable>
    <div className="chat-node-content nodrag" style={{ userSelect: 'text' }}>
      <div className="chat-node-toolbar">
        <span className="chat-node-status">{busy ? '正在思考…' : '在线对话'}</span>
        {chatModels.length > 0 ? <select className="chat-node-model-select nodrag" value={selectedModel} onChange={e => setSelectedModel(e.target.value)} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 4, border: '1px solid rgba(34,211,238,.3)', background: '#0a1628', color: '#67e8f9', maxWidth: 120 }}>{chatModels.map(m => <option key={m} value={m}>{m}</option>)}</select> : <button className="nodrag" onClick={fetchModels} disabled={fetching} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid rgba(34,211,238,.3)', background: 'transparent', color: '#67e8f9', cursor: 'pointer' }}>{fetching ? '…' : '拉取模型'}</button>}
        <select className="chat-node-model-select nodrag" value={thinkingMode} onChange={e => update(p.id,{thinkingMode:e.target.value})} style={{ fontSize: 9, padding: '1px 3px', borderRadius: 4, border: '1px solid rgba(34,211,238,.3)', background: '#0a1628', color: '#67e8f9', maxWidth: 54 }}><option value="auto">自动</option><option value="fast">快速</option><option value="deep">深度</option></select>
        <span>{history.length / 2} 轮记忆</span>
        <button className="chat-node-clear" onClick={() => update(p.id, { history: [], content: '' })}>清空</button>
      </div>
      <div className="chat-node-messages" onWheel={e => e.stopPropagation()}>
        {history.length === 0 && <div className="chat-node-empty"><span>✦</span><b>开始一段创作对话</b><small>支持图片、文档和多轮记忆</small></div>}
        {history.map((turn, index) => {
          const messageAttachments = turn.role === 'user' ? ((config.attachmentHistory as ChatAttachment[][] | undefined)?.[Math.floor(index / 2)] || []) : [];
          return <div key={`${turn.role}-${index}`} className={`chat-bubble chat-bubble--${turn.role}`}><span className="chat-bubble-avatar" style={{ background: turn.role === 'user' ? '#8b5cf6' : '#22d3ee' }}>{turn.role === 'user' ? '你' : modelInitial}</span><div className="chat-bubble-body">{messageAttachments.length > 0 && <div className="chat-bubble-attachments">{messageAttachments.map((attachment, attachmentIndex) => <span className="chat-bubble-attach-item" key={`${attachment.name}-${attachmentIndex}`}>{renderAttachThumb(attachment)}<small>{attachment.name}</small></span>)}</div>}<div className="chat-bubble-text">{typeof turn.content === 'string' ? turn.content : '多媒体消息'}</div></div></div>;
        })}
        {busy && <div className="chat-bubble chat-bubble--assistant chat-bubble--typing"><span className="chat-bubble-avatar" style={{ background: '#22d3ee' }}>{modelInitial}</span><div className="chat-bubble-body"><i/><i/><i/></div></div>}
        <div ref={messagesEndRef} />
      </div>
      {attachments.length > 0 && <div className="chat-node-attachments">{attachments.map((attachment, index) => <div className="chat-attachment" key={`${attachment.name}-${index}`}>{attachment.mimeType.startsWith('image/') && attachment.dataUrl ? <img src={attachment.dataUrl} alt={attachment.name}/> : <span>▧</span>}<label title={attachment.name}>{attachment.name}</label><button onClick={() => removeAttachment(index)}>×</button></div>)}</div>}
      <textarea value={draft} onChange={e => { setDraft(e.target.value); update(p.id, { message: e.target.value }); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="输入消息，Enter 发送 · Shift+Enter 换行" />
      <div className="chat-node-actions"><label className="chat-attach-button"><input type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.doc,.docx,.mp4,.mov" hidden onChange={onFile}/>＋ 添加图片/文件</label><label className="chat-memory"><input type="checkbox" checked={config.memory !== false} onChange={e => update(p.id, { memory: e.target.checked })}/> 记忆</label><button className="chat-send-button" disabled={busy || (!draft.trim() && !attachments.length)} onClick={() => void send()}>{busy ? '…' : '发送 ↗'}</button></div>
    </div>
  </NodeShell>;
});

/** Video2X 开源本地模型节点：只由应用内置的 Video2XQt6 执行，不调用系统安装版本。 */
export const Video2XLocalNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const setConfig = useCanvasStore(s => s.setNodeConfig);
  const [busy, setBusy] = useState(false);
  const input = String(d.config?.inputPath || d.inputValues?.video || '');
  const preview = String(d.config?.previewUrl || d.inputValues?.video || '');
  const mode = String(d.config?.mode || 'upscale');
  const pickVideo = async () => {
    const inputEl = document.createElement('input'); inputEl.type = 'file'; inputEl.accept = 'video/*,.mp4,.mkv,.mov,.avi';
    const file = await new Promise<File | undefined>(resolve => { inputEl.onchange = () => resolve(inputEl.files?.[0]); inputEl.click(); });
    if (!file) return;
    const api = (window as any).electronAPI;
    if (!api?.saveLocalAsset) { useCanvasStore.getState().updateNodeData(p.id, { status:'error', error:'请使用 Electron 桌面版运行 Video2X 本地节点' }); return; }
    const data = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
    const saved = await api.saveLocalAsset({ name: file.name, data });
    setConfig(p.id, { inputPath: saved.path, previewUrl: saved.url });
  };
  const process = async () => {
    if (!input) return;
    const api = (window as any).electronAPI;
    if (!api?.video2xProcess) { useCanvasStore.getState().updateNodeData(p.id, { status:'error', error:'请使用 Electron 桌面版运行 Video2X 本地节点' }); return; }
    setBusy(true); useCanvasStore.getState().updateNodeData(p.id, { status:'running', progress:0, error:undefined });
    try {
      const result = await api.video2xProcess({ input, mode, scale:Number(d.config?.scale)||2, model:String(d.config?.model||'realesr-animevideov3'), frameRateMul:Number(d.config?.frameRateMul)||2 });
      const values = { video: result.url, output: result.url };
      useCanvasStore.getState().updateNodeData(p.id, { status:'success', progress:100, resultUrl:result.url, outputValues:values, results:[{type:'video',url:result.url,filename:result.filename}], content:'Video2X 处理完成' });
      useCanvasStore.getState().propagateData(p.id, 'video', result.url); useCanvasStore.getState().propagateData(p.id, 'output', result.url);
    } catch (e) { useCanvasStore.getState().updateNodeData(p.id, { status:'error', error:e instanceof Error ? e.message : 'Video2X 处理失败' }); }
    finally { setBusy(false); }
  };
  return <NodeShell {...p} icon="⚙" color="#06b6d4" inputs={[{id:'video',label:'输入视频',type:'video'}]} outputs={[{id:'video',label:'处理后视频',type:'video'}]} resizable>
    <div className="nodrag" style={{fontSize:10,color:'#67e8f9',fontWeight:700}}>Video2X Qt6 · 开源本地模型</div>
    <div className="nodrag" style={{fontSize:9,color:'#fbbf24',lineHeight:1.45,margin:'4px 0'}}>⚠ 本节点内置开源程序与模型，可能不适配所有电脑；请自行确认模型/素材许可证，不代表商业授权，禁止侵权使用。</div>
    {preview && <video src={preview} controls muted className="video-trim-preview" style={{maxHeight:130}} />}
    <div className="nodrag" style={{display:'grid',gap:4,marginTop:5}}>
      <button onClick={pickVideo}>选择本地视频</button>
      <select value={mode} onChange={e=>setConfig(p.id,{mode:e.target.value})}><option value="upscale">视频超分</option><option value="interpolate">视频补帧</option><option value="both">超分 + 补帧</option></select>
      <select value={String(d.config?.model||'realesr-animevideov3')} onChange={e=>setConfig(p.id,{model:e.target.value})}><option value="realesr-animevideov3">RealESRGAN AnimeVideo</option><option value="realesrgan-plus">RealESRGAN Plus</option><option value="realcugan">RealCUGAN</option><option value="rife-v4.26">RIFE v4.26</option></select>
      {(mode === 'upscale' || mode === 'both') && <select value={String(d.config?.scale||2)} onChange={e=>setConfig(p.id,{scale:Number(e.target.value)})}><option value="2">放大 2x</option><option value="3">放大 3x</option><option value="4">放大 4x</option></select>}
      {(mode === 'interpolate' || mode === 'both') && <select value={String(d.config?.frameRateMul||2)} onChange={e=>setConfig(p.id,{frameRateMul:Number(e.target.value)})}><option value="2">补帧至 2 倍</option><option value="4">补帧至 4 倍</option></select>}
      <button className="video-trim-primary" disabled={!input || busy} onClick={process}>{busy ? '处理中…' : '执行 Video2X'}</button>
    </div>
  </NodeShell>;
});

const NodeShell: React.FC<SP> = ({ data, id, selected, icon, color, hasInput = true, hasOutput = true, inputs, outputs, resizable = false, hideExec = false, children }) => {
  const nd = data as CanvasNodeData; const s = ST[nd.status || 'idle'];
  const inputPorts:PortSpec[]=inputs?.length?inputs:(hasInput?[{id:'input',label:'输入'}]:[]);
  const outputPorts:PortSpec[]=outputs?.length?outputs:(hasOutput?[{id:'output',label:'输出'}]:[]);
  const portRows=Math.max(inputPorts.length,outputPorts.length);
  const enqueue = useCanvasStore(u => u.enqueueNode);
  const pause = useCanvasStore(u => u.pauseNode);
  const sel = useCanvasStore(u => u.setSelectedNodeId);
  const ctx = useCanvasStore(u => u.showContextMenu);
  const updateNodeStyle = useCanvasStore(u => u.updateNodeStyle);
  const contentRef = useRef<HTMLDivElement>(null);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(nd.status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer)},[nd.status]);
  const elapsed=nd.status==='running'&&nd.generationStartedAt?now-nd.generationStartedAt:nd.generationDurationMs;
  const overallProgress=nd.status==='success'?100:Math.max(0,Math.min(100,nd.progress||0));
  const stepProgress=nd.status==='success'?100:Math.max(0,Math.min(100,nd.currentNodeProgress ?? 0));
  const doExec = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (nd.status === 'running') { pause(id); return; } enqueue(id); }, [id, enqueue, nd.status, pause]);
  useEffect(() => {
    // 可缩放节点的高度由 NodeResizer 完全控制，不能被内容观察器覆盖。
    if (resizable) return;
    const element = contentRef.current;
    if (!element) return;
    let frame = 0;
    const resizeIfNeeded = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const node = useCanvasStore.getState().nodes.find(item => item.id === id);
        const currentHeight = Number(node?.style?.height || 0);
        const neededHeight = Math.min(1400, Math.max(150, Math.ceil(element.scrollHeight + 86 + portRows * 13)));
        // 按内容实际高度只增不减：手动放大的节点保持用户尺寸，内容变多时继续撑高。
        if (!currentHeight || neededHeight > currentHeight + 4) updateNodeStyle(id, { height: neededHeight });
      });
    };
    const observer = new ResizeObserver(resizeIfNeeded);
    observer.observe(element);
    resizeIfNeeded();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [id, portRows, updateNodeStyle, children, resizable]);
  return (
    <div className={`node-shell ${selected ? 'is-selected' : ''} ${nd.queuedAt || nd.status === 'queued' ? 'is-queued' : ''}`} data-status={nd.status || 'idle'} onClick={() => sel(id)}
      onPointerDown={e => {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select, button, audio, video, .nodrag, .react-flow__handle')) e.stopPropagation();
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); ctx(e.clientX, e.clientY, id); }}
      style={{
        borderRadius: 10, background: 'var(--theme-panel)',
        border: `2px solid ${selected ? color : 'var(--theme-border)'}`,
        boxShadow: selected ? `0 0 20px ${color}44` : '0 1px 4px rgba(0,0,0,0.3)',
        width:'100%',height:resizable ? '100%' : 'auto',minWidth: portRows>3?280:220, minHeight: 150, maxWidth: resizable ? 'none' : 520, cursor: 'pointer',
        transition: 'border-color .15s ease, box-shadow .15s ease',
        opacity: nd.disabled ? 0.5 : 1, position: 'relative', color: 'var(--theme-text)', display: resizable ? 'flex' : undefined, flexDirection: resizable ? 'column' : undefined,
      }}>
      {resizable&&<NodeResizer isVisible={selected} minWidth={220} minHeight={150} maxWidth={1600} maxHeight={1200} color={color} handleStyle={{width:10,height:10}}/>}
      <div style={{
        background: `linear-gradient(135deg, ${color}22, ${color}11)`,
        borderBottom: `1px solid ${color}22`,
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
        borderTopLeftRadius: 8, borderTopRightRadius: 8,
      }}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#e0e0f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nd.label}</span>
        {!hideExec && <span onClick={doExec} title={nd.status === 'running' ? '点击取消任务' : nd.status + ' - 点击执行'}
          style={{
            width: 26, height: 26, borderRadius: '50%', background: s.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 13, color: '#fff',
            boxShadow: `0 0 10px ${s.glow}`, transition: 'all 0.3s',
            animation: nd.status === 'running' ? 'pulse 0.8s infinite' : (nd.status === 'success' ? 'glowPulse 2s infinite' : 'none'),
          }}>{nd.status === 'running' ? '×' : s.icon}</span>}
      </div>
      {portRows>0&&<div className="node-ports" style={{minHeight:portRows*26+10}}>
        {Array.from({length:portRows},(_,index)=>{
          const input=inputPorts[index],output=outputPorts[index];
          return <div className="node-port-row" key={index}>
            <div className="node-port node-port--input">{input&&<>
              <Handle id={input.id} type="target" position={Position.Left} title={`${input.label} (${input.type||'通用'})`}
                style={{background:portColor(input.type),left:3,top:'50%',border:'2px solid #16162a',zIndex:10}}/>
              <span title={input.label}>{input.label}</span>
            </>}</div>
            <div className="node-port node-port--output">{output&&<>
              <span title={output.label}>{output.label}</span>
              <Handle id={output.id} type="source" position={Position.Right} title={`${output.label} (${output.type||'通用'})`}
                style={{background:portColor(output.type),right:3,top:'50%',border:'2px solid #16162a',zIndex:10}}/>
            </>}</div>
          </div>;
        })}
      </div>}
      <div ref={contentRef} className="node-shell__content" style={{ padding: '10px 14px', fontSize: 12, minWidth: 0, minHeight: 0, overflow: 'auto', flex: resizable ? 1 : undefined, display: resizable ? 'flex' : undefined, flexDirection: resizable ? 'column' : undefined }}>{children ?? <div style={{ color: '#555' }}>点击配置...</div>}</div>
      {(nd.status === 'running' || nd.status === 'success') && <div className="node-progress-stack">
        <div className="node-progress-row"><span>整体</span><div><i style={{width:`${overallProgress}%`}}/></div><b>{Math.round(overallProgress)}%</b></div>
        <div className="node-progress-row"><span>步骤</span><div><i className="node-progress-step" style={{width:`${stepProgress}%`}}/></div><b>{Math.round(stepProgress)}%</b></div>
      </div>}
      {(elapsed!=null||nd.results?.length)&&<div className="node-stats">{elapsed!=null&&<span>耗时 {formatDuration(elapsed)}</span>}{nd.results?.length?<span>{nd.results.length} 个结果</span>:null}</div>}
      {nd.status === 'error' && nd.error && <div className="node-error" title={nd.error}>{nd.error}</div>}
    </div>
  );
};

/* === TextInput === */
export const TextInputNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const scene = String(d.inputValues?.settings || '');
  const publish = (text: string) => useCanvasStore.getState().propagateData(p.id, 'text', scene ? `${scene}\n\n${text}` : text);
  useEffect(() => { publish(String(d.config?.text || '')); }, [scene]);
  return <NodeShell {...p} icon="T" color="#6366f1" inputs={[{id:'settings',label:'场景设定',type:'text'}]} outputs={[{id:'text',label:'文本',type:'text'}]} resizable>
    {scene && <div className="text-scene-context">已合并场景设定</div>}
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:2}}><PromptActions nodeId={p.id} value={(d.config?.text as string)||''} kind="generic" fieldKey="text" onChange={v=>{const store=useCanvasStore.getState();store.setNodeConfig(p.id,{text:v});publish(v)}}/></div>
    <textarea className="nodrag" onFocus={()=>openTextEditor(p.id,'text',String(d.config?.text||''),'文本输入','text')} onPointerDown={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} placeholder="输入文本..." value={(d.config?.text as string)||''}
      onChange={e => {const store=useCanvasStore.getState();store.setNodeConfig(p.id,{text:e.target.value});publish(e.target.value)}}
      style={{width:'100%',height:'100%',flex:1,border:'1px solid #2a2a3e',borderRadius:6,padding:6,fontSize:12,resize:'none',minHeight:40,outline:'none',fontFamily:'inherit',background:'#0f0f1e',color:'#c0c0d0'}} />
  </NodeShell>;
});

/* === Multi-script text source === */
export const ScriptInputNode = memo((p:NodeProps)=>{
  const d=p.data as unknown as CanvasNodeData;
  const scripts=((d.config?.scripts as Array<{id:string;label:string;text:string}>)||[]);
  const setScripts=(next:typeof scripts)=>useCanvasStore.getState().setNodeConfig(p.id,{scripts:next});
  const change=(id:string,text:string)=>{const next=scripts.map(item=>item.id===id?{...item,text}:item);setScripts(next);useCanvasStore.getState().propagateData(p.id,`script-${id}`,text)};
  const add=()=>setScripts([...scripts,{id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,label:`场景 ${scripts.length+1}`,text:''}]);
  return <NodeShell {...p} icon="▤" color="#8b5cf6" hasInput={false} hasOutput={false}>
    <div className="script-list">{scripts.map((item,index)=><div className="script-row" key={item.id}>
      <input className="script-label nodrag" value={item.label} onChange={e=>setScripts(scripts.map(x=>x.id===item.id?{...x,label:e.target.value}:x))}/>
      <textarea className="script-text nodrag" onFocus={()=>openTextEditor(p.id,`script:${item.id}`,item.text,item.label,'script')} value={item.text} placeholder="输入该段剧本..." onChange={e=>change(item.id,e.target.value)}/>
      <span className="script-output-label">文本输出</span>
      <Handle id={`script-${item.id}`} type="source" position={Position.Right} title={`${item.label}（文本）`} style={{background:portColor('text'),right:4,top:'50%',border:'2px solid #16162a'}}/>
      {scripts.length>1&&<button className="script-remove nodrag" onClick={()=>setScripts(scripts.filter(x=>x.id!==item.id))}>×</button>}
    </div>)}</div>
    <button className="script-add nodrag" onClick={add}>＋ 添加剧本段落</button>
  </NodeShell>;
});

export const SceneSettingsNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const setConfig = useCanvasStore(u => u.setNodeConfig);
  const propagate = useCanvasStore(u => u.propagateData);
  const fields = [['era','时代'],['time','时间'],['location','地点'],['scene','场景'],['style','视觉风格'],['camera','镜头/画面'],['notes','其他要求']] as const;
  const save = () => { const value = JSON.stringify(d.config?.settings || d.config); const raw = JSON.parse(localStorage.getItem('ai-canvas-scene-settings') || '[]'); raw.unshift({id:Date.now().toString(36), name:`场景设定 ${new Date().toLocaleString()}`, value}); localStorage.setItem('ai-canvas-scene-settings',JSON.stringify(raw.slice(0,30))); alert('场景设定已保存'); };
  const publish = (config: Record<string, unknown>) => propagate(p.id, 'settings', Object.entries(config).filter(([,v])=>String(v).trim()).map(([k,v])=>`${k}: ${v}`).join('\n'));
  return <NodeShell {...p} icon="🎬" color="#f59e0b" hasInput={false} outputs={[{id:'settings',label:'设定',type:'text'}]}>
    <div style={{fontSize:10,color:'#fbbf24',marginBottom:5}}>视频/图片统一设定</div>
    {fields.map(([key,label]) => <input className="nodrag" key={key} placeholder={label} onFocus={()=>openTextEditor(p.id,key,String(d.config?.[key]||''),label,'scene')} value={String(d.config?.[key] || '')} onChange={e=>{const next={...d.config,[key]:e.target.value};setConfig(p.id,{[key]:e.target.value});publish(next)}} style={{width:'100%',marginBottom:3,padding:4,background:'#0f0f1e',border:'1px solid #3d3320',borderRadius:4,color:'#ddd',fontSize:10}}/>)}
    <button className="script-add nodrag" onClick={e=>{e.stopPropagation();save()}}>保存设定</button>
  </NodeShell>;
});

const mediaKind=(value:string, fallback:'image'|'video'|'audio'|'text'='image')=>{
  if (/\.(mp4|mov|webm|mkv|avi)(?:[?&]|$)/i.test(value)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)(?:[?&]|$)/i.test(value)) return 'audio';
  return fallback;
};
export const CompareNode = memo((p:NodeProps)=>{
  const d=p.data as unknown as CanvasNodeData;
  const original=String(d.inputValues?.original||''); const processed=String(d.inputValues?.processed||'');
  const updateStyle=useCanvasStore(u=>u.updateNodeStyle);
  const originalRef=useRef<HTMLImageElement|HTMLVideoElement|HTMLAudioElement|null>(null);
  const processedRef=useRef<HTMLImageElement|HTMLVideoElement|HTMLAudioElement|null>(null);
  useEffect(()=>{
    const elements=[originalRef.current,processedRef.current].filter(Boolean) as Array<HTMLImageElement|HTMLVideoElement|HTMLAudioElement>;
    if(!elements.length)return;
    const resize=()=>{
      const dimensions=elements.map(element=>{
          const width=element instanceof HTMLVideoElement?element.videoWidth:element instanceof HTMLImageElement?element.naturalWidth:0;
          const height=element instanceof HTMLVideoElement?element.videoHeight:element instanceof HTMLImageElement?element.naturalHeight:0;
        return width&&height?{width,height}:null;
      }).filter((value):value is {width:number;height:number}=>value!==null);
      if(!dimensions.length)return;
      const columnWidth=250;
      const mediaHeight=Math.max(150,...dimensions.map(({width,height})=>Math.min(520,height/width*columnWidth)));
      updateStyle(p.id,{width:Math.max(460,Math.min(560,columnWidth*2+28)),height:Math.max(300,Math.round(mediaHeight+190))});
    };
    const listeners=elements.map(element=>{
      const event=element instanceof HTMLVideoElement||element instanceof HTMLAudioElement?'loadedmetadata':'load';
      element.addEventListener(event,resize);
      return {element,event};
    });
    resize();
    return ()=>listeners.forEach(({element,event})=>element.removeEventListener(event,resize));
  },[p.id,original,processed,updateStyle]);
  const media=(url:string,label:string,ref:React.RefObject<HTMLImageElement|HTMLVideoElement|HTMLAudioElement|null>)=>{if(!url)return <div className="compare-empty">等待{label}</div>;const kind=mediaKind(url);return kind==='video'?<video ref={ref as React.RefObject<HTMLVideoElement>} src={url} controls muted className="compare-media nodrag"/>:kind==='audio'?<audio ref={ref as React.RefObject<HTMLAudioElement>} src={url} controls className="compare-media nodrag"/>:<img ref={ref as React.RefObject<HTMLImageElement>} src={url} className="compare-media" alt={label}/>};
  useEffect(()=>{if(processed){const store=useCanvasStore.getState();store.updateNodeData(p.id,{outputValues:{processed,url:processed}});store.propagateData(p.id,'processed',processed)}},[p.id,processed]);
  return <NodeShell {...p} icon="◐" color="#14b8a6" inputs={[{id:'original',label:'原图/原视频',type:'image'},{id:'processed',label:'处理后',type:'image'}]} outputs={[{id:'processed',label:'处理后',type:'image'}]} resizable>
    <div className="compare-grid"><div><b>处理前</b>{media(original,'原始素材',originalRef)}</div><div><b>处理后</b>{media(processed,'处理后素材',processedRef)}</div></div>
  </NodeShell>;
});

/* === Asset source === */
export const AssetNode = memo((p: NodeProps) => {
  const d=p.data as unknown as CanvasNodeData;
  const type=String(d.config?.assetType||'image');
  const value=(d.outputValues?.[type]??d.outputValues?.url) as string;
  return <NodeShell {...p} icon={type==='video'?'▶':type==='audio'?'♪':type==='text'?'T':'▧'} color="#0ea5e9" hasInput={false} outputs={[{id:type,label:type==='text'?'文本':'素材',type}]}>
    <div className="asset-node-type">{type==='image'?'图片':type==='video'?'视频':type==='audio'?'音频':'文字'}素材</div>
    {type==='image'&&value&&<img src={value} className="asset-node-media" alt=""/>}
    {type==='video'&&value&&<video src={value} className="asset-node-media" muted/>}
    {type==='audio'&&value&&<audio src={value} controls style={{width:'100%'}}/>}
    {type==='text'&&<div className="asset-node-text">{value||'空文本'}</div>}
    <div className="asset-node-hint">从右侧端口连接到工作流</div>
  </NodeShell>;
});

/* === Upload source === */
export const UploadNode = memo((p: NodeProps) => {
  const d=p.data as unknown as CanvasNodeData;
  const [dragging,setDragging]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [uploadProgress,setUploadProgress]=useState(0);
  const publish=useCallback((results:ResultItem[])=>{
    if(!results.length)return;
    const outputValues:Record<string,unknown>={results,files:results,url:results[0].url,filename:results[0].filename};
    results.forEach((item,index)=>{outputValues[`file_${index+1}`]=item.url;outputValues[`filename_${index+1}`]=item.filename||'';});
    for(const type of ['image','video','audio'] as const){
      const matched=results.filter(item=>item.type===type);
      if(matched.length){outputValues[type]=matched[0].url;outputValues[`${type}s`]=matched.map(item=>item.url);}
    }
    const store=useCanvasStore.getState();
    store.updateNodeData(p.id,{outputValues,results,resultUrl:results[0].url,status:'success',progress:100,
      content:`已读取 ${results.length} 个媒体文件`});
    Object.entries(outputValues).forEach(([key,value])=>store.propagateData(p.id,key,value));
  },[p.id]);
  const uploadFiles=useCallback(async(files:File[])=>{
    if(!files.length)return;
    setUploading(true);
    setUploadProgress(0);
    const store=useCanvasStore.getState();
    store.updateNodeData(p.id,{status:'running',progress:0,error:undefined,content:`正在上传 0/${files.length}`});
    try{
      const results:ResultItem[]=[...(store.nodes.find(n=>n.id===p.id)?.data.results||[]) as ResultItem[]];
      for(let i=0;i<files.length;i++){
        const file=files[i]; const filename=await uploadFile(file);
        const url=`${getApiBase()}/api/comfy/view?filename=${encodeURIComponent(filename)}&type=input`;
        results.push({type:mediaTypeForFile(file),url,filename});
        store.updateNodeData(p.id,{progress:Math.round((i+1)/files.length*100),content:`正在上传 ${i+1}/${files.length}`});
        setUploadProgress(Math.round((i+1)/files.length*100));
      }
      publish(results);
    }catch(error){store.updateNodeData(p.id,{status:'error',error:error instanceof Error?error.message:'上传失败'});}
    finally{setUploading(false);setUploadProgress(0);}
  },[p.id,publish]);
  const choose=useCallback((directory=false)=>{
    const input=document.createElement('input'); input.type='file'; input.multiple=true;
    input.accept='image/*,video/*,audio/*';
    if(directory)input.setAttribute('webkitdirectory','');
    input.onchange=()=>void uploadFiles(Array.from(input.files||[])); input.click();
  },[uploadFiles]);
  const onDrop=useCallback(async(e:React.DragEvent)=>{
    e.preventDefault();e.stopPropagation();setDragging(false);
    const raw=e.dataTransfer.getData('application/ai-asset');
    if(raw){
      try{const asset=JSON.parse(raw) as {name?:string;type?:ResultItem['type'];url?:string};
        if(asset.url&&asset.type){const existing=(useCanvasStore.getState().nodes.find(n=>n.id===p.id)?.data.results||[]) as ResultItem[];publish([...existing,{type:asset.type,url:asset.url,filename:asset.name}]);}
      }catch{} return;
    }
    await uploadFiles(await mediaFilesFromDrop(e.dataTransfer));
  },[publish,uploadFiles]);
  const results=d.results||[];
  const removeFile=(index:number)=>{const next=results.filter((_,i)=>i!==index);const store=useCanvasStore.getState();if(!next.length){store.updateNodeData(p.id,{results:[],outputValues:{},resultUrl:undefined,status:'idle',content:'暂无上传文件'});return;}publish(next);};
  const uploadOutputs=results.map((item,index)=>({id:`file_${index+1}`,label:`${index+1}. ${item.filename||'未命名文件'}`,type:item.type}));
  return <NodeShell {...p} icon="↥" color="#60a5fa" hasInput={false} outputs={uploadOutputs.length?uploadOutputs:[{id:'file_1',label:'文件1',type:'image'}]} resizable>
    <div className={`upload-node-zone nodrag ${dragging?'is-dragging':''}`}
      onDragEnter={e=>{e.preventDefault();e.stopPropagation();setDragging(true)}}
      onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy'}}
      onDragLeave={e=>{e.preventDefault();e.stopPropagation();setDragging(false)}} onDrop={onDrop}>
      <div className="upload-node-icon">{uploading?'◌':'↥'}</div>
      <div>{uploading?d.content:'拖入资产、图片、视频或文件夹'}</div>
      {uploading&&<div className="upload-node-progress"><i style={{width:`${uploadProgress}%`}}/><span>{uploadProgress}%</span></div>}
      <div className="upload-node-actions">
        <button disabled={uploading} onClick={e=>{e.stopPropagation();choose(false)}}>选择文件</button>
        <button disabled={uploading} onClick={e=>{e.stopPropagation();choose(true)}}>选择文件夹</button>
      </div>
    </div>
    {results.length>0&&<div className="upload-node-files nodrag">{results.map((item,index)=><div className="upload-node-file" key={`${item.url}-${index}`}><div className="upload-node-file-preview">{item.type==='video'?<video src={item.url} controls className="upload-node-media nodrag"/>:item.type==='audio'?<audio src={item.url} controls className="nodrag" style={{width:'100%'}}/>:<img src={item.url} className="upload-node-media" alt={item.filename||''}/>}</div><div className="upload-node-file-footer"><span title={item.filename||''}>{index+1}. {item.filename||'未命名文件'}</span><button className="upload-node-remove nodrag" onClick={e=>{e.stopPropagation();removeFile(index)}} disabled={uploading}>删除</button></div></div>)}</div>}
    {results.length>0&&<div className="upload-node-summary">
      <span>{results.length} 个文件</span>
      <span>{results.filter(r=>r.type==='image').length} 图 · {results.filter(r=>r.type==='video').length} 视频</span>
    </div>}
  </NodeShell>;
});

export const BailianTextToImageNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const settings = useSettingsStore();
  const update = useCanvasStore(s => s.setNodeConfig);
  const cfg = d.config || {};
  const ratio = String(cfg.ratio || '1:1');
  const resolution = Number(cfg.resolution) || 1024;
  const seed = Number(cfg.seed);
  const configured = Boolean(settings.bailianTextToImage?.apiKey);
  return <NodeShell {...p} icon="🔥" color="#ff7a45" inputs={[{ id:'prompt', label:'提示词', type:'text' }]} outputs={[{ id:'image', label:'图片', type:'image' }]} resizable>
    <div className="nodrag" style={{ display:'flex', gap:6, alignItems:'center', marginBottom:6, fontSize:10, color:'#ffd8bf' }}>
      <b style={{ flex:1 }}>文生图</b><span>z-image-turbo</span>
    </div>
    {!configured && <div style={{ fontSize:10, color:'#fbbf24', lineHeight:1.5, marginBottom:5 }}>请先到“设置 → 付费 API → 文生图”填写 API Key。</div>}
    <textarea className="nodrag" value={String(cfg.prompt || '')} onChange={e => update(p.id, { prompt:e.target.value })} placeholder="提示词（也可连接文本节点）" rows={3} style={{ width:'100%', resize:'vertical', background:'#21130e', color:'#fff1e8', border:'1px solid #7c2d12', borderRadius:5, padding:5, fontSize:10 }} />
    <div style={{ display:'flex', gap:4, marginTop:5 }}>
      <select className="nodrag" value={ratio} onChange={e => update(p.id, { ratio:e.target.value })} style={{ flex:1, background:'#21130e', color:'#fff1e8', border:'1px solid #7c2d12', borderRadius:5, padding:4, fontSize:10 }}>
        {BAILIAN_RATIO_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <select className="nodrag" value={resolution} onChange={e => update(p.id, { resolution:Number(e.target.value) })} style={{ flex:1, background:'#21130e', color:'#fff1e8', border:'1px solid #7c2d12', borderRadius:5, padding:4, fontSize:10 }}>
        {BAILIAN_RESOLUTION_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </div>
    <div style={{ marginTop:5, fontSize:10, color:'#fed7aa' }}>随机种子 <input className="nodrag" type="number" min="-1" max="2147483647" value={Number.isFinite(seed) ? seed : -1} onChange={e => update(p.id, { seed:Number(e.target.value) })} style={{ width:110, marginLeft:5, background:'#21130e', color:'#fff1e8', border:'1px solid #7c2d12', borderRadius:4, padding:3 }} /><span style={{ marginLeft:4, color:'#a8a29e' }}>-1 为随机</span></div>
  </NodeShell>;
});


/* === 4.6.8 可灵主体 / 音色管理节点 === */
const manageInputStyle: React.CSSProperties = { width: '100%', padding: '4px 6px', fontSize: 10, color: '#dbeafe', background: '#0b1020', border: '1px solid #4b3c72', borderRadius: 5, outline: 'none' };
const KlingManagePanel = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const settings = useSettingsStore();
  const update = useCanvasStore(s => s.setNodeConfig);
  const cfg = d.config || {};
  const kind: 'element' | 'voice' = cfg.capability === 'voice-manage' ? 'voice' : 'element';
  const kindLabel = kind === 'element' ? '主体' : '音色';
  const provider = String(cfg.provider || 'kling');
  const profile = settings.paidApiProviders?.[provider as keyof typeof settings.paidApiProviders];
  const inputImage = String(d.inputValues?.image || '');
  const inputAudio = String(d.inputValues?.audio || '');
  const [name, setName] = useState(String(cfg.manageName || ''));
  const [desc, setDesc] = useState(String(cfg.manageDescription || ''));
  const [mediaUrl, setMediaUrl] = useState(String(cfg.manageMediaUrl || ''));
  const [items, setItems] = useState<PaidManageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const effectiveMedia = mediaUrl || (kind === 'element' ? inputImage : inputAudio);

  const refresh = useCallback(async () => {
    if (!profile?.apiKey) { setStatus('请先在设置 → 付费 API 厂商配置中填写可灵的 API Key'); setItems([]); return; }
    setBusy(true); setStatus('');
    const result = await callPaidManage({ provider: 'kling', apiKey: profile.apiKey, baseUrl: profile.baseUrl, kind, action: 'list' });
    setBusy(false);
    if (result.ok) { setItems(result.items || []); setStatus(result.message); } else { setItems([]); setStatus(result.message); }
  }, [profile?.apiKey, profile?.baseUrl, kind]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!profile?.apiKey) { setStatus('请先填写可灵 API Key'); return; }
    if (!name.trim()) { setStatus(`请填写${kindLabel}名称`); return; }
    if (!effectiveMedia) { setStatus(kind === 'element' ? '请填写图片 URL 或连接图片输入' : '请填写音频 URL 或连接音频输入'); return; }
    setBusy(true); setStatus('');
    const result = await callPaidManage({ provider: 'kling', apiKey: profile.apiKey, baseUrl: profile.baseUrl, kind, action: 'create', name: name.trim(), description: desc.trim(), mediaUrl: effectiveMedia });
    setBusy(false);
    if (result.ok) {
      setStatus(result.message); setName(''); setDesc(''); setMediaUrl('');
      update(p.id, { manageName: '', manageDescription: '', manageMediaUrl: '' });
      await refresh();
    } else setStatus(result.message);
  };

  const remove = async (id: string) => {
    if (!profile?.apiKey) return;
    if (!window.confirm(`确定删除该${kindLabel}？删除后不可恢复。`)) return;
    setBusy(true);
    const result = await callPaidManage({ provider: 'kling', apiKey: profile.apiKey, baseUrl: profile.baseUrl, kind, action: 'delete', id });
    setBusy(false);
    setStatus(result.message);
    if (result.ok) await refresh();
  };

  return <NodeShell {...p} icon={kind === 'element' ? '👤' : '🎙️'} color={kind === 'element' ? '#38bdf8' : '#fb923c'} hasInput={false} hasOutput={false} hideExec resizable>
    <div className="nodrag" style={{ marginBottom: 6 }}>
      {!profile?.apiKey && <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.5, marginBottom: 5 }}>请到「设置 → 付费 API 厂商配置」填写可灵的 API Key 后使用。</div>}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: '#c4b5fd' }}>
        <select className="nodrag" value={provider} onChange={e => update(p.id, { provider: e.target.value })} style={manageInputStyle}>
          <option value="kling">{PAID_API_ADAPTERS.kling?.label || '快手·可灵'}</option>
        </select>
        <button className="nodrag" onClick={refresh} disabled={busy} style={{ flex: '0 0 auto', fontSize: 10, padding: '4px 10px', borderRadius: 5, border: '1px solid #38bdf8', background: 'rgba(56,189,248,.15)', color: '#7dd3fc', cursor: 'pointer' }}>{busy ? '…' : '刷新'}</button>
      </div>
    </div>
    <div className="nodrag" style={{ border: '1px solid var(--theme-border)', borderRadius: 7, padding: 8, marginBottom: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#7dd3fc', marginBottom: 5 }}>创建{kindLabel}</div>
      <input className="nodrag" placeholder={`${kindLabel}名称`} value={name} onChange={e => { setName(e.target.value); update(p.id, { manageName: e.target.value }); }} style={manageInputStyle} />
      {kind === 'element' && <input className="nodrag" placeholder="主体描述（可选）" value={desc} onChange={e => { setDesc(e.target.value); update(p.id, { manageDescription: e.target.value }); }} style={{ ...manageInputStyle, marginTop: 4 }} />}
      <input className="nodrag" placeholder={kind === 'element' ? '图片 URL（或连接图片输入端口）' : '音频 URL（或连接音频输入端口）'} value={mediaUrl} onChange={e => { setMediaUrl(e.target.value); update(p.id, { manageMediaUrl: e.target.value }); }} style={{ ...manageInputStyle, marginTop: 4 }} />
      {(kind === 'element' && inputImage) && <div style={{ fontSize: 9, color: '#86efac', marginTop: 3 }}>✓ 已接收图片输入（用于创建主体）</div>}
      {(kind === 'voice' && inputAudio) && <div style={{ fontSize: 9, color: '#86efac', marginTop: 3 }}>✓ 已接收音频输入（用于创建音色）</div>}
      <button className="nodrag" onClick={create} disabled={busy} style={{ marginTop: 6, width: '100%', fontSize: 10, padding: '5px 12px', borderRadius: 5, border: '1px solid #38bdf8', background: 'rgba(56,189,248,.22)', color: '#bae6fd', cursor: 'pointer' }}>{busy ? '处理中…' : `创建${kindLabel}`}</button>
    </div>
    <div style={{ fontSize: 10, marginBottom: 4, color: '#94a3b8' }}>已创建{kindLabel}（{items.length}）</div>
    <div style={{ maxHeight: 180, overflow: 'auto' }}>
      {items.length === 0 && !busy && <div style={{ fontSize: 10, color: '#64748b', padding: 6, textAlign: 'center' }}>暂无{kindLabel}，点击上方创建</div>}
      {items.map(item => (
        <div key={item.id} className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', border: '1px solid var(--theme-border)', borderRadius: 6, marginBottom: 4, background: 'rgba(255,255,255,.02)' }}>
          {item.preview && kind === 'element' ? <img src={item.preview} alt="" style={{ width: 26, height: 26, borderRadius: 4, objectFit: 'cover' }} /> : kind === 'voice' ? <span style={{ fontSize: 13 }}>🎙️</span> : <span style={{ fontSize: 13 }}>👤</span>}
          <span style={{ flex: 1, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.id}</span>
          <button className="nodrag" onClick={() => remove(item.id)} disabled={busy} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 4, border: '1px solid #ef4444', background: 'rgba(239,68,68,.12)', color: '#fca5a5', cursor: 'pointer' }}>删除</button>
        </div>
      ))}
    </div>
    {status && <div style={{ fontSize: 9, marginTop: 4, color: (/^已|^共|^✓/.test(status) ? '#86efac' : '#fbbf24') }}>{status}</div>}
  </NodeShell>;
});

/* === PaidGeneration === */
export const PaidGenerationNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const settings = useSettingsStore();
  const update = useCanvasStore(s => s.setNodeConfig);
  const cfg = d.config || {};
  const legacyCapability = d.nodeType === 'paidImageToImage' ? 'image-to-image' : d.nodeType === 'paidTextToVideo' ? 'text-to-video' : d.nodeType === 'paidImageToVideo' ? 'image-to-video' : 'text-to-image';
  const capability = String(cfg.capability || legacyCapability) as PaidCapability;
  const capabilityInfo = capability ? PAID_CAPABILITIES[capability] : undefined;
  const providerOptions = getPaidProvidersForCapability(capability).map(item => item.id);
  const configuredProvider = String(cfg.provider || providerOptions[0] || '') as PaidProviderId;
  const provider = PAID_API_ADAPTERS[configuredProvider];
  const providerSettings = settings.paidApiProviders?.[configuredProvider];
  const modelOptions = getPaidModelsForAdapter(configuredProvider, capability);
  const isVideo = capabilityInfo?.output === 'video';
  const needsImage = Boolean(capabilityInfo && ['image', 'first-last', 'image-video'].includes(capabilityInfo.input));
  const output = isVideo ? 'video' : 'image';
  const inputPorts = capabilityInfo?.input === 'first-last'
    ? [{id:'firstImage',label:'首帧图片',type:'image'},{id:'lastImage',label:'尾帧图片',type:'image'}]
    : capabilityInfo?.input === 'video'
      ? [{id:'video',label:'输入视频',type:'video'}]
      : capabilityInfo?.input === 'image-video'
        ? [{id:'image',label:'人物图片',type:'image'},{id:'video',label:'参考视频',type:'video'},{id:'audio',label:'参考音频',type:'audio'}]
      : needsImage ? [{id:'image',label:'参考素材',type:'image'}] : [];
  const ratio = String(cfg.aspectRatio || (isVideo ? '16:9' : '1:1'));
  const isBailian = configuredProvider === 'bailian';
  const resolution = Number(cfg.resolution) || (isVideo ? 1080 : 1024);
  const ratioOptions = isBailian ? (isVideo ? BAILIAN_VIDEO_RATIO_OPTIONS : BAILIAN_RATIO_OPTIONS) : ASPECT_RATIOS;
  const videoResolutionOptions = BAILIAN_VIDEO_RESOLUTION_OPTIONS;
  const setRatio = (value: string) => {
    const found = ASPECT_RATIOS.find(item => item.value === value);
    const next = { aspectRatio:value, ...(found ? { width:found.w, height:found.h } : {}) };
    if (isBailian && !isVideo) {
      const size = getBailianImageSize(resolution, value).split('*').map(Number);
      if (size.length === 2) Object.assign(next, { width:size[0], height:size[1] });
    }
    update(p.id, next);
  };
  const selectedModel = String(cfg.model || providerSettings?.selectedModel || modelOptions[0]?.id || '');
  if (capability === 'element-manage' || capability === 'voice-manage') {
    return <KlingManagePanel {...p} />;
  }
  return <NodeShell {...p} icon={isVideo ? '🎬' : '🎨'} color={isVideo ? '#ec4899' : '#a855f7'} inputs={[...inputPorts,...(isVideo && !inputPorts.some(port => port.id === 'audio') ? [{id:'audio',label:'音频输入',type:'audio'}] : []),{id:'prompt',label:'提示词',type:'text'}]} outputs={[{id:output,label:isVideo?'视频':'图片',type:output}]} resizable>
    <div className="nodrag" style={{display:'flex',gap:6,alignItems:'center',marginBottom:6,fontSize:10,color:'#c4b5fd'}}><b style={{flex:1}}>付费 API · {capabilityInfo?.label || '节点'}</b><span>{capabilityInfo?.description}</span></div>
    <div className="paid-node-provider-row nodrag"><select value={configuredProvider} onChange={e=>update(p.id,{provider:e.target.value,model:''})}>{providerOptions.map(id=><option key={id} value={id}>{PAID_API_ADAPTERS[id].label}</option>)}</select><select value={selectedModel} onChange={e=>update(p.id,{model:e.target.value})}>{modelOptions.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</select></div>
    {!providerSettings?.apiKey ? <div style={{fontSize:10,color:'#fbbf24',lineHeight:1.5}}>请到“设置 → 付费 API 厂商配置”填写 {provider?.label || '当前厂商'} 的 API Key。</div> : null}
      <textarea className="nodrag" value={String(cfg.prompt || '')} onChange={e=>update(p.id,{prompt:e.target.value})} placeholder={capabilityInfo?.input === 'image' ? '可选：输入编辑指令' : '输入提示词，或连接文本节点'} style={{width:'100%',minHeight:55,resize:'none',background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,padding:5,fontSize:10}} />
      <input className="nodrag" value={String(cfg.negativePrompt || '')} onChange={e=>update(p.id,{negativePrompt:e.target.value})} placeholder="负面提示词（可选）" style={{width:'100%',marginTop:4,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,padding:4,fontSize:10}} />
      {needsImage && <div style={{fontSize:9,color:d.inputValues?.image?'#86efac':'#fbbf24',marginTop:4}}>{d.inputValues?.image ? '✓ 已接收图片输入' : '等待图片输入连接'}</div>}
      <div style={{display:'flex',gap:4,marginTop:5}}><select className="nodrag" value={ratio} onChange={e=>setRatio(e.target.value)} style={{flex:1,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,padding:4,fontSize:10}}>{ratioOptions.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}{!isBailian && <option value="custom">自定义</option>}</select>{isBailian && !isVideo && <select className="nodrag" value={resolution} onChange={e=>{ const value=Number(e.target.value); const size=getBailianImageSize(value,ratio).split('*').map(Number); update(p.id,{resolution:value,width:size[0],height:size[1]}); }} style={{width:92,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,padding:4,fontSize:10}}>{BAILIAN_RESOLUTION_OPTIONS.map(item=><option key={item.value} value={item.value}>{item.value}px</option>)}</select>}{ratio==='custom'&&<><input className="nodrag" type="number" value={Number(cfg.width)||1024} onChange={e=>update(p.id,{width:Number(e.target.value)})} style={{width:58,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,fontSize:10}}/><input className="nodrag" type="number" value={Number(cfg.height)||1024} onChange={e=>update(p.id,{height:Number(e.target.value)})} style={{width:58,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:5,fontSize:10}}/></>}</div>
      <div style={{fontSize:9,color:'#94a3b8',marginTop:3}}>{isBailian && isVideo ? `输出规格：${resolution}P · ${ratio}（官方 resolution / ratio）` : `输出分辨率：${Number(cfg.width)||1024} × ${Number(cfg.height)||1024}`}</div>
      <div style={{display:'flex',gap:5,marginTop:5,fontSize:10,color:'#cbd5e1',alignItems:'center'}}><label>种子 <input className="nodrag" type="number" min="-1" value={Number.isFinite(Number(cfg.seed)) ? Number(cfg.seed) : -1} onChange={e=>update(p.id,{seed:Number(e.target.value)})} style={{width:58,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:4}} /></label>{isVideo && <label>时长 <input className="nodrag" type="number" min="1" max="60" value={Number(cfg.duration)||5} onChange={e=>update(p.id,{duration:Number(e.target.value)})} style={{width:42,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:4}} /> 秒</label>}{isVideo && isBailian && <label>分辨率 <select className="nodrag" value={resolution} onChange={e=>update(p.id,{resolution:Number(e.target.value)})} style={{width:68,background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:4,fontSize:10}}>{videoResolutionOptions.map(value=><option key={value} value={value}>{value}P</option>)}</select></label>}</div>
      {isVideo && <div style={{marginTop:5,fontSize:10,color:'#cbd5e1'}}>帧率 <input className="nodrag" type="number" min="1" max="120" value={Number(cfg.frameRate)||24} onChange={e=>update(p.id,{frameRate:Number(e.target.value)})} style={{width:48,margin:'0 4px',background:'#0b1020',color:'#dbeafe',border:'1px solid #4b3c72',borderRadius:4}} /> fps</div>}
  </NodeShell>;
});

/* === ImageCrop === */
export const ImageCropNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const update = useCanvasStore(s => s.setNodeConfig);
  const inputImage = String(d.inputValues?.image || d.config?.sourceImage || '');
  const config = d.config || {};
  const [crop, setCrop] = useState({ x: Number(config.x) || 0, y: Number(config.y) || 0, w: Number(config.width) || 512, h: Number(config.height) || 512 });
  const [aspect, setAspect] = useState(String(config.aspectRatio || 'original'));
  const [outputUrl, setOutputUrl] = useState(String(config.outputUrl || ''));
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropPreviewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragStart, setDragStart] = useState<{x:number;y:number}|null>(null);
  const [moveStart, setMoveStart] = useState<{point:{x:number;y:number}; crop:typeof crop}|null>(null);
  const ASPECTS = [{ label: '1:1', value: '1:1' }, { label: '4:3', value: '4:3' }, { label: '3:4', value: '3:4' }, { label: '16:9', value: '16:9' }, { label: '9:16', value: '9:16' }, { label: '3:2', value: '3:2' }, { label: '2:3', value: '2:3' }, { label: '自由', value: 'free' }];
  useEffect(() => {
    if (inputImage && imgRef.current?.complete) {
      const img = imgRef.current;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
      setCrop({ x: 0, y: 0, w: Math.max(1, Math.round(img.naturalWidth * scale)), h: Math.max(1, Math.round(img.naturalHeight * scale)) });
      setAspect('original');
    }
  }, [inputImage]);
  const handleCrop = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    canvas.width = crop.w;
    canvas.height = crop.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    const url = canvas.toDataURL('image/png');
    setOutputUrl(url);
    update(p.id, { x: crop.x, y: crop.y, width: crop.w, height: crop.h, aspectRatio: aspect, outputUrl: url });
    useCanvasStore.getState().propagateData(p.id, 'image', url);
    useCanvasStore.getState().updateNodeData(p.id, { resultUrl: url, outputValues: { image: url }, status: 'success', content: '裁切完成' });
  };
  const setAspectRatio = (value: string) => {
    setAspect(value);
    if (value !== 'free' && value !== 'original' && crop.w && crop.h) {
      const [wr, hr] = value.split(':').map(Number);
      if (wr && hr) {
        const h2 = Math.round(crop.w * hr / wr);
        if (h2 <= imgSize.h) { setCrop(c => ({ ...c, h: h2 })); }
        else { const w2 = Math.round(crop.h * wr / hr); setCrop(c => ({ ...c, w: w2 })); }
      }
    }
  };
  const chooseImage = () => fileInputRef.current?.click();
  const onChooseImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { useCanvasStore.getState().updateNodeData(p.id, { status: 'error', error: '请选择图片文件' }); return; }
    const reader = new FileReader();
    reader.onload = () => update(p.id, { sourceImage: String(reader.result), sourceName: file.name });
    reader.readAsDataURL(file);
    event.target.value = '';
  };
  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = cropPreviewRef.current?.getBoundingClientRect();
    if (!rect || !imgSize.w || !imgSize.h) return null;
    return { x: Math.max(0, Math.min(imgSize.w, Math.round((event.clientX - rect.left) * imgSize.w / rect.width))), y: Math.max(0, Math.min(imgSize.h, Math.round((event.clientY - rect.top) * imgSize.h / rect.height))) };
  };
  const startVisualCrop = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation(); const point = pointFromEvent(event); if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const inside = point.x >= crop.x && point.x <= crop.x + crop.w && point.y >= crop.y && point.y <= crop.y + crop.h;
    if (inside) setMoveStart({ point, crop }); else setDragStart(point);
  };
  const moveVisualCrop = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event); if (!point) return;
    if (moveStart) {
      const dx = point.x - moveStart.point.x; const dy = point.y - moveStart.point.y;
      setCrop(c => ({ ...c, x:Math.max(0, Math.min(imgSize.w - c.w, moveStart.crop.x + dx)), y:Math.max(0, Math.min(imgSize.h - c.h, moveStart.crop.y + dy)) }));
      return;
    }
    if (!dragStart) return;
    let w = Math.max(1, Math.abs(point.x - dragStart.x)); let h = Math.max(1, Math.abs(point.y - dragStart.y));
    const ratio = aspect === 'original' ? (imgSize.w / Math.max(1, imgSize.h)) : aspect !== 'free' ? Number(aspect.split(':')[0]) / Number(aspect.split(':')[1]) : 0;
    if (ratio > 0) { if (w / h > ratio) w = Math.round(h * ratio); else h = Math.round(w / ratio); }
    const x = point.x >= dragStart.x ? dragStart.x : dragStart.x - w; const y = point.y >= dragStart.y ? dragStart.y : dragStart.y - h;
    setCrop({ x:Math.max(0, Math.min(imgSize.w - w, x)), y:Math.max(0, Math.min(imgSize.h - h, y)), w:Math.min(w, imgSize.w), h:Math.min(h, imgSize.h) });
    if (aspect === 'free') setAspect('free');
  };
  const endVisualCrop = () => { setDragStart(null); setMoveStart(null); };
  return <NodeShell {...p} icon="✂" color="#f97316" inputs={[{ id: 'image', label: '输入图片', type: 'image' }]} outputs={[{ id: 'image', label: '裁切后图片', type: 'image' }]} resizable>
    <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#fbbf24', marginBottom: 4 }}><span style={{ flex: 1 }}>修图裁切</span><button onClick={chooseImage} style={{ border: '1px solid rgba(249,115,22,.55)', background: 'rgba(249,115,22,.14)', color: '#fbbf24', borderRadius: 4, fontSize: 9, padding: '2px 6px', cursor: 'pointer' }}>选择图片</button><input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onChooseImage} /></div>
    {inputImage ? <>
      <img ref={imgRef} src={inputImage} alt="原图" style={{ display: 'none' }} onLoad={() => { const img = imgRef.current; if (img) { setImgSize({ w: img.naturalWidth, h: img.naturalHeight }); } }} />
      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4 }}>原图: {imgSize.w}×{imgSize.h} | 裁切: {crop.w}×{crop.h} ({aspect})</div>
      <div ref={cropPreviewRef} className="image-crop-preview nodrag" onPointerDown={startVisualCrop} onPointerMove={moveVisualCrop} onPointerUp={endVisualCrop} onPointerCancel={endVisualCrop} style={{position:'relative',width:'100%',maxHeight:260,overflow:'hidden',borderRadius:6,border:'1px solid rgba(249,115,22,.35)',cursor:'crosshair',marginBottom:5}}><img src={inputImage} alt="裁切选择" draggable={false} style={{display:'block',width:'100%',maxHeight:260,objectFit:'contain',pointerEvents:'none'}}/>{imgSize.w>0&&<div style={{position:'absolute',left:`${crop.x/imgSize.w*100}%`,top:`${crop.y/imgSize.h*100}%`,width:`${crop.w/imgSize.w*100}%`,height:`${crop.h/imgSize.h*100}%`,border:'2px solid #fbbf24',background:'rgba(251,191,36,.12)',boxShadow:'0 0 0 999px rgba(0,0,0,.4)',pointerEvents:'none'}}/>}</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>{ASPECTS.map(a => <button key={a.value} className="nodrag" onClick={() => setAspectRatio(a.value)} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, border: aspect === a.value ? '1px solid #f97316' : '1px solid rgba(249,115,22,.3)', background: aspect === a.value ? 'rgba(249,115,22,.2)' : 'transparent', color: '#fbbf24', cursor: 'pointer' }}>{a.label}</button>)}</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <label style={{ fontSize: 9, color: '#94a3b8' }}>X: <input type="number" className="nodrag" value={crop.x} onChange={e => setCrop(c => ({ ...c, x: Math.max(0, Math.min(imgSize.w - crop.w, Number(e.target.value))) }))} style={{ width: 50, fontSize: 9, padding: '1px 3px', borderRadius: 3, border: '1px solid rgba(249,115,22,.3)', background: '#0a1628', color: '#e0f2fe' }} /></label>
        <label style={{ fontSize: 9, color: '#94a3b8' }}>Y: <input type="number" className="nodrag" value={crop.y} onChange={e => setCrop(c => ({ ...c, y: Math.max(0, Math.min(imgSize.h - crop.h, Number(e.target.value))) }))} style={{ width: 50, fontSize: 9, padding: '1px 3px', borderRadius: 3, border: '1px solid rgba(249,115,22,.3)', background: '#0a1628', color: '#e0f2fe' }} /></label>
        <label style={{ fontSize: 9, color: '#94a3b8' }}>W: <input type="number" className="nodrag" value={crop.w} onChange={e => setCrop(c => ({ ...c, w: Math.max(1, Math.min(imgSize.w - crop.x, Number(e.target.value))) }))} style={{ width: 50, fontSize: 9, padding: '1px 3px', borderRadius: 3, border: '1px solid rgba(249,115,22,.3)', background: '#0a1628', color: '#e0f2fe' }} /></label>
        <label style={{ fontSize: 9, color: '#94a3b8' }}>H: <input type="number" className="nodrag" value={crop.h} onChange={e => setCrop(c => ({ ...c, h: Math.max(1, Math.min(imgSize.h - crop.y, Number(e.target.value))) }))} style={{ width: 50, fontSize: 9, padding: '1px 3px', borderRadius: 3, border: '1px solid rgba(249,115,22,.3)', background: '#0a1628', color: '#e0f2fe' }} /></label>
      </div>
      <button className="nodrag" onClick={handleCrop} style={{ fontSize: 9, padding: '3px 12px', borderRadius: 4, border: '1px solid #f97316', background: 'rgba(249,115,22,.2)', color: '#fbbf24', cursor: 'pointer', marginBottom: 4 }}>执行裁切</button>
      {outputUrl && <img src={outputUrl} alt="裁切结果" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4, border: '1px solid rgba(249,115,22,.3)' }} />}
    </> : <div style={{ fontSize: 9, color: '#64748b', padding: 8, textAlign: 'center' }}>点击“选择图片”导入，或从左侧资产/画布连接图片到输入端口</div>}
    <canvas ref={canvasRef} style={{ display: 'none' }} />
  </NodeShell>;
});

/* === ImageGeneration === */
export const ImageGenerationNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const w=(d.config?.width as number)||768, h=(d.config?.height as number)||1136;
  const sc=useCanvasStore(u=>u.setNodeConfig); const id=p.id;
  return <NodeShell {...p} icon="🎨" color="#a855f7" inputs={[{id:'text',label:'提示词',type:'text'}]} outputs={[{id:'image',label:'图片',type:'image'}]}>
    <div style={{display:'flex',justifyContent:'flex-end'}}><PromptActions nodeId={p.id} value={(d.config?.text as string)||''} kind="image" fieldKey="text" onChange={v=>sc(id,{text:v})}/></div>
    <input placeholder="提示词..." value={(d.config?.text as string)||''}
      onChange={e=>sc(id,{text:e.target.value})}
      style={{width:'100%',border:'1px solid #2a2a3e',borderRadius:6,padding:6,fontSize:12,outline:'none',marginBottom:6,background:'#0f0f1e',color:'#c0c0d0'}} />
    <div style={{display:'flex',gap:3,flexWrap:'wrap',marginBottom:6}}>
      {DIMS.map(dm=><span key={dm.l} onClick={()=>sc(id,{width:dm.w,height:dm.h})}
        style={{fontSize:10,padding:'2px 6px',borderRadius:4,cursor:'pointer',transition:'all 0.15s',background:w===dm.w&&h===dm.h?'#a855f7':'#1e1e30',color:w===dm.w&&h===dm.h?'#fff':'#777'}}>{dm.l}</span>)}
    </div>
    <div style={{fontSize:10,color:'#666'}}>步:{String(d.config?.steps||15)} CFG:{String(d.config?.cfg||1.5)} {w}×{h}</div>
  </NodeShell>;
});

/* === ImageToImage === */
export const ImageToImageNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  return <NodeShell {...p} icon="🔄" color="#06b6d4" inputs={[{id:'image',label:'参考图',type:'image'},{id:'prompt',label:'提示词',type:'text'}]} outputs={[{id:'image',label:'图片',type:'image'}]}>
    <div style={{display:'flex',justifyContent:'flex-end'}}><PromptActions nodeId={p.id} value={(d.config?.prompt as string)||''} kind="image-edit" fieldKey="prompt" imageContext={d.inputValues?.image?[`参考图/输入图：${String(d.inputValues.image)}`]:[]} onChange={v=>useCanvasStore.getState().setNodeConfig(p.id,{prompt:v})}/></div><div style={{fontSize:12}}><div>参考图: {d.inputValues?.image?'✅ 已接收':'⏳ 等待上游'}</div>
    <div style={{fontSize:10,color:'#666',marginTop:3}}>强度: {(d.config?.strength as number)||0.7}</div></div>
  </NodeShell>;
});

/* === VideoGeneration === */
export const VideoGenerationNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  return <NodeShell {...p} icon="🎬" color="#ec4899" inputs={[{id:'image',label:'起始图',type:'image'},{id:'prompt',label:'提示词',type:'text'}]} outputs={[{id:'video',label:'视频',type:'video'}]}>
    <div style={{display:'flex',justifyContent:'flex-end'}}><PromptActions nodeId={p.id} value={(d.config?.prompt as string)||''} kind="image-to-video" fieldKey="prompt" imageContext={d.inputValues?.image?[`首图/起始图：${String(d.inputValues.image)}`]:[]} onChange={v=>useCanvasStore.getState().setNodeConfig(p.id,{prompt:v})}/></div><div style={{fontSize:12}}><div>{((d.config?.prompt as string)||'').slice(0,40)||'点击配置提示词'}</div>
    <div style={{fontSize:10,color:'#666',marginTop:3}}>时长: {String(d.config?.duration||5)}s</div></div>
  </NodeShell>;
});

/* === Preview === */
export const PreviewNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const [selected,setSelected]=useState(0);
  const updateStyle=useCanvasStore(u=>u.updateNodeStyle);
  const mediaRef=useRef<HTMLImageElement|HTMLVideoElement|null>(null);
  const raw=(d.inputValues?.results||d.results||[]) as Array<{type:string;url:string;filename?:string}>;
  const fallbackUrl=(d.inputValues?.image||d.inputValues?.video||d.inputValues?.audio||d.inputValues?.text||d.inputValues?.media||d.inputValues?.input||d.inputValues?.url) as string;
  const fallbackType=d.inputValues?.video?'video':d.inputValues?.audio?'audio':d.inputValues?.text?'text':mediaKind(String(fallbackUrl||''));
  const results=raw.length?raw:(fallbackUrl?[{type:fallbackType,url:fallbackUrl}]:[]);
  const index=Math.min(selected,Math.max(0,results.length-1)); const current=results[index];
  useEffect(()=>{if(selected>=results.length)setSelected(0)},[results.length,selected]);
  useEffect(()=>{
    if(!current)return;
    const media=current.type==='video'?'video':current.type==='audio'?'audio':current.type==='text'?'text':'img';
    const element=mediaRef.current;
    if(!element || media==='text')return;
    const resize=()=>{
      const width=element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
      const height=element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
      if(!width||!height)return;
      const maxWidth=520; const maxHeight=620; const scale=Math.min(maxWidth/width,maxHeight/height,1);
      updateStyle(p.id,{width:Math.max(280,Math.round(width*scale)),height:Math.max(220,Math.round(height*scale)+72)});
    };
    const event=media==='video'?'loadedmetadata':'load';
    element.addEventListener(event,resize);
    if(media==='video' && (element as HTMLVideoElement).readyState>=1)resize();
    if(media==='img' && (element as HTMLImageElement).complete)resize();
    return ()=>element.removeEventListener(event,resize);
  },[p.id,current?.url,current?.type,updateStyle]);
  const resultSignature=results.map(item=>`${item.type}:${item.url}`).join('|');
  useEffect(()=>{
    if(!current)return;
    const store=useCanvasStore.getState();
    const outputValues:Record<string,unknown>={results,url:current.url,filename:current.filename,[current.type]:current.url};
    results.forEach((item,i)=>{outputValues[`result-${i}`]=item.url;});
    for(const type of ['image','video','audio','text'] as const){const urls=results.filter(item=>item.type===type).map(item=>item.url);if(urls.length)outputValues[`${type}s`]=urls;}
    store.updateNodeData(p.id,{outputValues,results:results as CanvasNodeData['results'],resultUrl:current.url});
    Object.entries(outputValues).forEach(([key,value])=>store.propagateData(p.id,key,value));
  },[p.id,index,resultSignature]);
  const download=useCallback(async(e:React.MouseEvent)=>{
    e.stopPropagation();if(!current)return;
    try{const response=await fetch(current.url);if(!response.ok)throw new Error();const blob=await response.blob();const objectUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=objectUrl;a.download=current.filename||`preview.${current.type==='video'?'mp4':current.type==='audio'?'mp3':'png'}`;a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    }catch{window.open(current.url,'_blank');}
  },[current?.url,current?.filename,current?.type]);
  const resultOutputs=results.map((item,i)=>({id:`result-${i}`,label:`结果 ${i+1}`,type:item.type}));
  return <NodeShell {...p} icon="◎" color="#22c55e" hasInput={false} inputs={[{id:'media',label:'图片/视频/结果',type:'image'}]} outputs={resultOutputs} hasOutput={false} resizable>
    <div className="preview-content">
      {current&&<button className="preview-download nodrag" onClick={download}>↓ 下载</button>}
      {!current?<div className="preview-empty">连接生成或素材节点以预览</div>:current.type==='video'?<video ref={element=>{mediaRef.current=element}} src={current.url} controls className="preview-main"/>:current.type==='audio'?<audio src={current.url} controls style={{width:'100%'}}/>:current.type==='text'?<div className="preview-text">{current.url}</div>:<img ref={element=>{mediaRef.current=element}} src={current.url} className="preview-main" alt={current.filename||''}/>} 
      {results.length>0&&<div className="preview-thumbs">{results.map((item,i)=><div className="preview-thumb-port" key={`${item.url}-${i}`}><button className={`${i===index?'is-active ':''}nodrag`} onClick={e=>{e.stopPropagation();setSelected(i)}}>{item.type==='image'?<img src={item.url} alt=""/>:<span>{item.type==='video'?'▶':item.type==='audio'?'♪':'T'} {i+1}</span>}</button><span className="preview-thumb-label">结果 {i+1}</span><Handle id={`result-${i}`} type="source" position={Position.Right} title={`连接第 ${i+1} 个结果`} style={{background:portColor(item.type),right:-6,bottom:3,top:'auto',border:'2px solid #16162a',zIndex:10}}/></div>)}</div>}
    </div>
  </NodeShell>;
});

/* === GenericNode - covers all 25 new types via META config === */
type Meta = { label:string; icon:string; color:string; cat:string; wf:string; cls:string; dp:Record<string,unknown>;
  inputs:{name:string;label:string;type:string;required?:boolean;default?:unknown;options?:{label:string;value:string}[]}[];
  outputs:{name:string;label:string;type:string}[];
};
import { NODE_REGISTRY } from '@/config/registry';
const META_MAP = new Map<string, Meta>();
NODE_REGISTRY.forEach(e => META_MAP.set(e.type, {
  label:e.label, icon:e.icon, color:e.color, cat:e.category,
  wf:e.workflowId, cls:e.comfyClass, dp:{...e.defaultParams},
  inputs:e.config.inputs.map(p=>({name:p.name,label:p.label,type:p.type,required:p.required,default:p.default,options:p.options})),
  outputs:e.config.outputs,
}));

export const GenericNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const meta = META_MAP.get(d.nodeType);
  const sc = useCanvasStore(u => u.setNodeConfig);
  const id = p.id;
  const isApiNode = d.nodeType === 'apiNode';
  const apiLabel = (d.config?._apiLabel as string) || d.label;

  if (!meta && !isApiNode) return <NodeShell {...p} icon="?" color="#666" hasInput={false} hasOutput={false}><div style={{color:'#888',fontSize:12}}>Unknown: {d.nodeType}</div></NodeShell>;

  const cfg = d.config as Record<string, unknown>;
  const shot = (cfg.shot && typeof cfg.shot === 'object' ? cfg.shot : {}) as Record<string, unknown>;
  const icon = isApiNode ? (d.color || '🔌') : meta?.icon || '?';
  const color = isApiNode ? (d.color || '#6366f1') : meta?.color || '#666';
  const apiFields=(cfg._apiFields as Array<{key:string;label:string;field:string;fileType?:string;type:string}>)||[];
  const apiPorts=apiFields.filter(field=>field.fileType||['string','text','textarea'].includes(String(field.type).toLowerCase()))
    .map(field=>({id:field.key,label:field.label,type:field.fileType||'text'}));
  const segmentCount = Math.max(1, Math.min(100, Number(cfg.segmentCount) || 3));
  const dynamicStoryboardOutputs = d.nodeType === 'storyboardPrompt' ? Array.from({length:segmentCount},(_,i)=>{const n=String(i+1).padStart(2,'0');return [{id:`segment_${n}_first_prompt`,label:`片段${i+1} 首帧`,type:'text'},{id:`segment_${n}_last_prompt`,label:`片段${i+1} 尾帧`,type:'text'},{id:`segment_${n}_video_prompt`,label:`片段${i+1} 视频`,type:'text'},{id:`segment_${n}_first_ref`,label:`片段${i+1} 首帧图`,type:'image'},{id:`segment_${n}_last_ref`,label:`片段${i+1} 尾帧图`,type:'image'}]}).flat() : [];
  const inputPorts:PortSpec[]=isApiNode?(apiPorts.length?apiPorts:[{id:'input',label:'输入'}]):(meta?.inputs.filter(ip=>['text','image','video','audio'].includes(ip.type)).map(ip=>({id:ip.name,label:ip.label,type:ip.type}))||[]);
  const outputPorts:PortSpec[]=isApiNode?[{id:'output',label:'结果',type:'image'},{id:'image',label:'图片',type:'image'},{id:'video',label:'视频',type:'video'},{id:'audio',label:'音频',type:'audio'},{id:'text',label:'文本',type:'text'}]:d.nodeType==='storyboardPrompt'?[{id:'storyboard_list',label:'分镜列表',type:'text'},...dynamicStoryboardOutputs,{id:'error_warning',label:'错误/警告',type:'text'}]: (meta?.outputs.map(op=>({id:op.name,label:op.label,type:op.type}))||[]);

  const renderParam = (ip: any) => {
    const val = cfg[ip.name] ?? ip.default ?? '';
    const s: React.CSSProperties = { width:'100%', border:'1px solid #2a2a3e', borderRadius:6, padding:4, fontSize:11, outline:'none', marginBottom:3, background:'#0f0f1e', color:'#c0c0d0' };
    if (ip.type === 'text') return <div><div style={{display:'flex',justifyContent:'flex-end'}}><PromptActions nodeId={id} value={String(val)} kind={/video|wan|ltx|motion/i.test(d.nodeType)?'image-to-video':/audio/i.test(d.nodeType)?'audio':/image|qwen|zimage|krea|flux/i.test(d.nodeType)?'image':'generic'} fieldKey={ip.name} onChange={v=>sc(id,{[ip.name]:v})}/></div><input placeholder={ip.label} value={String(val)} onChange={e=>sc(id,{[ip.name]:e.target.value})} style={s}/></div>;
    if (ip.type === 'number') return <input type="number" value={Number(val)} onChange={e=>sc(id,{[ip.name]:Number(e.target.value)})} style={s}/>;
    if (ip.type === 'select' && ip.options) return <select value={String(val)} onChange={e=>sc(id,{[ip.name]:e.target.value})} style={{...s,appearance:'auto'}}>{ip.options.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    return null;
  };

  const visInputs = isApiNode ? [] : (meta?.inputs?.filter((ip: any) => ip.type !== 'image').slice(0, 5) || []);
  const knowledgeSearch = String(cfg.search || '').toLowerCase();
  const knowledgeSelected = Array.isArray(cfg.selectedEffectIds) ? cfg.selectedEffectIds.map(String) : [];
  const visibleEffects = d.nodeType === 'cinematographyKnowledge' ? CINEMATOGRAPHY_EFFECTS.filter(effect => !knowledgeSearch || effect.term.toLowerCase().includes(knowledgeSearch)).slice(0, 16) : [];
  const toggleKnowledgeEffect = (effectId:string) => {
    const next = knowledgeSelected.includes(effectId) ? knowledgeSelected.filter(id=>id!==effectId) : [...knowledgeSelected,effectId];
    const result = formatEffects(next);
    sc(id,{selectedEffectIds:next, _knowledgePreview:result.constraints});
  };

  return <NodeShell {...p} icon={icon} color={color} hasInput={false} hasOutput={false} inputs={inputPorts} outputs={outputPorts}>
    <div style={{fontSize:10,color:'#888',marginBottom:3,fontWeight:600}}>{isApiNode ? apiLabel : meta?.label}</div>
    {d.nodeType === 'cinematographyKnowledge' && <div className="nodrag" style={{maxHeight:155,overflow:'auto',marginBottom:4}}>
      <input value={String(cfg.search||'')} onChange={e=>sc(id,{search:e.target.value})} placeholder="搜索影视效果术语" style={{width:'100%',background:'#0f0f1e',color:'#c0c0d0',border:'1px solid #2a2a3e',borderRadius:5,padding:4,fontSize:10,marginBottom:4}} />
      <div style={{display:'flex',flexWrap:'wrap',gap:3}}>{visibleEffects.map(effect=><button key={effect.id} onClick={()=>toggleKnowledgeEffect(effect.id)} style={{fontSize:9,padding:'2px 5px',borderRadius:4,border:'1px solid #3b3855',background:knowledgeSelected.includes(effect.id)?'#6651a8':'#202035',color:'#ddd',cursor:'pointer'}} title={`${effect.definition} ${effect.usage}`}>{effect.term}</button>)}</div>
      {Array.isArray(cfg._knowledgePreview)&&cfg._knowledgePreview.length>0&&<div style={{fontSize:9,color:'#f59e0b',marginTop:4}}>⚠ {cfg._knowledgePreview.join(' ')}</div>}
      <div style={{fontSize:9,color:'#777',marginTop:3}}>已选 {knowledgeSelected.length} 项，执行节点后输出结构化效果结果</div>
    </div>}
    {visInputs.map((ip: any) => <div key={ip.name}>{renderParam(ip)}</div>)}
    {meta && meta.inputs.length > 5 && <div style={{fontSize:9,color:'#555'}}>+{meta.inputs.length - 5} more params...</div>}
    {/* 显示生成进度 */}
    {d.status === 'running' && d.progress != null && (
      <div style={{margin:'4px 0',display:'flex',alignItems:'center',gap:4}}>
        <div style={{flex:1,height:4,background:'#1a1a30',borderRadius:2,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${Math.min(d.progress,100)}%`,background:'linear-gradient(90deg,#6366f1,#22c55e)',borderRadius:2,transition:'width 0.3s'}}/>
        </div>
        <span style={{fontSize:9,color:'#888'}}>{Math.min(d.progress||0,100)}%</span>
      </div>
    )}
    {d.status==='success'&&<div className="result-ready">结果已就绪，请连接到预览或下一个工作流</div>}
  </NodeShell>;
});

const stablePorts = (prefix:string, label:string, count:number):PortSpec[] => Array.from({length:count}, (_,i)=>({id:`${prefix}_${i+1}`, label:`${label}${i+1}`, type:'image'}));

export const CinematographyKnowledgeNode = memo((p: NodeProps) => {
  const d=p.data as unknown as CanvasNodeData; const cfg=d.config||{}; const setConfig=useCanvasStore(s=>s.setNodeConfig);
  const selected=Array.isArray(cfg.selectedEffectIds)?cfg.selectedEffectIds.map(String):[];
  const [open,setOpen]=useState<Record<string,boolean>>({});
  const updateInternals=useUpdateNodeInternals();
  useEffect(()=>{const timer=window.setTimeout(()=>updateInternals(p.id),0);return()=>window.clearTimeout(timer)},[open,p.id,updateInternals]);
  const toggle=(id:string)=>setConfig(p.id,{selectedEffectIds:selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]});
  const result=formatEffects(selected); const custom=String(cfg.customTerms||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
  return <NodeShell {...p} icon="🎥" color="#f59e0b" hasInput={false} resizable outputs={[{id:'promptText',label:'专业效果（可连接）',type:'text'}]}>
    <div className="nodrag" style={{fontSize:10,color:'#fbbf24',marginBottom:5}}>影视专业效果知识库</div>
    <div className="nodrag" style={{width:'100%'}}>{Object.entries(EFFECT_GROUPS).map(([category,terms])=><div key={category} style={{borderBottom:'1px solid #29263b'}}>
      <button className="nodrag" onClick={()=>setOpen(v=>({...v,[category]:!v[category]}))} style={{width:'100%',textAlign:'left',background:'none',border:0,color:'#ddd',padding:'5px 2px',fontSize:10,cursor:'pointer'}}>{open[category]?'▾':'▸'} {category} <span style={{color:'#777'}}>({terms.length})</span></button>
      {open[category]&&<div style={{display:'flex',flexWrap:'wrap',gap:3,padding:'0 2px 5px'}}>{terms.map(term=>{const item=CINEMATOGRAPHY_EFFECTS.find(e=>e.term===term&&e.category===category)!;return <button className="nodrag" key={item.id} onClick={()=>toggle(item.id)} title={`${item.definition}${item.usage}`} style={{border:'1px solid #3b3855',borderRadius:4,padding:'2px 5px',fontSize:9,color:selected.includes(item.id)?'#fff':'#aaa',background:selected.includes(item.id)?'#7958b5':'#202035'}}>{term}</button>})}</div>}
    </div>)}</div>
    <div style={{fontSize:9,color:'#a78bfa',marginTop:5}}>已选 {selected.length} 项{custom.length?`，自定义 ${custom.length} 项`:''}</div>
    {result.constraints.length>0&&<div style={{fontSize:9,color:'#f59e0b',marginTop:3}}>⚠ {result.constraints.join(' ')}</div>}
  </NodeShell>;
});

export const StoryboardPromptNode = memo((p: NodeProps) => {
  const d=p.data as unknown as CanvasNodeData; const cfg=d.config||{}; const count=Math.max(1,Math.min(100,Number(cfg.segmentCount)||3));
  const result=Array.isArray(cfg._segments)?cfg._segments as any[]:[];
  const [translating,setTranslating]=useState<Record<string,boolean>>({});
  const updateSegment=(index:number, field:'firstFrame'|'lastFrame'|'videoPrompt', value:string, english?:string) => {
    const next=result.map((segment:any)=>({...segment,firstFrame:{...(segment.firstFrame||{})},lastFrame:{...(segment.lastFrame||{})}}));
    if(field==='videoPrompt'){next[index].videoPrompt=value;if(english!==undefined)next[index].videoPromptEn=english;} else {next[index][field].prompt=value;if(english!==undefined)next[index][field].promptEn=english;}
    useCanvasStore.getState().setNodeConfig(p.id,{_segments:next});
    useCanvasStore.getState().propagateData(p.id,`segment_${index+1}_${field==='firstFrame'?'first':field==='lastFrame'?'last':'video'}_prompt`,english ?? value);
    useCanvasStore.getState().propagateData(p.id,'storyboard_list',JSON.stringify(next,null,2));
  };
  const translate=(index:number,field:'firstFrame'|'lastFrame'|'videoPrompt',value:string)=>{const key=`${index}-${field}`;setTranslating(v=>({...v,[key]:true}));void optimizePrompt({text:value,action:'translate',kind:field==='videoPrompt'?'image-to-video':'image'}).then(en=>updateSegment(index,field,value,en)).catch(()=>undefined).finally(()=>setTranslating(v=>({...v,[key]:false})));};
  const outputLabels=[{id:'storyboard_list',label:'完整分镜列表',type:'text'},{id:'error_warning',label:'错误/警告',type:'text'}] as PortSpec[];
  const personCount=Math.max(0,Math.min(12,Number(cfg.personCount) || 0)); const sceneCount=Math.max(0,Math.min(12-personCount,Number(cfg.sceneCount) || 0));
  const inputs=[{id:'script',label:'剧本输入',type:'text'}, {id:'customRequirements',label:'专业修改输入',type:'text'}, ...stablePorts('person','人物',personCount),...stablePorts('scene','场景',sceneCount)];
  const inlinePrompt=(index:number,field:'firstFrame'|'lastFrame'|'videoPrompt',label:string,value:string,english:string)=>{const key=`${index}-${field}`;const outputId=`segment_${index+1}_${field==='firstFrame'?'first':field==='lastFrame'?'last':'video'}_prompt`;return <div style={{position:'relative',paddingRight:24,marginBottom:6}}><label style={{display:'block',fontSize:9,color:'#93c5fd'}}>{label}（中文，可修改）<textarea className="nodrag storyboard-prompt-editor" value={value} onChange={e=>updateSegment(index,field,e.target.value)} onMouseDown={e=>e.stopPropagation()}/></label><button className="nodrag storyboard-translate" onClick={()=>translate(index,field,value)} disabled={!value||translating[key]}>{translating[key]?'翻译中…':'翻译英文'}</button><label style={{display:'block',fontSize:9,color:'#86efac'}}>英文结果（可修改）<textarea className="nodrag storyboard-prompt-editor storyboard-prompt-editor--en" value={english} onChange={e=>updateSegment(index,field,value,e.target.value)} onMouseDown={e=>e.stopPropagation()}/></label><Handle id={outputId} type="source" position={Position.Right} title={`${label}英文输出`} style={{background:'#22c55e',right:0,top:'50%',border:'2px solid #16162a',zIndex:12}}/></div>};
  return <NodeShell {...p} icon="🎞️" color="#0ea5e9" hasInput={false} resizable inputs={inputs} outputs={outputLabels}>
    <div style={{fontSize:10,color:'#7dd3fc',fontWeight:700}}>剧情分镜提示词</div>
    <div style={{fontSize:9,color:'#9ca3af',margin:'4px 0'}}>分镜 {count} 段 · 总时长 {String(cfg.totalDuration||0)} 秒</div>
    {result.length>0?<div className="nodrag" style={{width:'100%'}}>{result.map((s:any,i:number)=><div key={i} style={{borderTop:'1px solid #2a2a3e',padding:'7px 0'}}><b style={{display:'block',fontSize:10,color:'#bae6fd',marginBottom:5}}>{s.segmentId||`分镜${i+1}`} · {s.duration||0}s</b>{inlinePrompt(i,'firstFrame','首图提示词',String(s.firstFrame?.prompt||''),String(s.firstFrame?.promptEn||''))}{inlinePrompt(i,'lastFrame','尾图提示词',String(s.lastFrame?.prompt||''),String(s.lastFrame?.promptEn||''))}{inlinePrompt(i,'videoPrompt','视频提示词',String(s.videoPrompt||''),String(s.videoPromptEn||''))}</div>)}</div>:<div style={{fontSize:9,color:'#64748b'}}>先通过连接点或右侧面板输入剧本和专业修改要求，再执行分析</div>}
  </NodeShell>;
});

/** JA导演台节点：在画布中保留当前导演台的可视化快照和镜头摘要。 */
export const DirectorStudioNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData;
  const cfg = d.config as Record<string, unknown>;
  const shot = (cfg.shot && typeof cfg.shot === 'object' ? cfg.shot : {}) as Record<string, unknown>;
  const actors = Array.isArray(cfg.actors) ? cfg.actors as Array<{id:string;name:string;color:string;position?:number[]}> : [];
  const snapshot = String(cfg.snapshot || '');
  const update = useCanvasStore(s => s.setNodeConfig);
  const publish = () => useCanvasStore.getState().propagateData(p.id, 'shot', String(cfg.prompt || ''));
  return <NodeShell {...p} icon="🎬" color="#f59e0b" inputs={[{id:'shot',label:'镜头设定',type:'text'}]} outputs={[{id:'shot',label:'镜头设定',type:'text'},{id:'preview',label:'导演台截图',type:'image'}]} resizable>
    <div style={{fontSize:10,color:'#fbbf24',fontWeight:700,marginBottom:6}}>JA导演台 · 3D镜头快照</div>
    {snapshot ? <img className="director-node-preview" src={snapshot} alt="JA导演台快照" /> : <div className="director-node-empty">打开 JA导演台并点击“创建到画布”同步镜头画面</div>}
    <div style={{fontSize:9,color:'#94a3b8',marginTop:6}}>角色 {actors.length} · {String(shot.shotSize || '中景')} · {String(shot.duration || 5)} 秒</div>
    <textarea className="nodrag" value={String(cfg.prompt || '')} onChange={e=>update(p.id,{prompt:e.target.value})} onBlur={publish} placeholder="导演台镜头提示词" style={{width:'100%',marginTop:6,minHeight:45,background:'#0b1020',border:'1px solid #3b4258',borderRadius:5,color:'#dbeafe',fontSize:10,padding:5}} />
  </NodeShell>;
});