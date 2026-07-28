import React, { useState, useEffect, useCallback } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { HistoryOutlined, ReloadOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { downloadMedia } from '@/utils/downloadMedia';

interface HistoryItem {
  id: string; nodeId: string; nodeName: string; nodeType: string;
  params: Record<string,unknown>; resultUrl?: string; status: string;
  timestamp: number; error?: string;
  results?: Array<{type:'image'|'video'|'audio'|'text';url:string;filename?:string}>;
}

export const GenerationHistory: React.FC<{ onOpenChange?: (open:boolean)=>void }> = ({ onOpenChange }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [height, setHeight] = useState(()=>Math.max(140,Number(localStorage.getItem('ai-canvas-history-height'))||200));
  const exec = useCanvasStore(s => s.executeNode);
  const sel = useCanvasStore(s => s.setSelectedNodeId);

  useEffect(() => {
    try { const r = localStorage.getItem('ai-canvas-history'); if (r) setItems(JSON.parse(r)); } catch {}
  }, []);

  const addItem = (item: HistoryItem) => {
    setItems(current => { const updated=[item,...current].slice(0,50);localStorage.setItem('ai-canvas-history',JSON.stringify(updated));return updated; });
  };
  const removeItem = (id: string) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    localStorage.setItem('ai-canvas-history', JSON.stringify(updated));
  };
  const saveItem = async (item: HistoryItem) => {
    const result = item.results?.[0] || (item.resultUrl ? { type: (/video|\.((mp4|mov|webm|mkv|avi))(?:[?#]|$)/i.test(`${item.nodeType} ${item.resultUrl}`) ? 'video' : 'image') as 'image'|'video', url: item.resultUrl } : undefined);
    if (!result) return;
    try { await downloadMedia(result.url, result.filename || `${item.nodeName}-${item.timestamp}`, result.type); }
    catch (error) { window.alert(error instanceof Error ? error.message : '保存失败，请检查 API 地址和跨域设置'); }
  };

  // 暴露到全局供 store 调用
  (window as any).__addHistory = addItem;

  const startResize=useCallback((e:React.PointerEvent)=>{
    e.preventDefault(); const startY=e.clientY; const startHeight=height;
    const move=(event:PointerEvent)=>setHeight(Math.max(140,Math.min(window.innerHeight*.75,startHeight+startY-event.clientY)));
    const up=(event:PointerEvent)=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
      const final=Math.max(140,Math.min(window.innerHeight*.75,startHeight+startY-event.clientY));setHeight(final);
      localStorage.setItem('ai-canvas-history-height',String(final));};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up,{once:true});
  },[height]);

  const dragHistory=(e:React.DragEvent,item:HistoryItem)=>{
    const result=item.results?.[0] || (item.resultUrl?{type:(/video/i.test(item.nodeType)||/\.(mp4|mov|webm)(\?|$)/i.test(item.resultUrl)?'video':'image') as 'image'|'video',url:item.resultUrl}:null);
    if(!result)return;
    const asset={id:item.id,name:result.filename||item.nodeName,type:result.type,url:result.url,source:'history'};
    e.dataTransfer.setData('application/ai-asset',JSON.stringify(asset));e.dataTransfer.setData('asset-url',result.url);e.dataTransfer.effectAllowed='copy';
  };

  const changeOpen=(next:boolean)=>{setOpen(next);onOpenChange?.(next)};
  if (!open) return (
    <div style={{position:'absolute',bottom:12,left:16,zIndex:15}}>
      <Tooltip title="生成历史"><Button type="text" icon={<HistoryOutlined/>} onClick={()=>changeOpen(true)}
        style={{background:'#16162add',borderRadius:8,color:'#888'}}/></Tooltip>
    </div>
  );

  return (
    <div className="generation-history" style={{position:'absolute',bottom:0,left:0,right:0,height,background:'#16162a',borderTop:'1px solid #2a2a3e',zIndex:25,display:'flex',flexDirection:'column'}}>
      <div className="generation-history__resize" title="上下拖动调整历史栏高度" onPointerDown={startResize}><span/></div>
      <div style={{padding:'8px 14px',borderBottom:'1px solid #2a2a3e',display:'flex',alignItems:'center',gap:8}}>
        <HistoryOutlined style={{color:'#888'}}/>
        <span style={{fontWeight:700,fontSize:13,color:'#e0e0f0',flex:1}}>生成历史</span>
        <Button type="text" size="small" onClick={()=>changeOpen(false)} style={{color:'#888'}}><CloseOutlined/></Button>
      </div>
      <div style={{flex:1,overflow:'auto',padding:8,display:'flex',gap:8,flexWrap:'wrap'}}>
        {items.length === 0 && <div style={{color:'#555',fontSize:12,padding:16}}>暂无记录</div>}
        {items.map(it => (
          <div key={it.id} draggable={Boolean(it.resultUrl||it.results?.length)} onDragStart={e=>dragHistory(e,it)} style={{width:120,background:'#1e1e30',borderRadius:8,padding:8,fontSize:11,color:'#c0c0d0',cursor:it.resultUrl||it.results?.length?'grab':'pointer',border:'1px solid #2a2a3e'}}
            onClick={()=>sel(it.nodeId)}>
            {(it.results?.[0]?.url||it.resultUrl) ? (it.results?.[0]?.type==='video'?<video src={it.results[0].url} muted style={{width:'100%',borderRadius:4,aspectRatio:'1',objectFit:'cover',marginBottom:4}}/>:<img src={it.results?.[0]?.url||it.resultUrl} style={{width:'100%',borderRadius:4,aspectRatio:'1',objectFit:'cover',marginBottom:4}}/>) :
             <div style={{width:'100%',aspectRatio:'1',background:'#0f0f1a',borderRadius:4,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'center',color:'#555'}}>🎨</div>}
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.nodeName}</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
              <Tag color={it.status==='success'?'green':it.status==='error'?'red':'default'} style={{fontSize:10,lineHeight:'16px'}}>{it.status==='success'?'完成':'失败'}</Tag>
              <span style={{display:'flex',gap:8}}>
                {it.status==='error'&&<ReloadOutlined style={{color:'#888',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();exec(it.nodeId);}}/>}
                {(it.resultUrl||it.results?.length)&&<DownloadOutlined style={{color:'#60a5fa',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();void saveItem(it);}}/>}
              </span>
              <span style={{fontSize:9,color:'#555'}}>{new Date(it.timestamp).toLocaleTimeString()}</span>
              <DeleteOutlined style={{color:'#ef4444',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();removeItem(it.id);}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};