import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Tag, Tooltip } from 'antd';
import { HistoryOutlined, ReloadOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { downloadMedia } from '@/utils/downloadMedia';
import { loadChatSessions, deleteChatSession } from '@/utils';
import type { ChatSession } from '@/types';
import { addGenerationHistory, GENERATION_HISTORY_EVENT, readGenerationHistory, type GenerationHistoryItem } from '@/utils/generationHistory';

type HistoryItem = GenerationHistoryItem;

export const GenerationHistory: React.FC<{ onOpenChange?: (open:boolean)=>void; onHeightChange?: (height:number)=>void }> = ({ onOpenChange, onHeightChange }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [expandedChats, setExpandedChats] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'generation'|'chat'>('generation');
  const [height, setHeight] = useState(()=>Math.max(140,Number(localStorage.getItem('ai-canvas-history-height'))||200));
  const exec = useCanvasStore(s => s.enqueueNode);
  const sel = useCanvasStore(s => s.setSelectedNodeId);
  useEffect(() => { onHeightChange?.(height); }, [height, onHeightChange]);

  useEffect(() => {
    setItems(readGenerationHistory());
    void loadChatSessions().then(setChatSessions).catch(() => setChatSessions([]));
    const refresh = () => setItems(readGenerationHistory());
    window.addEventListener(GENERATION_HISTORY_EVENT, refresh);
    return () => window.removeEventListener(GENERATION_HISTORY_EVENT, refresh);
  }, []);

  const addItem = useCallback((item: HistoryItem) => addGenerationHistory(item), []);
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

  // 保留兼容入口，旧版本/第三方节点仍可写入同一份历史。
  useEffect(() => {
    (window as any).__addHistory = addItem;
    return () => { delete (window as any).__addHistory; };
  }, [addItem]);

  const heightRef = useRef(height);
  useEffect(() => { heightRef.current = height; }, [height]);

  const startResize=useCallback((e:React.PointerEvent)=>{
    e.preventDefault(); const startY=e.clientY; const startHeight=heightRef.current;
    let raf=0;
    const move=(event:PointerEvent)=>{
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>{
        const newHeight=Math.max(140,Math.min(window.innerHeight*.75,startHeight+startY-event.clientY));
        setHeight(newHeight);
      });
    };
    const up=(event:PointerEvent)=>{
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
      const final=Math.max(140,Math.min(window.innerHeight*.75,startHeight+startY-event.clientY));setHeight(final);
      localStorage.setItem('ai-canvas-history-height',String(final));
    };
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up,{once:true});
  },[]);

  const dragHistory=(e:React.DragEvent,item:HistoryItem)=>{
    const result=item.results?.[0] || (item.resultUrl?{type:(/video/i.test(item.nodeType)||/\.(mp4|mov|webm)(\?|$)/i.test(item.resultUrl)?'video':'image') as 'image'|'video',url:item.resultUrl}:null);
    if(!result)return;
    const asset={id:item.id,name:result.filename||item.nodeName,type:result.type,url:result.url,source:'history'};
    e.dataTransfer.setData('application/ai-asset',JSON.stringify(asset));e.dataTransfer.setData('asset-url',result.url);e.dataTransfer.effectAllowed='copy';
  };

  const changeOpen=(next:boolean)=>{setOpen(next);onOpenChange?.(next)};
  if (!open) return (
    <div className="generation-history-toggle" style={{position:'fixed',bottom:'calc(10px + env(safe-area-inset-bottom))',right:174,left:'auto',zIndex:1002}}>
      <Tooltip title="生成历史"><Button type="text" icon={<HistoryOutlined/>} onClick={()=>changeOpen(true)}
        className="generation-history-toggle__btn"/></Tooltip>
    </div>
  );

  return (
    <div className="generation-history" style={{position:'absolute',bottom:0,left:0,right:0,height,background:'var(--theme-panel)',borderTop:'1px solid var(--theme-border)',zIndex:25,display:'flex',flexDirection:'column'}}>
      <div className="generation-history__resize" title="上下拖动调整历史栏高度" onPointerDown={startResize}><span/></div>
      <div style={{padding:'8px 14px',borderBottom:'1px solid var(--theme-border)',display:'flex',alignItems:'center',gap:8}}>
        <HistoryOutlined style={{color:'var(--theme-muted)'}}/>
        <div className="history-tabs"><button className={tab === 'generation' ? 'is-active' : ''} onClick={() => setTab('generation')}>生成历史</button><button className={tab === 'chat' ? 'is-active' : ''} onClick={() => { setTab('chat'); void loadChatSessions().then(setChatSessions).catch(() => undefined); }}>聊天记录</button></div>
        <Button type="text" size="small" onClick={()=>changeOpen(false)} style={{color:'var(--theme-muted)'}}><CloseOutlined/></Button>
      </div>
      <div style={{flex:1,overflow:'auto',padding:8,display:'flex',gap:8,flexWrap:'wrap'}}>
        {tab === 'generation' && items.length === 0 && <div style={{color:'var(--theme-muted)',fontSize:12,padding:16}}>暂无生成记录</div>}
        {tab === 'generation' && items.map(it => (
          <div key={it.id} draggable={Boolean(it.resultUrl||it.results?.length)} onDragStart={e=>dragHistory(e,it)} style={{width:120,background:'var(--theme-surface)',borderRadius:8,padding:8,fontSize:11,color:'var(--theme-text)',cursor:it.resultUrl||it.results?.length?'grab':'pointer',border:'1px solid var(--theme-border)'}}
            onClick={()=>sel(it.nodeId)}>
            {(it.results?.[0]?.url||it.resultUrl) ? (it.results?.[0]?.type==='video'?<video src={it.results[0].url} muted style={{width:'100%',borderRadius:4,aspectRatio:'1',objectFit:'cover',marginBottom:4}}/>:<img src={it.results?.[0]?.url||it.resultUrl} style={{width:'100%',borderRadius:4,aspectRatio:'1',objectFit:'cover',marginBottom:4}}/>) :
             <div style={{width:'100%',aspectRatio:'1',background:'var(--theme-input)',borderRadius:4,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--theme-muted)'}}>🎨</div>}
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.nodeName}</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4}}>
              <Tag color={it.status==='success'?'green':it.status==='error'?'red':'default'} style={{fontSize:10,lineHeight:'16px'}}>{it.status==='success'?'完成':'失败'}</Tag>
              <span style={{display:'flex',gap:8}}>
                {it.status==='error'&&<ReloadOutlined style={{color:'var(--theme-muted)',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();exec(it.nodeId);}}/>}
                {(it.resultUrl||it.results?.length)&&<DownloadOutlined style={{color:'#60a5fa',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();void saveItem(it);}}/>}
              </span>
              <span style={{fontSize:9,color:'var(--theme-muted)'}}>{new Date(it.timestamp).toLocaleTimeString()}</span>
              <DeleteOutlined style={{color:'#ef4444',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();removeItem(it.id);}}/>
            </div>
          </div>
        ))}
        {tab === 'chat' && chatSessions.length === 0 && <div style={{color:'var(--theme-muted)',fontSize:12,padding:16}}>暂无聊天记录</div>}
        {tab === 'chat' && chatSessions.map(session => {
          const expanded = expandedChats.has(session.id);
          return <div className={`chat-history-card ${expanded ? 'is-expanded' : ''}`} key={session.id}>
            <button className="chat-history-card__title" onClick={() => setExpandedChats(current => { const next = new Set(current); if (next.has(session.id)) next.delete(session.id); else next.add(session.id); return next; })}>✦ {session.title}<span>{expanded ? '收起' : '展开'}</span></button>
            <div className="chat-history-card__meta">{Math.ceil(session.messages.length / 2)} 轮 · {new Date(session.updatedAt).toLocaleString()}</div>
            <div className="chat-history-card__preview">{(expanded ? session.messages : session.messages.slice(-2)).map(item => <p key={item.id}><b>{item.role === 'user' ? '你' : 'AI'}：</b>{item.content}</p>)}</div>
            <div className="chat-history-card__actions">
              <Button size="small" type="primary" onClick={() => window.dispatchEvent(new CustomEvent('ai-canvas-resume-chat', { detail: session }))}>继续对话</Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { await deleteChatSession(session.id); setChatSessions(current => current.filter(item => item.id !== session.id)); }}>删除</Button>
            </div>
          </div>;
        })}
      </div>
    </div>
  );
};