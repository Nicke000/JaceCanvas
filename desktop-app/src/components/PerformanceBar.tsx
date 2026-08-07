import React, { useEffect, useState } from 'react';
import { CloudServerOutlined } from '@ant-design/icons';
import { fetchPerformanceInfo, type PerformanceInfo } from '@/services/comfyui.service';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { getRunningTaskCount, getQueuedTaskIds } from '@/stores/canvasStore';

export const PerformanceBar: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const baseUrl = useSettingsStore(s=>s.baseUrl);
  const sshHost = useSettingsStore(s=>s.sshHost);
  const sshPort = useSettingsStore(s=>s.sshPort);
  const sshUsername = useSettingsStore(s=>s.sshUsername);
  const activeServerName = useSettingsStore(s => s.servers.find(x => x.id === s.activeServerId)?.name || '未选服务器');
  const nodes = useCanvasStore(s=>s.nodes);
  const [info,setInfo]=useState<PerformanceInfo|null>(null);
  const [online,setOnline]=useState(false);
  const [updatedAt,setUpdatedAt]=useState<number|null>(null);
  const [error,setError]=useState(false); const [errorMessage,setErrorMessage]=useState('');
  // SSH samples are serialized because opening a new SSH session can take longer than the interval.
  useEffect(()=>{let alive=true;let loading=false;const load=async()=>{if(loading)return;loading=true;try{const data=await fetchPerformanceInfo();if(alive){setInfo(data);setOnline(data.online);setError(Boolean(data.sshError));setErrorMessage(data.sshError||'');setUpdatedAt(Date.now())}}catch(e){if(alive){setInfo(null);setOnline(false);setError(true);setErrorMessage(e instanceof Error?e.message:'性能检测失败');setUpdatedAt(Date.now())}}finally{loading=false}};void load();const timer=setInterval(()=>void load(),5000);return()=>{alive=false;clearInterval(timer)}},[baseUrl,sshHost,sshPort,sshUsername]);
  const gpuMemPct=info?.gpuMemoryTotal?Math.round((info.gpuMemoryUsed||0)/info.gpuMemoryTotal*100):null;
  const fmtMem=(used?:number,total?:number,unit='GB')=>used!=null&&total!=null?`${used.toFixed(unit==='GB'?1:0)}/${total.toFixed(unit==='GB'?1:0)} ${unit}`:'--';
  const meter=(value?:number)=>value == null ? 0 : Math.max(0,Math.min(100,value));
  const Metric=({icon,label,value,detail,color}:{icon:string;label:string;value?:number;detail:string;color:string})=><div className="performance-metric">
    <span className="performance-metric__icon" style={{color}}>{icon}</span><span className="performance-metric__body"><span className="performance-metric__label">{label}</span><span className="performance-metric__value">{value==null?'--':`${Math.round(value)}%`} <small>{detail}</small></span><span className="performance-meter"><i style={{width:`${meter(value)}%`,background:color}}/></span></span>
  </div>;
  return <div className={`performance-bar ${compact?'is-compact':''}`} role="status" aria-label="服务器性能状态">
    <span className={`performance-dot ${online?'is-online':''}`}/><span title="当前服务器">{activeServerName} · {info?.source==='ssh'?'SSH 实时':online?'HTTP 在线':'离线'}</span>
    <span className="performance-sep"/>
    <button className="performance-queue-link" onClick={()=>{const node=nodes.find(n=>n.data.status==='running');if(node)(window as any).__focusCanvasNode?.(node.id)}}>执行中 {Math.max(info?.runningCount ?? 0,getRunningTaskCount(),nodes.filter(n=>n.data.status==='running').length)}</button>
    <button className="performance-queue-link" onClick={()=>{const id=getQueuedTaskIds().find(taskId=>nodes.some(n=>n.id===taskId&&n.data.status!=='running'));if(id)(window as any).__focusCanvasNode?.(id)}}>排队中 {Math.max(info?.pendingCount ?? 0,getQueuedTaskIds().filter(id=>nodes.some(n=>n.id===id&&n.data.status!=='running')).length)}</button>
    <Metric icon="GPU" label="显卡" value={info?.gpuUsage} detail={info?.gpuName||'未连接'} color="#a78bfa"/>
    <Metric icon="VRAM" label="显存" value={gpuMemPct??undefined} detail={fmtMem(info?.gpuMemoryUsed,info?.gpuMemoryTotal,'MB')} color="#38bdf8"/>
    <Metric icon="CPU" label="处理器" value={info?.cpuUsage} detail="使用率" color="#34d399"/>
    <Metric icon="RAM" label="内存" value={info?.memoryPercent} detail={fmtMem(info?.memoryUsed,info?.memoryTotal)} color="#fbbf24"/>
    <Metric icon="TEMP" label="温度" value={info?.temperature} detail={info?.temperature==null?'未提供':'°C'} color="#fb7185"/>
    <span className="performance-sep"/>
    <span className={info?.comfyRunning?'status-good':'status-bad'}><CloudServerOutlined/> ComfyUI {info?.comfyRunning?'运行中':'未运行'}</span>
    {updatedAt&&<span className="performance-updated">更新 {new Date(updatedAt).toLocaleTimeString()}</span>}
    {error && <><span className="performance-sep"/><span className="status-bad" title={errorMessage}>SSH/性能检测失败</span></>}
  </div>;
};