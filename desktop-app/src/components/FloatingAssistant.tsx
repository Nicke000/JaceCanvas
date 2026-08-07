import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Video, Sparkles } from 'lucide-react';
import { sendChat, fetchModelsFromApi, type ChatAttachment, type ChatTurn } from '@/services/chat.service';
import { useSettingsStore } from '@/stores/settingsStore';

type Msg = { role: 'user' | 'ai'; text: string };

/**
 * 悬浮 AI 助手：常驻右下角，可随意拖动；点击头像展开小对话面板。
 * 支持图片/文件附件（本地 / 资产 / 画布 / 历史）与模型选择。
 */
export const FloatingAssistant: React.FC<{ hidden?: boolean }> = ({ hidden }) => {
  const settings = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(() => ({ left: Math.max(8, window.innerWidth - 66), top: Math.max(8, window.innerHeight - 96) }));
  const drag = useRef<{ dx: number; dy: number; moved: boolean; startX: number; startY: number } | null>(null);
  const movedRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [greeted, setGreeted] = useState(false);

  // 来源选择（本地 / 资产 / 画布 / 历史）
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceTab, setSourceTab] = useState<'local' | 'asset' | 'canvas' | 'history'>('asset');
  const [sourceItems, setSourceItems] = useState<Array<{ id: string; name: string; url?: string; type: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  // 模型
  const [chatModels, setChatModels] = useState<string[]>(settings.chatModels || []);
  const [selectedModel, setSelectedModel] = useState(settings.chatModel || '');
  const [fetching, setFetching] = useState(false);

  useEffect(() => { if (open && !greeted) { setMessages([{ role: 'ai', text: '你好呀～ 我是你的 AI 助手，可以帮你写提示词、改文案、出主意 ✨' }]); setGreeted(true); } }, [open, greeted]);

  // 拖动：只有位移超过阈值才视为拖动（区分点击与拖动）
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.dx, dy = e.clientY - d.dy;
      if (Math.abs(e.clientX - d.startX) > 4 || Math.abs(e.clientY - d.startY) > 4) { d.moved = true; movedRef.current = true; }
      setPos({ left: Math.max(4, dx), top: Math.max(4, dy) });
    };
    const up = () => { movedRef.current = !!drag.current?.moved; drag.current = null; }; // 拖动结束才吞一次即将到来的 click，非拖动点击正常打开
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages, busy]);

  const refreshSources = (tab: typeof sourceTab) => {
    const items: Array<{ id: string; name: string; url?: string; type: string }> = [];
    if (tab === 'asset') {
      try { const assets = JSON.parse(localStorage.getItem('ai-canvas-assets-v2') || '[]') as Array<{ id: string; name: string; type: string; url: string }>; assets.forEach(a => items.push({ id: a.id, name: a.name, url: a.url, type: (a.type || '').startsWith('video') ? 'video' : 'image' })); } catch { /* ignore */ }
    } else if (tab === 'canvas') {
      try {
        const store = (window as any).__canvasStore?.getState?.();
        const nodes = store?.nodes || [];
        nodes.forEach((node: any) => { (node.data?.results || []).forEach((r: any, index: number) => { if (r.url) items.push({ id: `${node.id}-${index}`, name: r.filename || node.data?.label, url: r.url, type: r.type === 'video' ? 'video' : 'image' }); }); const url = String(node.data?.resultUrl || ''); if (url && !items.some(x => x.url === url)) items.push({ id: `${node.id}-result`, name: node.data?.label, url, type: /(mp4|webm|mov)/i.test(url) ? 'video' : 'image' }); });
      } catch { /* ignore */ }
    } else if (tab === 'history') {
      try { const history = JSON.parse(localStorage.getItem('ai-canvas-history') || '[]') as Array<{ id: string; nodeName: string; resultUrl?: string; results?: Array<{ url: string; type: string; filename?: string }> }>; history.forEach(h => (h.results || (h.resultUrl ? [{ url: h.resultUrl, type: 'image' }] : [])).forEach((r, index) => { if (r.url) items.push({ id: `${h.id}-${index}`, name: r.filename || h.nodeName, url: r.url, type: r.type === 'video' ? 'video' : 'image' }); })); } catch { /* ignore */ }
    }
    setSourceItems(items);
  };
  const openSources = (tab: typeof sourceTab) => { setSourceTab(tab); setSelectedIds(new Set()); refreshSources(tab); setSourceOpen(true); };
  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    const read = (file: File) => new Promise<ChatAttachment>(resolve => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: String(reader.result), source: 'local' }); reader.onerror = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', source: 'local' }); reader.readAsDataURL(file); });
    Promise.all(files.map(read)).then(setAttachments);
  };
  const addSelectedSources = () => {
    setAttachments(cur => [...cur, ...sourceItems.filter(x => selectedIds.has(x.id)).map(x => ({ name: x.name, mimeType: (x.type === 'video' ? 'video/' : 'image/') + 'unknown', url: x.url, source: sourceTab as ChatAttachment['source'] }))]);
    setSourceOpen(false);
  };
  const fetchModels = async () => {
    setFetching(true);
    try {
      const models = await fetchModelsFromApi(settings.chatProvider, settings.chatBaseUrl, settings.chatApiKey);
      setChatModels(models);
      if (models[0] && !models.includes(selectedModel)) setSelectedModel(models[0]);
    } catch { /* ignore */ } finally { setFetching(false); }
  };

  const send = async () => {
    const text = input.trim(); if ((!text && !attachments.length) || busy) return;
    setMessages(m => [...m, { role: 'user', text: text || '（附件）' }]);
    setInput(''); setBusy(true);
    const sent = attachments; setAttachments([]);
    try {
      const history: ChatTurn[] = messages.filter(m => m.role === 'user').map(m => ({ role: 'user', content: m.text }));
      const result = await sendChat(text, sent, history, undefined, { model: selectedModel || undefined, thinkingMode: settings.chatThinkingMode, onChunk: () => {} });
      setMessages(m => [...m, { role: 'ai', text: result.text || '（无回复）' }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: 'ai', text: '出错了：' + String(e?.message || e) + '（请先在设置中配置聊天 AI）' }]);
    } finally { setBusy(false); }
  };

  const panelWidth = 320;
  const startDrag = (e: React.MouseEvent) => { const el = e.currentTarget as HTMLElement; const rect = el.getBoundingClientRect(); drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false, startX: e.clientX, startY: e.clientY }; e.preventDefault(); };
  const handleAvatarClick = () => { if (movedRef.current) { movedRef.current = false; return; } setOpen(o => !o); };

  if (hidden) return null; // 覆盖层窗口打开时隐藏悬浮助手（所有 hooks 之后，保留拖动位置 state）

  return (
    <>
      {open && (
        <div style={{ position: 'fixed', left: Math.min(pos.left, window.innerWidth - panelWidth - 8), top: Math.max(8, Math.min(pos.top - 330, window.innerHeight - 340)), width: panelWidth, height: 330, zIndex: 9990, display: 'flex', flexDirection: 'column', borderRadius: 14, border: '1px solid var(--theme-border)', background: 'var(--theme-panel)', boxShadow: '0 16px 48px rgba(0,0,0,.5)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--theme-border)', cursor: 'grab', userSelect: 'none', background: 'linear-gradient(90deg,rgba(192,132,252,.18),rgba(249,168,212,.14))' }} onMouseDown={startDrag}>
            <img src="./ai-assistant.png" alt="AI 助手" style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'cover' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e9d5ff', flex: 1 }}>AI 助手</span>
            <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>拖动移动</span>
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--theme-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
          </div>
          <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '6px 9px', borderRadius: 10, fontSize: 11, lineHeight: 1.55, background: m.role === 'user' ? 'rgba(99,102,241,.35)' : 'var(--theme-border)', color: 'var(--theme-text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
            ))}
            {busy && <div style={{ alignSelf: 'flex-start', padding: '6px 9px', borderRadius: 10, fontSize: 11, color: 'var(--theme-muted)', background: 'var(--theme-border)' }}>正在思考…</div>}
          </div>
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 8px', borderTop: '1px solid var(--theme-border)' }}>
              {attachments.map((a, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, background: 'rgba(99,102,241,.2)', color: '#c7d2fe', borderRadius: 6, padding: '2px 6px' }}>
                  {a.mimeType?.startsWith('image/') && (a.dataUrl || a.url) ? <img src={a.dataUrl || a.url} alt="" style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover' }} /> : <Paperclip size={13} />}
                  <span style={{ maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <button onClick={() => setAttachments(cur => cur.filter((_, j) => j !== i))} style={{ border: 'none', background: 'transparent', color: 'var(--theme-muted)', cursor: 'pointer' }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderTop: '1px solid var(--theme-border)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => fileRef.current?.click()} style={{ border: '1px solid var(--theme-border)', background: 'transparent', color: 'var(--theme-primary)', borderRadius: 6, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}><Paperclip size={11} /> 本地</button>
            <button onClick={() => openSources('asset')} style={{ border: '1px solid var(--theme-border)', background: 'transparent', color: 'var(--theme-primary)', borderRadius: 6, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}>资产</button>
            <button onClick={() => openSources('canvas')} style={{ border: '1px solid var(--theme-border)', background: 'transparent', color: 'var(--theme-primary)', borderRadius: 6, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}>画布</button>
            <button onClick={() => openSources('history')} style={{ border: '1px solid var(--theme-border)', background: 'transparent', color: 'var(--theme-primary)', borderRadius: 6, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}>历史</button>
            <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)} onFocus={() => { if (!chatModels.length) void fetchModels(); }} style={{ flex: 1, minWidth: 0, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 6, padding: '2px 5px', fontSize: 10 }}>
              {chatModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!chatModels.length && <option value="">{fetching ? '获取中…' : '选择模型'}</option>}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid var(--theme-border)' }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="问点什么…" style={{ flex: 1, minWidth: 0, background: 'var(--theme-input)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: '6px 9px', fontSize: 11, outline: 'none' }} />
            <button onClick={() => void send()} disabled={busy || (!input.trim() && !attachments.length)} style={{ border: 'none', borderRadius: 8, padding: '0 12px', fontSize: 11, cursor: 'pointer', background: 'linear-gradient(90deg,#818cf8,#c084fc)', color: '#fff', fontWeight: 600 }}>发送</button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.txt,.md,.json" hidden onChange={handleLocalFiles} />
      <div
        title="AI 助手（可拖动，点击展开）"
        onMouseDown={e => { if (!open) startDrag(e); }}
        onClick={handleAvatarClick}
        style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9980, cursor: 'pointer', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0 6px 16px rgba(192,132,252,.5))', userSelect: 'none' }}
      >
        <img src="./ai-assistant.png" alt="AI 助手" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--theme-border)' }} />
        <span style={{ position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: '50%', background: '#34d399', border: '2px solid #0f1628' }} />
      </div>
      {sourceOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSourceOpen(false)}>
          <div style={{ width: 560, maxWidth: '92vw', maxHeight: '76vh', background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--theme-border)' }}>
              <b style={{ fontSize: 13, color: 'var(--theme-text)' }}>从{sourceTab === 'asset' ? '资产' : sourceTab === 'canvas' ? '画布' : '历史'}选择附件</b>
              <div style={{ flex: 1 }} />
              <button onClick={() => setSourceOpen(false)} style={{ border: 'none', background: 'transparent', color: 'var(--theme-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, padding: 12, overflow: 'auto', maxHeight: '56vh' }}>
              {sourceItems.map(item => (
                <button key={item.id} onClick={() => setSelectedIds(cur => { const next = new Set<string>(cur); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} style={{ border: selectedIds.has(item.id) ? '2px solid #818cf8' : '1px solid var(--theme-border)', borderRadius: 8, overflow: 'hidden', padding: 0, background: 'rgba(15,23,42,.6)', cursor: 'pointer' }}>
                  {item.url ? (item.type === 'video' ? <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--theme-text-3)' }}><Video size={20} /></div> : <img src={item.url} alt="" style={{ width: '100%', height: 70, objectFit: 'cover' }} />) : <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--theme-text-3)' }}><Paperclip size={16} /></div>}
                  <span style={{ display: 'block', fontSize: 9, color: 'var(--theme-muted)', padding: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                </button>
              ))}
              {!sourceItems.length && <div style={{ gridColumn: '1/-1', padding: 30, textAlign: 'center', color: 'var(--theme-muted)', fontSize: 12 }}>该来源暂无内容</div>}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid var(--theme-border)', textAlign: 'right' }}>
              <button onClick={addSelectedSources} disabled={!selectedIds.size} style={{ border: 'none', borderRadius: 8, padding: '6px 16px', fontSize: 11, cursor: 'pointer', background: 'linear-gradient(90deg,#818cf8,#c084fc)', color: '#fff', fontWeight: 600 }}>添加（{selectedIds.size}）</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
