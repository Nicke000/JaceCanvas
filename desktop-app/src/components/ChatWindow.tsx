import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Modal, Select, Tag, message } from 'antd';
import { CloseOutlined, DownOutlined, EditOutlined, FileTextOutlined, MoreOutlined, PaperClipOutlined, PlusOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { useSettingsStore } from '@/stores/settingsStore';
import { fetchModelsFromApi, sendChat, type ChatAttachment, type ChatTurn } from '@/services/chat.service';
import { useCanvasStore } from '@/stores/canvasStore';
import { generateId, loadChatSessions, saveChatSession } from '@/utils';
import type { ChatMessage, ChatSession } from '@/types';

type SourceType = 'image' | 'video' | 'audio' | 'text';
type SourceItem = ChatAttachment & { id: string; type: SourceType };
interface Props { onClose: () => void; initialSession?: ChatSession | null; }
const mediaUrlPattern = /(?:https?:\/\/[^\s)\]}>"']+|data:(?:image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+)/ig;
const mediaType = (url: string): 'image' | 'video' | null => /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i.test(url) ? 'image' : /^data:video\//i.test(url) || /\.(mp4|mov|webm|mkv|avi)(?:[?#]|$)/i.test(url) ? 'video' : null;
const sourceType = (mime: string, url: string): SourceType => mime.startsWith('image/') || mediaType(url) === 'image' ? 'image' : mime.startsWith('video/') || mediaType(url) === 'video' ? 'video' : mime.startsWith('audio/') ? 'audio' : 'text';

// 媒体解析缓存（模块级）：流式更新时避免对全部历史消息重复正则解析
const mediaCache = new Map<string, string[]>();
const mediaFromMessage = (content: string) => { let r = mediaCache.get(content); if (!r) { r = (content.match(mediaUrlPattern) || []).filter(url => mediaType(url)); if (mediaCache.size > 200) mediaCache.clear(); mediaCache.set(content, r); } return r; };
const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** 单条消息（memo）：流式更新时历史消息引用不变 → 零重渲 */
const ChatBubble = React.memo(({ item, selected, onToggle, onEdit, onRetry, onAddMedia }: {
  item: ChatMessage; selected: boolean;
  onToggle: (id: string) => void; onEdit: (item: ChatMessage) => void;
  onRetry: (item: ChatMessage) => void; onAddMedia: (url: string, index: number) => void;
}) => (
  <div className={`chat-window-bubble chat-window-bubble--${item.role} ${selected ? 'is-selected' : ''}`} onClick={() => onToggle(item.id)}>
    {item.role === 'assistant' && <div className="chat-window-bubble__role">助手<time>{fmtTime(item.timestamp)}</time></div>}
    {item.attachments?.length ? <div className="chat-window-bubble__attachments">{item.attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`} className="chat-window-bubble__attachment">{attachment.mimeType.startsWith('image/') && (attachment.dataUrl || attachment.url) ? <img loading="lazy" src={attachment.dataUrl || attachment.url} alt={attachment.name} /> : attachment.mimeType.startsWith('audio/') && (attachment.dataUrl || attachment.url) ? <audio controls src={attachment.dataUrl || attachment.url} /> : <PaperClipOutlined />}<small>{attachment.name}</small></span>)}</div> : null}
    <div className="chat-message-content">{item.content}</div>
    <div className="chat-message-actions">
      {item.role === 'user' && <><Button size="small" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); onEdit(item); }}>编辑</Button><Button size="small" onClick={e => { e.stopPropagation(); onRetry(item); }}>重新发送</Button></>}
      {item.role === 'assistant' && mediaFromMessage(item.content).map((url, index) => <Button key={url} size="small" onClick={e => { e.stopPropagation(); onAddMedia(url, index); }}>添加媒体到画布</Button>)}
    </div>
  </div>
));

/** 流式输出气泡：独立自绘（rAF 每帧读 draftRef），父组件零重渲 —— 根治"整个页面卡" */
const TypingBubble = ({ draftRef }: { draftRef: React.RefObject<string> }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    // 流式期间 100ms 轮询：内容变化才强制刷新，避免 rAF 每帧空转（网络慢/JSON 分支无 chunk 时不再 60fps 烧 CPU）
    let last = '';
    const id = setInterval(() => {
      const v = draftRef.current || '';
      if (v !== last) { last = v; force(x => x + 1); }
      // 接近底部时跟随滚动（不打断用户上翻）
      const el = ref.current; const scroller = el?.parentElement;
      if (el && scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120) scroller.scrollTop = scroller.scrollHeight;
    }, 100);
    return () => clearInterval(id);
  }, []);
  return <div ref={ref} className="chat-window-bubble chat-window-bubble--assistant chat-bubble--typing">{draftRef.current || 'AI 正在回答…'}</div>;
};

export const ChatWindow: React.FC<Props> = ({ onClose, initialSession }) => {
  const settings = useSettingsStore();
  const nodes = useCanvasStore(s => s.nodes);
  const addNode = useCanvasStore(s => s.addNode);
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialSession?.messages || []);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('chat-selected-model') || settings.chatModel || '');
  const [chatModels, setChatModels] = useState(settings.chatModels || []);
  const [thinkingMode, setThinkingMode] = useState(settings.chatThinkingMode || 'auto');
  const [fetching, setFetching] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<'local' | 'asset' | 'canvas' | 'history'>('asset');
  const [sourceItems, setSourceItems] = useState<SourceItem[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [editorText, setEditorText] = useState('');
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [selText, setSelText] = useState('');
  const [selEditorText, setSelEditorText] = useState('');
  const [rightWidth, setRightWidth] = useState(360);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const draftRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(initialSession?.id || generateId());

  const currentSession = useMemo<ChatSession>(() => ({ id: sessionIdRef.current, nodeId: 'fullscreen-chat', title: messages.find(item => item.role === 'user')?.content.slice(0, 36) || 'AI 对话', messages, updatedAt: Date.now() }), [messages]);
  // 智能滚动：首次有消息无条件到底；之后仅接近底部跟随
  const hasScrolledInitial = useRef(false);
  useEffect(() => {
    const el = messagesEndRef.current; const scroller = el?.parentElement;
    if (!scroller) return;
    if (!hasScrolledInitial.current) {
      if (messages.length) { scroller.scrollTop = scroller.scrollHeight; hasScrolledInitial.current = true; }
      else scroller.scrollTop = 0;
      return;
    }
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
    if (nearBottom || !messages.length) scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);
  useEffect(() => { if (messages.length) void saveChatSession(currentSession); }, [currentSession, messages.length]);
  useEffect(() => { void loadChatSessions().then(setSessions).catch(() => setSessions([])); }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const refreshSources = useCallback((tab: typeof sourceTab) => {
    const items: SourceItem[] = [];
    if (tab === 'local') return;
    if (tab === 'asset') {
      try { const assets = JSON.parse(localStorage.getItem('ai-canvas-assets-v2') || '[]') as Array<{id:string;name:string;type:string;url:string}>; assets.forEach(a => items.push({ id:a.id, name:a.name, mimeType:'application/octet-stream', url:a.url, source:'asset', type:sourceType(a.type || '', a.url) })); } catch { /* ignore */ }
    } else if (tab === 'canvas') {
      nodes.forEach(node => { (node.data.results || []).forEach((result, index) => items.push({ id:`${node.id}-${index}`, name:result.filename || node.data.label, mimeType:`${result.type}/unknown`, url:result.url, source:'canvas', type:result.type as SourceType })); const url=String(node.data.resultUrl || ''); if (url && !(node.data.results || []).some(result => result.url === url)) items.push({ id:`${node.id}-result`, name:node.data.label, mimeType:'application/octet-stream', url, source:'canvas', type:sourceType('', url) || 'text' }); });
    } else {
      try { const history = JSON.parse(localStorage.getItem('ai-canvas-history') || '[]') as Array<{id:string;nodeName:string;resultUrl?:string;results?:Array<{url:string;type:string;filename?:string}>}>; history.forEach(item => (item.results || (item.resultUrl ? [{url:item.resultUrl,type:sourceType('', item.resultUrl) || 'image'}] : [])).forEach((result,index) => items.push({ id:`${item.id}-${index}`, name:result.filename || item.nodeName, mimeType:`${result.type}/unknown`, url:result.url, source:'history', type:result.type as SourceType }))); } catch { /* ignore */ }
    }
    setSourceItems(items);
  }, [nodes]);
  const openSources = (tab: typeof sourceTab) => { setSourceTab(tab); setSelectedSourceIds(new Set()); refreshSources(tab); setSourceOpen(true); };
  useEffect(() => { if (sourceOpen && sourceTab !== 'local') refreshSources(sourceTab); }, [nodes, refreshSources, sourceOpen, sourceTab]);

  const handleLocalFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); const read = (file: File) => new Promise<ChatAttachment>(resolve => { const reader = new FileReader(); reader.onload = () => resolve({ name:file.name, mimeType:file.type || 'application/octet-stream', dataUrl:String(reader.result), source:'local' }); reader.onerror = () => resolve({ name:file.name, mimeType:file.type || 'application/octet-stream', source:'local' }); reader.readAsDataURL(file); });
    const loaded = await Promise.all(files.map(read));
    setSourceItems(loaded.map((item, index) => ({ ...item, id: `local-${index}-${item.name}`, type: sourceType(item.mimeType, item.dataUrl || '') })));
    setSourceTab('local'); setSelectedSourceIds(new Set()); setSourceOpen(true); event.target.value = '';
  };
  const addSelectedSources = () => { setAttachments(current => [...current, ...sourceItems.filter(item => selectedSourceIds.has(item.id)).map(({id:_id,type:_type,...item}) => item)]); setSourceOpen(false); };
  const newSession = () => { controllerRef.current?.abort(); sessionIdRef.current=generateId(); setMessages([]); setInput(''); setAttachments([]); draftRef.current=''; setSelectedMessages(new Set()); };
  const chooseSession = (session: ChatSession) => { controllerRef.current?.abort(); sessionIdRef.current=session.id; setMessages(session.messages || []); setInput(''); setAttachments([]); draftRef.current=''; };
  const fetchModels = async () => { setFetching(true); try { const models=await fetchModelsFromApi(settings.chatProvider, settings.chatBaseUrl, settings.chatApiKey); setChatModels(models); if (models[0] && !models.includes(selectedModel)) setSelectedModel(models[0]); message.success(`已获取 ${models.length} 个模型`); } catch (error) { message.error(error instanceof Error ? error.message : '拉取模型失败'); } finally { setFetching(false); } };

  const send = async (overrideText?: string, overrideAttachments?: ChatAttachment[], replaceFrom?: number) => {
    const text=(overrideText ?? input).trim(); const sentAttachments=overrideAttachments ?? attachments; if (!text && !sentAttachments.length) return;
    const historyMessages=replaceFrom == null ? messages : messages.slice(0, replaceFrom); const userMessage: ChatMessage={id:generateId(),role:'user',content:text,timestamp:Date.now(),attachments:sentAttachments,status:'complete'};
    setMessages([...historyMessages,userMessage]); setInput(''); setAttachments([]); setBusy(true); draftRef.current=''; const controller=new AbortController(); controllerRef.current=controller;
    const history: ChatTurn[]=historyMessages.map(item => ({role:item.role,content:item.content}));
    try { const result=await sendChat(text,sentAttachments,history,controller.signal,{model:selectedModel || undefined,thinkingMode,onChunk:chunk => { draftRef.current += chunk; }}); setMessages(current => [...current,{id:generateId(),role:'assistant',content:result.text,timestamp:Date.now(),status:'complete'}]); }
    catch (error) { if ((error as Error)?.name === 'AbortError') { if (draftRef.current) setMessages(current => [...current,{id:generateId(),role:'assistant',content:draftRef.current,timestamp:Date.now(),status:'stopped'}]); } else message.error(error instanceof Error ? error.message : '发送失败'); }
    finally { controllerRef.current=null; setBusy(false); draftRef.current=''; }
  };

  // 稳定回调（memo ChatBubble 用）
  const messagesRef = useRef(messages); messagesRef.current = messages;
  const sendRef = useRef(send); sendRef.current = send;
  const onToggleMsg = useCallback((id: string) => setSelectedMessages(cur => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  const onEditMsg = useCallback((item: ChatMessage) => { setInput(item.content); setAttachments(item.attachments || []); setMessages(cur => cur.slice(0, cur.findIndex(c => c.id === item.id))); }, []);
  const onRetryMsg = useCallback((item: ChatMessage) => { const index = messagesRef.current.findIndex(c => c.id === item.id); if (index >= 0) void sendRef.current(item.content, item.attachments || [], index); }, []);
  const onAddMediaMsg = useCallback((url: string, index: number) => { const type = mediaType(url); if (!type) return; addNode('asset', { x: 120 + (index % 3) * 280, y: 100 + Math.floor(index / 3) * 240 }, { label: `AI 返回${type === 'video' ? '视频' : '图片'}`, config: { assetType: type }, outputValues: { [type]: url, url }, resultUrl: url, results: [{ type, url }], status: 'success' }); }, [addNode]);

  const sendToEditor = () => { const text=messages.filter(item => selectedMessages.has(item.id)).map(item => `[${item.role === 'user' ? '你' : '助手'}]\n${item.content}`).join('\n\n---\n\n'); if (text) { setEditorText(current => current ? `${current}\n\n${text}` : text); setSelectedMessages(new Set()); } };
  const sendToCanvas = () => { if (!editorText.trim()) return; const pos = ((window as any).__canvasCenter?.() || { x: 300, y: 200 }); addNode('textInput',{x:pos.x,y:pos.y},{label:`AI 文本 - ${new Date().toLocaleTimeString()}`,content:editorText,config:{text:editorText}}); message.success('已发送到画布'); };
  const onMessagesMouseUp = () => { const sel = window.getSelection?.(); const txt = sel ? sel.toString().trim() : ''; if (txt && sel?.anchorNode) { const el = sel.anchorNode.parentElement; if (el && (el.closest?.('.chat-window-bubble') || el.classList?.contains?.('chat-message-content'))) { setSelText(txt); return; } } if (!txt) setSelText(''); };
  const onEditorMouseUp = () => { const sel = window.getSelection?.(); const txt = sel ? sel.toString().trim() : ''; setSelEditorText(txt || ''); };
  const pushEditorSelToCanvas = () => { if (!selEditorText.trim()) return; pushTextToCanvas(selEditorText); setSelEditorText(''); };
  const onDragStart = (e: React.PointerEvent) => { dragRef.current = { startX: e.clientX, startW: rightWidth }; const onMove = (ev: PointerEvent) => { const d = dragRef.current; if (!d) return; setRightWidth(Math.max(280, Math.min(window.innerWidth * 0.6, d.startW - (ev.clientX - d.startX)))); }; const onUp = () => { dragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); document.body.style.cursor = ''; }; document.body.style.cursor = 'col-resize'; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); };
  const pushSelToEditor = () => { if (!selText) return; setEditorText(current => current ? `${current}\n\n${selText}` : selText); setSelText(''); message.success('已发送选中文字到编辑区'); };
  const pushTextToCanvas = (text: string) => { if (!text.trim()) return; const pos = ((window as any).__canvasCenter?.() || { x: 300, y: 200 }); const id = addNode('textInput', pos, { label: `AI 文本 - ${new Date().toLocaleTimeString()}`, content: text, config: { text } }); setTimeout(() => { (window as any).__focusCanvasNode?.(id); }, 60); message.success('已发送选中文字到画布'); setSelText(''); };

  const addMenuItems = [
    { key: 'local', label: '本地文件…', onClick: () => fileInputRef.current?.click() },
    { key: 'asset', label: '资产', onClick: () => openSources('asset') },
    { key: 'canvas', label: '画布结果', onClick: () => openSources('canvas') },
    { key: 'history', label: '生成历史', onClick: () => openSources('history') },
  ];
  const moreMenuItems = [
    { key: 'fetch', label: fetching ? '拉取中…' : '拉取模型', onClick: () => void fetchModels() },
    { key: 'thinking', label: `思考模式：${thinkingMode === 'auto' ? '自动' : thinkingMode === 'fast' ? '快速' : '深度'}`, children: [{ key: 'tm-auto', label: '自动', onClick: () => setThinkingMode('auto') }, { key: 'tm-fast', label: '快速', onClick: () => setThinkingMode('fast') }, { key: 'tm-deep', label: '深度', onClick: () => setThinkingMode('deep') }] },
  ];

  return <div className="chat-window-overlay">
    <div className="chat-window-header">
      <div className="chat-window-header__title">AI 对话</div>
      <div className="chat-window-header__session">{currentSession.title}</div>
      <div className="chat-window-header__actions">
        <Button icon={<PlusOutlined />} onClick={newSession}>新对话</Button>
        <Dropdown menu={{ items: moreMenuItems }} trigger={['click']}><Button icon={<MoreOutlined />}>更多</Button></Dropdown>
        <Button icon={<CloseOutlined />} onClick={onClose} title="关闭" />
      </div>
    </div>
    <div className="chat-window-body" style={{ gridTemplateColumns: `248px minmax(0,1fr) 5px ${rightWidth}px` }}>
      <aside className={`chat-session-sidebar ${sidebarOpen ? '' : 'is-collapsed'}`}>
        {sidebarOpen ? <><div className="chat-session-sidebar__header"><span>历史对话</span><Button type="text" onClick={() => setSidebarOpen(false)}>收起</Button></div>
          <button className="chat-session-new" onClick={newSession}><PlusOutlined /> 新建对话</button>
          <input className="chat-session-search" placeholder="搜索对话" onChange={e => { const value=e.target.value; if (!value) void loadChatSessions().then(setSessions); else setSessions(current => current.filter(item => item.title.includes(value))); }} />
          <div className="chat-session-list">{sessions.map(session => <button key={session.id} className={session.id === sessionIdRef.current ? 'is-active' : ''} onClick={() => chooseSession(session)}><strong>{session.title}</strong><small>{session.messages.length} 条 · {new Date(session.updatedAt).toLocaleString()}</small></button>)}</div>
        </> : <Button type="text" onClick={() => setSidebarOpen(true)}>展开</Button>}
      </aside>
      <div className="chat-window-panel chat-window-panel--left">
        <div className="chat-window-panel__header"><span>聊天</span></div>
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json,.doc,.docx" hidden onChange={e=>void handleLocalFiles(e)} />
        <div className="chat-window-messages" onMouseUp={onMessagesMouseUp}>
          {!messages.length && !draftRef.current && <div className="chat-window-empty"><b>开始新的对话</b>选择一条历史会话，或直接输入消息</div>}
          {messages.map(item => <ChatBubble key={item.id} item={item} selected={selectedMessages.has(item.id)} onToggle={onToggleMsg} onEdit={onEditMsg} onRetry={onRetryMsg} onAddMedia={onAddMediaMsg} />)}
          {busy && <TypingBubble draftRef={draftRef} />}
          <div ref={messagesEndRef} />
        </div>
        {attachments.length > 0 && <div className="chat-window-attachments">{attachments.map((attachment,index)=><Tag key={`${attachment.name}-${index}`} closable onClose={()=>setAttachments(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>{attachment.name}</Tag>)}</div>}
        {selText && <div className="chat-selection-bar"><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:200 }}>已选中：{selText.slice(0,20)}{selText.length>20?'…':''}</span><Button size="small" type="primary" icon={<EditOutlined />} onClick={pushSelToEditor}>发选中到编辑区</Button><Button size="small" onClick={() => pushTextToCanvas(selText)}>发选中到画布</Button></div>}
        {selectedMessages.size > 0 && <div className="chat-window-send-editor"><Button size="small" icon={<EditOutlined />} onClick={sendToEditor}>发送选中到编辑区（{selectedMessages.size}）</Button></div>}
        <div className="chat-window-input-area">
          <div className="chat-window-input-row"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!busy)void send();}}} placeholder="输入消息，按 Enter 发送" rows={2} /></div>
          <div className="chat-window-input-options">
            <Dropdown menu={{ items: addMenuItems }} trigger={['click']}><Button icon={<PaperClipOutlined />}>＋ 添加附件</Button></Dropdown>
            <Select size="small" popupClassName="chat-window-select-popup" value={selectedModel || undefined} onChange={v=>{setSelectedModel(v);localStorage.setItem('chat-selected-model', v||'');}} options={chatModels.map(model=>({label:model,value:model}))} placeholder="选择模型" style={{ minWidth: 280 }} suffixIcon={<DownOutlined />} />
            <div className="chat-window-input-side">
              <span className="chat-window-input-hint">Shift+Enter 换行</span>
              {busy ? <Button className="chat-window-send-btn" danger onClick={()=>controllerRef.current?.abort()}><StopOutlined /> 停止</Button> : <Button className="chat-window-send-btn" type="primary" icon={<SendOutlined />} disabled={!input.trim()&&!attachments.length} onClick={()=>void send()}>发送</Button>}
            </div>
          </div>
        </div>
      </div>
      <div className="chat-window-dragger" onPointerDown={onDragStart} title="拖动调整编辑区宽度" />
      <div className="chat-window-panel chat-window-panel--right">
        <div className="chat-window-panel__header"><span>文本编辑区</span></div>
        <textarea className="chat-window-editor" value={editorText} onChange={e=>setEditorText(e.target.value)} onMouseUp={onEditorMouseUp} placeholder={'选择一条消息\n在这里编辑或整理文本'} />
        <div className="chat-window-editor-actions">{selEditorText && <Button onClick={pushEditorSelToCanvas} title="把编辑区选中的文字发到画布">发送选中到画布（{selEditorText.length}）</Button>}<Button type="primary" icon={<FileTextOutlined />} disabled={!editorText.trim()} onClick={sendToCanvas}>发送到画布</Button></div>
      </div>
    </div>
    <Modal title={`导入${sourceTab==='local'?'本地文件':sourceTab==='asset'?'资产':sourceTab==='canvas'?'画布结果':'生成历史'}`} open={sourceOpen} onCancel={()=>setSourceOpen(false)} onOk={addSelectedSources} okText={`导入（${selectedSourceIds.size}）`} width={720}>
      <div className="chat-source-grid">{sourceItems.map(item=><button key={item.id} className={selectedSourceIds.has(item.id)?'is-selected':''} onClick={()=>setSelectedSourceIds(current=>{const next=new Set(current);next.has(item.id)?next.delete(item.id):next.add(item.id);return next;})}>{item.type==='image'?<img src={item.dataUrl||item.url} alt=""/>:item.type==='video'?<video src={item.dataUrl||item.url} muted/>:<div className="chat-source-file"><PaperClipOutlined /></div>}<span>{item.name}</span></button>)}</div>
      {!sourceItems.length && <div className="chat-window-empty">暂无可导入内容</div>}
    </Modal>
  </div>;
};
