import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Checkbox } from 'antd';
import { Modal } from 'antd';
import { Popover } from 'antd';
import { Button, Tag, Tooltip } from 'antd';
import { HistoryOutlined, ReloadOutlined, CloseOutlined, DeleteOutlined, DownloadOutlined, InfoOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Lightbox, type LightboxItem } from '@/components/Lightbox';
import { MediaThumb } from '@/components/MediaThumb';
import { downloadMedia } from '@/utils/downloadMedia';
import { loadChatSessions, deleteChatSession } from '@/utils';
import type { ChatSession } from '@/types';
import { addGenerationHistory, GENERATION_HISTORY_EVENT, readGenerationHistory, type GenerationHistoryItem } from '@/utils/generationHistory';

type HistoryItem = GenerationHistoryItem;

export const GenerationHistory: React.FC<{ onOpenChange?: (open:boolean)=>void; onHeightChange?: (height:number)=>void; embedded?: boolean }> = ({ onOpenChange, onHeightChange, embedded = false }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(30); // 增量渲染：默认只渲染 30 条，滚动到底加载更多，避免 50 条媒体全部加载卡顿
  const scrollRef = useRef<HTMLDivElement>(null);
  const onHistoryScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      setVisibleCount(c => Math.min(c + 15, items.length));
    }
  }, [items.length]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [expandedChats, setExpandedChats] = useState<Set<string>>(new Set());
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);
  const [showFailed, setShowFailed] = useState(() => useSettingsStore.getState().showFailedHistory);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [popoverItemId, setPopoverItemId] = useState<string | null>(null);
  const [selResults, setSelResults] = useState<Map<string, Set<number>>>(new Map());
  const formatTrace = (it: any) => {
    const p = it.params || {};
    const pick: Array<[string, string]> = [['prompt', '提示词'], ['negativePrompt', '负面词'], ['model', '模型'], ['provider', '厂商'], ['width', '宽'], ['height', '高'], ['ratio', '比例'], ['variants', '变体数'], ['duration', '时长'], ['workflow_id', '工作流'], ['seed', '种子']];
    const lines = pick.filter(([k]) => p[k] !== undefined && p[k] !== '').map(([k, label]) => `${label}：${String(p[k]).slice(0, 120)}`);
    return ['类型：' + (it.nodeType || '—') + ' · ' + new Date(it.timestamp).toLocaleString(), ...lines].join('\n');
  };
  // 结果实际媒体类型：历史记录里 type 可能标错（视频被标成 image），按 URL 扩展名兜底修正
  const isVideoUrl = (url?: string) => !!url && /\.(mp4|webm|mov|mkv|avi|m4v)(?:[?#]|$)/i.test(String(url).split('?')[0]);
  const resultType = (r?: { type?: string; url?: string }): 'image' | 'video' | 'audio' | 'text' | '3d' => {
    if (!r) return 'image';
    if (r.type === 'video' || r.type === 'audio' || r.type === 'text' || r.type === '3d') return r.type;
    if (isVideoUrl(r.url)) return 'video';
    if (r.type === 'image' && isVideoUrl(r.url)) return 'video';
    return 'image';
  };
  const [tab, setTab] = useState<'generation'|'chat'>('generation');
  const displayItems = tab === 'generation' ? (showFailed ? items : items.filter(i => i.status !== 'error')) : items;
  const [height, setHeight] = useState(()=>Math.max(140,Number(localStorage.getItem('ai-canvas-history-height'))||200));
  const exec = useCanvasStore(s => s.enqueueNode);
  const sel = useCanvasStore(s => s.setSelectedNodeId);
  useEffect(() => { onHeightChange?.(height); }, [height, onHeightChange]);

  useEffect(() => {
    const openHistory = () => changeOpen(true);
    window.addEventListener('ai-canvas-open-history', openHistory);
    return () => window.removeEventListener('ai-canvas-open-history', openHistory);
  }, []);

  useEffect(() => {
    setItems(readGenerationHistory());
    setVisibleCount(30);
    void loadChatSessions().then(setChatSessions).catch(() => setChatSessions([]));
    const refresh = () => { setItems(readGenerationHistory()); setVisibleCount(30); };
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
    const results = item.results?.length ? item.results : (item.resultUrl ? [{ type: (/video|\.((mp4|mov|webm|mkv|avi))(?:[?#]|$)/i.test(`${item.nodeType} ${item.resultUrl}`) ? 'video' : 'image') as 'image'|'video', url: item.resultUrl, filename: item.nodeName }] : []);
    if (!results.length) return;
    try {
      if (results.length === 1) await downloadMedia(results[0].url, results[0].filename || `${item.nodeName}-${item.timestamp}`, results[0].type);
      else for (let i = 0; i < results.length; i++) await downloadMedia(results[i].url, results[i].filename || `${item.nodeName}-${item.timestamp}-${i + 1}`, results[i].type);
    } catch (error) { window.alert(error instanceof Error ? error.message : '保存失败，请检查 API 地址和跨域设置'); }
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
    const asset={id:item.id,name:result.filename||item.nodeName,type:resultType(result),url:result.url,source:'history'};
    e.dataTransfer.setData('application/ai-asset',JSON.stringify(asset));e.dataTransfer.setData('asset-url',result.url);e.dataTransfer.effectAllowed='copy';
  };

  const changeOpen=(next:boolean)=>{setOpen(next);onOpenChange?.(next)};
  if (!open && !embedded) return (
    <div className="generation-history-toggle" style={{position:'fixed',bottom:'calc(10px + env(safe-area-inset-bottom))',right:174,left:'auto',zIndex:1002}}>
      <Tooltip title="生成历史"><Button type="text" icon={<HistoryOutlined/>} onClick={()=>changeOpen(true)}
        className="generation-history-toggle__btn"/></Tooltip>
    </div>
  );

  return (
    <div className={embedded ? 'generation-history generation-history--embedded' : 'generation-history'} style={{position:'absolute',bottom:0,left:0,right:0,height,background:'var(--theme-panel)',borderTop:'1px solid var(--theme-border)',zIndex:25,display:'flex',flexDirection:'column'}}>
      <div className="generation-history__resize" title="上下拖动调整历史栏高度" onPointerDown={startResize}><span/></div>
      <div style={{padding:'8px 14px',borderBottom:'1px solid var(--theme-border)',display:'flex',alignItems:'center',gap:8}}>
        <HistoryOutlined style={{color:'var(--theme-primary)'}}/><span className="generation-history__title">运行中心</span><Button type="text" size="small" className="generation-history__queue-link" onClick={() => window.dispatchEvent(new Event('ai-canvas-open-taskqueue'))}>查看队列</Button>
        <div className="history-tabs"><button className={tab === 'generation' ? 'is-active' : ''} onClick={() => setTab('generation')}>生成历史</button><button className={tab === 'chat' ? 'is-active' : ''} onClick={() => { setTab('chat'); void loadChatSessions().then(setChatSessions).catch(() => undefined); }}>聊天记录</button></div>
        {tab === 'generation' && <label style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px', fontSize: 10, color: 'var(--theme-muted)', cursor: 'pointer' }}><Checkbox checked={showFailed} onChange={e => { setShowFailed(e.target.checked); try { useSettingsStore.getState().setAssets({ showFailedHistory: e.target.checked }); } catch { /* ignore */ } }} />显示失败记录</label>}
        <Button type="text" size="small" onClick={()=>changeOpen(false)} style={{color:'var(--theme-muted)'}}><CloseOutlined/></Button>
      </div>
      <div ref={scrollRef} onScroll={onHistoryScroll} style={{flex:1,overflow:'auto',padding:8,display:'flex',gap:8,flexWrap:'wrap'}}>
        {tab === 'generation' && displayItems.length === 0 && <div style={{color:'var(--theme-muted)',fontSize:12,padding:16}}>暂无生成记录</div>}
        {tab === 'generation' && displayItems.slice(0, visibleCount).map(it => (
          <div key={it.id} draggable={Boolean(it.resultUrl||it.results?.length)} onDragStart={e=>dragHistory(e,it)} onDoubleClick={() => { const r = it.results?.[0] || (it.resultUrl ? { type: /video/i.test(it.nodeType) ? 'video' as const : 'image' as const, url: it.resultUrl } : null); if (r?.url) setLightbox({ url: r.url, type: resultType(r), name: it.nodeName }); }}
          style={{width:120,background:'var(--theme-surface)',borderRadius:8,padding:8,fontSize:11,color:'var(--theme-text)',cursor:it.resultUrl||it.results?.length?'grab':'pointer',border:'1px solid var(--theme-border)'}}
            onClick={()=>sel(it.nodeId)}>
            {(it.results?.length && it.results.length > 1) ? (
              <div style={{ position: 'relative', marginBottom: 4 }}>
                <MediaThumb url={it.results[0].url} type={resultType(it.results[0]) === 'video' ? 'video' : 'image'} style={{ width: '100%', aspectRatio: '1', borderRadius: 4 }} />
<Popover open={popoverItemId === it.id} onOpenChange={(o) => { if (!o) setPopoverItemId(null); }} content={(<div style={{ maxHeight: 300, overflow: 'auto', width: 360 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 5 }}>{(it.results || []).map((r, ri) => { const selected = selResults.get(it.id)?.has(ri);return <div key={ri} onClick={e => { e.stopPropagation(); setSelResults(cur => { const next = new Map(cur); const st = new Set(next.get(it.id) || []); st.has(ri) ? st.delete(ri) : st.add(ri); next.set(it.id, st); return next; }); }} onDoubleClick={e => { e.stopPropagation(); setLightbox({ url: r.url, type: resultType(r), name: `${it.nodeName} ${ri + 1}` }); }} draggable onDragStart={e => { e.dataTransfer.setData('asset-url', r.url); e.dataTransfer.setData('application/ai-asset', JSON.stringify({ name: it.nodeName, type: resultType(r), url: r.url })); e.dataTransfer.effectAllowed = 'copy'; }} title="单击选中 · 双击放大 · 可拖到画布/资产库" style={{ border: selected ? '2px solid var(--theme-primary)' : '1px solid var(--theme-border)', borderRadius: 6, overflow: 'hidden', position: 'relative', cursor: 'pointer', background: 'var(--theme-surface)' }}><MediaThumb url={r.url} type={resultType(r) === 'video' ? 'video' : 'image'} style={{ width: '100%', aspectRatio: '1', display: 'block' }} /><span style={{ position: 'absolute', left: 2, top: 2, fontSize: 9, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 3, padding: '0 4px' }}>{ri + 1}</span>{selected && <span style={{ position: 'absolute', right: 2, top: 2, width: 13, height: 13, borderRadius: '50%', background: 'var(--theme-primary)', color: '#fff', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>}</div>; })}</div><div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}><Button size="small" type="primary" icon={<DownloadOutlined />} disabled={!selResults.get(it.id)?.size} onClick={e => { e.stopPropagation(); (it.results || []).filter((_, ri) => selResults.get(it.id)?.has(ri)).forEach((r, i) => void downloadMedia(r.url, r.filename || `${it.nodeName}-${Date.now()}-${i + 1}`, r.type)); }}>下载选中({selResults.get(it.id)?.size || 0})</Button><span style={{ fontSize: 9, color: 'var(--theme-muted)', marginLeft: 'auto' }}>选中 · 拖动 · 双击放大</span></div></div>)} trigger="click" placement="right">                <button onClick={e => { e.stopPropagation(); setPopoverItemId(cur => cur === it.id ? null : it.id); }} title="展开全部结果" style={{ position: 'absolute', right: 4, top: 4, border: 'none', background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 9, cursor: 'pointer' }}>{it.results.length} 个 ▾</button></Popover>
              </div>
            ) : (it.results?.[0]?.url||it.resultUrl) ? <MediaThumb url={String(it.results?.[0]?.url||it.resultUrl)} type={resultType(it.results?.[0] || { url: it.resultUrl, type: it.results?.[0]?.type }) === 'video' ? 'video' : 'image'} style={{ width: '100%', borderRadius: 4, aspectRatio: '1', marginBottom: 4 }} /> :
             <div style={{width:'100%',aspectRatio:'1',background:'var(--theme-input)',borderRadius:4,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--theme-text-3)',fontSize:10}}>无预览</div>}
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.nodeName}</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:4,width:'100%'}}>
              <Tag color={it.status==='success'?'green':it.status==='error'?'red':'default'} style={{fontSize:10,lineHeight:'16px',marginRight:0}}>{it.status==='success'?'完成':'失败'}</Tag>
              <span style={{display:'flex',gap:6,alignItems:'center'}}>
                {it.status==='error'&&<ReloadOutlined style={{color:'var(--theme-muted)',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();exec(it.nodeId);}}/>}
                <InfoOutlined style={{color:expandedTraceId===it.id?'#60a5fa':'var(--theme-muted)',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setExpandedTraceId(cur=>cur===it.id?null:it.id);}}/>
                {(it.resultUrl||it.results?.length)&&<DownloadOutlined style={{color:'#60a5fa',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();void saveItem(it);}}/>}
              </span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:2,width:'100%'}}>
              <span style={{fontSize:9,color:'var(--theme-muted)'}}>{new Date(it.timestamp).toLocaleTimeString()}</span>
              <DeleteOutlined style={{color:'#ef4444',fontSize:10,cursor:'pointer'}} onClick={e=>{e.stopPropagation();removeItem(it.id);}}/>
            </div>
            {expandedTraceId === it.id && (
              <div style={{ marginTop: 6, fontSize: 9, color: 'var(--theme-muted)', borderTop: '1px solid var(--theme-border)', paddingTop: 4, maxHeight: 110, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>{formatTrace(it)}</div>
            )}
          </div>
        ))}
        {tab === 'chat' && chatSessions.length === 0 && <div style={{color:'var(--theme-muted)',fontSize:12,padding:16}}>暂无聊天记录</div>}
        {tab === 'chat' && chatSessions.map(session => {
          const expanded = expandedChats.has(session.id);
          return <div className={`chat-history-card ${expanded ? 'is-expanded' : ''}`} key={session.id}>
            <button className="chat-history-card__title" onClick={() => setExpandedChats(current => { const next = new Set(current); if (next.has(session.id)) next.delete(session.id); else next.add(session.id); return next; })}>{session.title}<span>{expanded ? '收起' : '展开'}</span></button>
            <div className="chat-history-card__meta">{Math.ceil(session.messages.length / 2)} 轮 · {new Date(session.updatedAt).toLocaleString()}</div>
            <div className="chat-history-card__preview">{(expanded ? session.messages : session.messages.slice(-2)).map(item => <p key={item.id}><b>{item.role === 'user' ? '你' : 'AI'}：</b>{item.content}</p>)}</div>
            <div className="chat-history-card__actions">
              <Button size="small" type="primary" onClick={() => window.dispatchEvent(new CustomEvent('ai-canvas-resume-chat', { detail: session }))}>继续对话</Button>
              <Button size="small" danger icon={<DeleteOutlined />} onClick={async () => { await deleteChatSession(session.id); setChatSessions(current => current.filter(item => item.id !== session.id)); }}>删除</Button>
            </div>
          </div>;
        })}
      </div>
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
};