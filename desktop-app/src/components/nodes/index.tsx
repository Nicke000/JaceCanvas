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

const ST: Record<string, { bg: string; icon: string; glow: string }> = {
  idle:    { bg: '#444', icon: '\u25CB', glow: '#444' },
  running: { bg: '#6366f1', icon: '\u25CF', glow: '#6366f1' },
  paused:  { bg: '#f59e0b', icon: 'Ⅱ', glow: '#f59e0b' },
  success: { bg: '#22c55e', icon: '\u2713', glow: '#22c55e' },
  error:   { bg: '#ef4444', icon: '\u2715', glow: '#ef4444' },
};

const DIMS = [{ l:'512',w:512,h:512 },{ l:'HD',w:768,h:1136 },{ l:'FHD',w:1080,h:1920 },{ l:'2K',w:1440,h:2560 },{ l:'4K',w:2160,h:3840 },{ l:'1:1',w:1024,h:1024 }];

type PortSpec = { id:string; label:string; type?:string };
type SP = { data: any; id: string; selected: boolean; icon: string; color: string; hasInput?: boolean; hasOutput?: boolean; inputs?:PortSpec[]; outputs?:PortSpec[]; resizable?: boolean; children?: React.ReactNode };

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
  const ref = useRef<HTMLVideoElement>(null);
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
    if (!input || !meta.duration) return; setBusy(true);
    try {
      const api=(window as any).electronAPI;
      if (!api?.ffmpegTrimVideo) throw new Error('请使用 Electron 桌面版执行 FFmpeg 导出');
      const result=await api.ffmpegTrimVideo({input,fps:meta.fps,startFrame:range.start,endFrame:range.end||maxFrame});
      const next={clip:result.clip,firstFrame:result.firstFrame,lastFrame:result.lastFrame}; setOutputs(next);
      const values={clip:result.clip,firstFrame:result.firstFrame,lastFrame:result.lastFrame}; useCanvasStore.getState().updateNodeData(p.id,{outputValues:values,results:[{type:'video',url:result.clip,filename:'trimmed.mp4'},{type:'image',url:result.firstFrame,filename:'first-frame.png'},{type:'image',url:result.lastFrame,filename:'last-frame.png'}],resultUrl:result.clip,status:'success',error:undefined}); Object.entries(values).forEach(([k,val])=>useCanvasStore.getState().propagateData(p.id,k,val));
    } catch (e) { useCanvasStore.getState().updateNodeData(p.id,{error:e instanceof Error?e.message:'导出失败',status:'error'}); } finally { setBusy(false); }
  };
  useEffect(()=>{ setOutputs({}); if(!input)return; },[input]);
  return <NodeShell {...p} icon="✂" color="#f97316" inputs={[{id:'video',label:'输入视频',type:'video'}]} outputs={[{id:'clip',label:'剪辑后视频',type:'video'},{id:'firstFrame',label:'首帧',type:'image'},{id:'lastFrame',label:'尾帧',type:'image'}]} resizable>
    <div className="video-trim-node">
      {input?<video ref={ref} src={input} controls playsInline className="video-trim-preview" onLoadedMetadata={e=>{const v=e.currentTarget;const duration=v.duration||0;setMeta(m=>({duration,fps:m.fps}));setRange(r=>({start:Math.min(r.start,Math.max(0,Math.round(duration*meta.fps)-1)),end:r.end||Math.max(1,Math.round(duration*meta.fps)-1)}));}}/>:<div className="video-trim-empty">连接视频或从素材库拖入</div>}
      <div className="video-trim-time">{(range.start/frame).toFixed(2)}s — {((range.end||maxFrame)*frame).toFixed(2)}s · {meta.fps} FPS</div>
      <input className="video-trim-range" type="range" min={0} max={maxFrame||1} value={range.start} onChange={e=>setFrame('start',Number(e.target.value))}/><input className="video-trim-range" type="range" min={1} max={maxFrame||1} value={Math.max(1,range.end||1)} onChange={e=>setFrame('end',Number(e.target.value))}/>
      <div className="video-trim-controls"><button className="nodrag" onClick={()=>setFrame('start',range.start-1)}>入点 −1帧</button><button className="nodrag" onClick={()=>setFrame('start',range.start+1)}>入点 +1帧</button><button className="nodrag" onClick={()=>setFrame('end',(range.end||1)-1)}>出点 −1帧</button><button className="nodrag" onClick={()=>setFrame('end',(range.end||1)+1)}>出点 +1帧</button></div>
      <div className="video-trim-actions"><button className="nodrag video-trim-primary" disabled={!input||busy} onClick={exportAll}>{busy?'FFmpeg 导出中…':'截取并生成 MP4 输出'}</button>{outputs.clip&&<button className="nodrag" onClick={()=>download(outputs.clip!,'trimmed.mp4')}>下载 MP4</button>}{outputs.firstFrame&&<button className="nodrag" onClick={()=>download(outputs.firstFrame!,'first-frame.png')}>首帧</button>}{outputs.lastFrame&&<button className="nodrag" onClick={()=>download(outputs.lastFrame!,'last-frame.png')}>尾帧</button>}</div>
    </div>
  </NodeShell>;
});

/** Video2X 开源本地模型节点：只由应用内置的 Video2XQt6 执行，不调用系统安装版本。 */
export const Video2XLocalNode = memo((p: NodeProps) => {
  const d = p.data as unknown as CanvasNodeData; const setConfig = useCanvasStore(s => s.setNodeConfig); const [busy,setBusy]=useState(false);
  const input=String(d.config?.inputPath||d.inputValues?.video||''); const preview=String(d.config?.previewUrl||d.inputValues?.video||''); const mode=String(d.config?.mode||'upscale');
  const pickVideo=async()=>{const el=document.createElement('input');el.type='file';el.accept='video/*,.mp4,.mkv,.mov,.avi';const file=await new Promise<File|undefined>(r=>{el.onchange=()=>r(el.files?.[0]);el.click()});if(!file)return;const api=(window as any).electronAPI;if(!api?.saveLocalAsset)return;const data=await new Promise<string>(r=>{const x=new FileReader();x.onload=()=>r(String(x.result));x.readAsDataURL(file)});const saved=await api.saveLocalAsset({name:file.name,data});setConfig(p.id,{inputPath:saved.path,previewUrl:saved.url})};
  const process=async()=>{if(!input)return;const api=(window as any).electronAPI;if(!api?.video2xProcess){useCanvasStore.getState().updateNodeData(p.id,{status:'error',error:'请使用 Electron 桌面版运行 Video2X 本地节点'});return}setBusy(true);useCanvasStore.getState().updateNodeData(p.id,{status:'running',progress:0,error:undefined});try{const r=await api.video2xProcess({input,mode,scale:Number(d.config?.scale)||2,model:String(d.config?.model||'realesr-animevideov3'),frameRateMul:Number(d.config?.frameRateMul)||2});const v={video:r.url,output:r.url};useCanvasStore.getState().updateNodeData(p.id,{status:'success',progress:100,resultUrl:r.url,outputValues:v,results:[{type:'video',url:r.url,filename:r.filename}],content:'Video2X 处理完成'});useCanvasStore.getState().propagateData(p.id,'video',r.url);useCanvasStore.getState().propagateData(p.id,'output',r.url)}catch(e){useCanvasStore.getState().updateNodeData(p.id,{status:'error',error:e instanceof Error?e.message:'Video2X 处理失败'})}finally{setBusy(false)}};
  return <NodeShell {...p} icon="⚙" color="#06b6d4" inputs={[{id:'video',label:'输入视频',type:'video'}]} outputs={[{id:'video',label:'处理后视频',type:'video'}]} resizable><div className="nodrag" style={{fontSize:10,color:'#67e8f9',fontWeight:700}}>Video2X Qt6 · 开源本地模型</div><div className="nodrag" style={{fontSize:9,color:'#fbbf24',lineHeight:1.45,margin:'4px 0'}}>⚠ 本节点内置开源程序与模型，可能不适配所有电脑；请自行确认模型/素材许可证，不代表商业授权，禁止侵权使用。</div>{preview&&<video src={preview} controls muted className="video-trim-preview" style={{maxHeight:130}}/>}<div className="nodrag" style={{display:'grid',gap:4,marginTop:5}}><button onClick={pickVideo}>选择本地视频</button><select value={mode} onChange={e=>setConfig(p.id,{mode:e.target.value})}><option value="upscale">视频超分</option><option value="interpolate">视频补帧</option><option value="both">超分 + 补帧</option></select><select value={String(d.config?.model||'realesr-animevideov3')} onChange={e=>setConfig(p.id,{model:e.target.value})}><option value="realesr-animevideov3">RealESRGAN AnimeVideo</option><option value="realesrgan-plus">RealESRGAN Plus</option><option value="realcugan">RealCUGAN</option><option value="rife-v4.26">RIFE v4.26</option></select>{(mode==='upscale'||mode==='both')&&<select value={String(d.config?.scale||2)} onChange={e=>setConfig(p.id,{scale:Number(e.target.value)})}><option value="2">放大 2x</option><option value="3">放大 3x</option><option value="4">放大 4x</option></select>}{(mode==='interpolate'||mode==='both')&&<select value={String(d.config?.frameRateMul||2)} onChange={e=>setConfig(p.id,{frameRateMul:Number(e.target.value)})}><option value="2">补帧至 2 倍</option><option value="4">补帧至 4 倍</option></select>}<button className="video-trim-primary" disabled={!input||busy} onClick={process}>{busy?'处理中…':'执行 Video2X'}</button></div></NodeShell>;
});

const NodeShell: React.FC<SP> = ({ data, id, selected, icon, color, hasInput = true, hasOutput = true, inputs, outputs, resizable = false, children }) => {
  const nd = data as CanvasNodeData; const s = ST[nd.status || 'idle'];
  const inputPorts:PortSpec[]=inputs?.length?inputs:(hasInput?[{id:'input',label:'输入'}]:[]);
  const outputPorts:PortSpec[]=outputs?.length?outputs:(hasOutput?[{id:'output',label:'输出'}]:[]);
  const portRows=Math.max(inputPorts.length,outputPorts.length);
  const exec = useCanvasStore(u => u.executeNode);
  const pause = useCanvasStore(u => u.pauseNode);
  const sel = useCanvasStore(u => u.setSelectedNodeId);
  const ctx = useCanvasStore(u => u.showContextMenu);
  const [hover, setHover] = useState(false);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(nd.status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),100);return()=>clearInterval(timer)},[nd.status]);
  const elapsed=nd.status==='running'&&nd.generationStartedAt?now-nd.generationStartedAt:nd.generationDurationMs;
  const overallProgress=nd.status==='success'?100:Math.max(0,Math.min(100,nd.progress||0));
  const stepProgress=nd.status==='success'?100:Math.max(0,Math.min(100,nd.currentNodeProgress ?? 0));
  const doExec = useCallback((e: React.MouseEvent) => { e.stopPropagation(); if (nd.status === 'running') { pause(id); return; } void exec(id); }, [id, exec, nd.status, pause]);
  return (
    <div onClick={() => sel(id)}
      onPointerDown={e => {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select, button, audio, video, .nodrag, .react-flow__handle')) e.stopPropagation();
      }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); ctx(e.clientX, e.clientY, id); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 10, background: '#16162a',
        border: `2px solid ${selected ? color : hover ? '#444' : '#2a2a3e'}`,
        boxShadow: selected ? `0 0 20px ${color}44` : hover ? '0 4px 16px rgba(0,0,0,0.4)' : '0 1px 4px rgba(0,0,0,0.3)',
        width:'100%',height:'100%',minWidth: portRows>3?280:220, maxWidth: resizable ? 'none' : 360, cursor: 'pointer',
        transition: 'all 0.15s ease', transform: hover && !selected ? 'translateY(-1px) scale(1.01)' : 'none',
        opacity: nd.disabled ? 0.5 : 1, position: 'relative', color: '#c0c0d0',
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
        <span onClick={doExec} title={nd.status === 'running' ? '点击取消任务' : nd.status + ' - 点击执行'}
          style={{
            width: 26, height: 26, borderRadius: '50%', background: s.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 13, color: '#fff',
            boxShadow: `0 0 10px ${s.glow}`, transition: 'all 0.3s',
            animation: nd.status === 'running' ? 'pulse 0.8s infinite' : (nd.status === 'success' ? 'glowPulse 2s infinite' : 'none'),
          }}>{nd.status === 'running' ? '×' : s.icon}</span>
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
      <div style={{ padding: '10px 14px', fontSize: 12 }}>{children ?? <div style={{ color: '#555' }}>点击配置...</div>}</div>
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
  return <NodeShell {...p} icon="T" color="#6366f1" inputs={[{id:'settings',label:'场景设定',type:'text'}]} outputs={[{id:'text',label:'文本',type:'text'}]}>
    {scene && <div className="text-scene-context">已合并场景设定</div>}
    <div style={{display:'flex',justifyContent:'flex-end',marginBottom:2}}><PromptActions nodeId={p.id} value={(d.config?.text as string)||''} kind="generic" fieldKey="text" onChange={v=>{const store=useCanvasStore.getState();store.setNodeConfig(p.id,{text:v});publish(v)}}/></div>
    <textarea className="nodrag" onFocus={()=>openTextEditor(p.id,'text',String(d.config?.text||''),'文本输入','text')} onPointerDown={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} placeholder="输入文本..." value={(d.config?.text as string)||''}
      onChange={e => {const store=useCanvasStore.getState();store.setNodeConfig(p.id,{text:e.target.value});publish(e.target.value)}}
      style={{width:'100%',border:'1px solid #2a2a3e',borderRadius:6,padding:6,fontSize:12,resize:'vertical',minHeight:40,outline:'none',fontFamily:'inherit',background:'#0f0f1e',color:'#c0c0d0'}} />
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
    const store=useCanvasStore.getState();
    store.updateNodeData(p.id,{status:'running',progress:0,error:undefined,content:`正在上传 0/${files.length}`});
    try{
      const results:ResultItem[]=[...(store.nodes.find(n=>n.id===p.id)?.data.results||[]) as ResultItem[]];
      for(let i=0;i<files.length;i++){
        const file=files[i]; const filename=await uploadFile(file);
        const url=`${getApiBase()}/api/comfy/view?filename=${encodeURIComponent(filename)}&type=input`;
        results.push({type:mediaTypeForFile(file),url,filename});
        store.updateNodeData(p.id,{progress:Math.round((i+1)/files.length*100),content:`正在上传 ${i+1}/${files.length}`});
      }
      publish(results);
    }catch(error){store.updateNodeData(p.id,{status:'error',error:error instanceof Error?error.message:'上传失败'});}
    finally{setUploading(false);}
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
  const apiPorts=apiFields.filter(field=>field.fileType||(/string/.test(field.type)&&/text|prompt|positive|negative|script|caption|description/i.test(field.field)))
    .map(field=>({id:field.key,label:field.label,type:field.fileType||'text'}));
  const segmentCount = Math.max(1, Math.min(100, Number(cfg.segmentCount) || 3));
  const dynamicStoryboardOutputs = d.nodeType === 'storyboardPrompt' ? Array.from({length:segmentCount},(_,i)=>{const n=String(i+1).padStart(2,'0');return [{id:`segment_${n}_first_prompt`,label:`片段${i+1} 首帧`,type:'text'},{id:`segment_${n}_last_prompt`,label:`片段${i+1} 尾帧`,type:'text'},{id:`segment_${n}_video_prompt`,label:`片段${i+1} 视频`,type:'text'},{id:`segment_${n}_first_ref`,label:`片段${i+1} 首帧图`,type:'image'},{id:`segment_${n}_last_ref`,label:`片段${i+1} 尾帧图`,type:'image'}]}).flat() : [];
  const inputPorts:PortSpec[]=isApiNode?(apiPorts.length?apiPorts:[{id:'input',label:'输入'}]):(meta?.inputs.filter(ip=>['text','image','video','audio'].includes(ip.type)).map(ip=>({id:ip.name,label:ip.label,type:ip.type}))||[]);
  const outputPorts:PortSpec[]=isApiNode?[{id:'output',label:'结果',type:'image'}]:d.nodeType==='storyboardPrompt'?[{id:'storyboard_list',label:'分镜列表',type:'text'},...dynamicStoryboardOutputs,{id:'error_warning',label:'错误/警告',type:'text'}]: (meta?.outputs.map(op=>({id:op.name,label:op.label,type:op.type}))||[]);

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