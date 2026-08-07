import React, { useEffect, useRef, useState } from 'react';
import { Bot, Send, X, Loader2, CheckCircle2, XCircle, Paperclip, FolderOpen, SearchCheck, Package, FlaskConical, BookOpen } from 'lucide-react';
import { runCanvasAgent, resolveSourceConfirm, type AgentEvent } from '@/services/canvasAgent.service';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ChatAttachment } from '@/services/chat.service';
import { Modal, message } from 'antd';

type Item =
  | { kind: 'user'; text: string }
  | { kind: 'ai'; text: string }
  | { kind: 'tool'; action: string; summary: string; ok: boolean };

const EXAMPLES = ['帮我搭一个 文本 → 文生图 → 预览 的工作流', '检查画布上有没有报错的节点，并尝试修复', '给画布加一个前后对比节点'];

/** 一键快捷指令：点击即发送给 AI */
const QUICK_COMMANDS: Array<{ icon: React.ReactNode; label: string; cmd: string }> = [
  { icon: <SearchCheck size={12} />, label: '检查并修复画布错误', cmd: '检查画布上所有报错的节点，分析原因并尝试修复，最后告诉我每个错误的原因和结果' },
  { icon: <Package size={12} />, label: '打包成安装版', cmd: '把当前最新的沙盒源码版本打包成 Windows 安装版，完成后告诉我安装包在哪个路径' },
  { icon: <FlaskConical size={12} />, label: '测试沙盒版本', cmd: '查看最新沙盒源码版本的构建/打包状态，告诉我怎么测试它（构建通过了吗？安装包在哪？）' },
  { icon: <BookOpen size={12} />, label: '新手引导', cmd: '我是新手，请给我讲讲这个画布应用怎么用：怎么搭工作流、怎么连接服务器、常见问题' },
];

/** 画布 AI 代码 Agent：自然语言指挥 AI 加节点/连线/改配置/查错修复 */
export const AgentPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const chatKey = useSettingsStore(s => s.chatApiKey);
  const chatProvider = useSettingsStore(s => s.chatProvider);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const greeted = useRef(false);

  useEffect(() => {
    if (open && !greeted.current) {
      greeted.current = true;
      setItems([{ kind: 'ai', text: '我是 Jace-DevAgent，可以直接帮你操作画布：加节点、连线、改配置、检查并修复报错；也可以帮你修改软件源代码（沙盒安全模式）。试试：' }]);
    }
  }, [open]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [items, busy]);

  if (!open) return null;

  const send = async (presetText?: string) => {
    const text = (presetText ?? input).trim();
    if ((!text && !attachments.length) || busy) return;
    if (!presetText) setInput('');
    const atts = attachments;
    setAttachments([]);
    setItems(prev => [...prev, { kind: 'user', text: text || (atts.length ? `（发送 ${atts.length} 个附件）` : '') }]);
    setBusy(true);
    try {
      await runCanvasAgent(text, (e: AgentEvent) => {
        if (e.kind === 'tool') setItems(prev => [...prev, { kind: 'tool', action: e.action, summary: e.summary, ok: e.ok }]);
        else if (e.kind === 'text') setItems(prev => [...prev, { kind: 'ai', text: e.text }]);
        else if (e.kind === 'error') setItems(prev => [...prev, { kind: 'tool', action: '错误', summary: e.message, ok: false }]);
        else if (e.kind === 'confirm-source') {
          // 改源码 / 删版本前的用户确认（不可恢复操作）
          Modal.confirm({
            title: '需要你确认',
            content: <div style={{ fontSize: 12, lineHeight: 1.6 }}>{e.summary}<div style={{ marginTop: 8, color: 'var(--theme-warning)' }}>安全规则：只会复制一份源码副本供修改，主版本原样保留；删除版本不可恢复，且始终保留 2 个可用版本。</div></div>,
            okText: '确认', cancelText: '取消',
            onOk: () => resolveSourceConfirm(true),
            onCancel: () => resolveSourceConfirm(false),
          });
        }
      }, atts);
    } catch (err: any) {
      setItems(prev => [...prev, { kind: 'tool', action: '调用失败', summary: String(err?.message || err).slice(0, 160), ok: false }]);
    } finally {
      setBusy(false);
    }
  };

  const openLatestVersion = async () => {
    try {
      const api = (window as any).electronAPI?.sourceApi;
      if (!api) { message.warning('源码沙盒仅在桌面版可用'); return; }
      const info = await api.listVersions();
      const latest = info.versions.filter((v: any) => v.id !== 'v0').sort((a: any, b: any) => b.createdAt - a.createdAt)[0];
      const dir = latest ? latest.path : info.root;
      const ok = await (window as any).electronAPI?.sourceOpenPath?.(dir);
      if (!ok) message.info('已定位沙盒目录：' + dir);
    } catch (e: any) { message.error('打开失败: ' + String(e?.message || e).slice(0, 100)); }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const read = (file: File) => new Promise<ChatAttachment>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: String(reader.result), source: 'local' });
      reader.onerror = () => resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', source: 'local' });
      reader.readAsDataURL(file);
    });
    void Promise.all(files.map(read)).then(list => setAttachments(prev => [...prev, ...list]));
    e.target.value = '';
  };

  return (
    <div className="agent-panel" style={{ position: 'fixed', right: 16, bottom: 88, width: 400, maxWidth: 'calc(100vw - 32px)', height: 560, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 14, boxShadow: 'var(--theme-shadow-lg)', zIndex: 1200, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--theme-border)', background: 'var(--theme-surface-2)' }}>
        <Bot size={16} style={{ color: 'var(--theme-primary)' }} />
        <b style={{ fontSize: 13, flex: 1 }}>Jace-DevAgent</b>
        <span style={{ fontSize: 10, color: 'var(--theme-text-3)' }}>{busy ? '执行中…' : '可操作画布与源码'}</span>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--theme-muted)', cursor: 'pointer', display: 'flex' }}><X size={15} /></button>
      </div>

      <div style={{ padding: '7px 14px', fontSize: 11, lineHeight: 1.5, color: 'var(--theme-warning)', background: 'var(--theme-warning-soft)', borderBottom: '1px solid var(--theme-warning-border)' }}>
        谨慎命令：涉及「修改/修复软件源代码」的指令会进入沙盒安全模式（复制副本修改、原版不动、保留 2 个可用版本）。
      </div>

      {!chatKey && chatProvider !== 'ollama' && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--theme-warning)', background: 'var(--theme-warning-soft)', borderBottom: '1px solid var(--theme-warning-border)' }}>
          尚未配置聊天 AI 密钥——请先到 设置 → AI 聊天 填写 API Key，或改用 ollama 本地模型。
        </div>
      )}

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => {
          if (item.kind === 'user') return <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '86%', background: 'var(--theme-accent-soft)', border: '1px solid var(--theme-accent-border)', borderRadius: 10, padding: '7px 10px', fontSize: 12 }}>{item.text}</div>;
          if (item.kind === 'ai') return <div key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%', background: 'var(--theme-surface-2)', border: '1px solid var(--theme-border)', borderRadius: 10, padding: '8px 11px', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.text}</div>;
          return (
            <div key={i} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: 'var(--theme-text-2)', background: 'var(--theme-input)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: '5px 8px', maxWidth: '94%' }}>
              {item.ok ? <CheckCircle2 size={13} style={{ color: 'var(--theme-success)', flexShrink: 0, marginTop: 1 }} /> : <XCircle size={13} style={{ color: 'var(--theme-error)', flexShrink: 0, marginTop: 1 }} />}
              <span style={{ whiteSpace: 'pre-wrap' }}><b style={{ color: 'var(--theme-accent)' }}>{item.action}</b> — {item.summary}</span>
            </div>
          );
        })}
        {busy && <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--theme-text-3)' }}><Loader2 size={13} className="agent-spin" /> AI 正在分析画布并执行…</div>}
        {!items.length && <div style={{ fontSize: 11, color: 'var(--theme-text-3)', lineHeight: 1.7, padding: 4 }}>
          {EXAMPLES.map((ex, i) => <div key={i} style={{ cursor: 'pointer', padding: '5px 8px', borderRadius: 6, background: 'var(--theme-surface-2)', border: '1px solid var(--theme-border)', marginBottom: 5, color: 'var(--theme-text-2)' }} onClick={() => { setInput(ex); }}>{ex}</div>)}
        </div>}
      </div>

      <div style={{ borderTop: '1px solid var(--theme-border)', padding: 10, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--theme-surface-2)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {QUICK_COMMANDS.map(q => (
            <button key={q.label} onClick={() => void send(q.cmd)} disabled={busy} title={q.cmd}
              style={{ border: '1px solid var(--theme-border)', borderRadius: 12, padding: '3px 8px', fontSize: 10, background: 'var(--theme-surface-2)', color: 'var(--theme-text-2)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              {q.icon} {q.label}
            </button>
          ))}
        </div>
        {attachments.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{attachments.map((a, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, background: 'var(--theme-input)', border: '1px solid var(--theme-border)', borderRadius: 6, padding: '2px 6px', color: 'var(--theme-text-2)' }}>
            {a.mimeType.startsWith('image/') && a.dataUrl ? <img src={a.dataUrl} alt="" style={{ width: 14, height: 14, borderRadius: 3, objectFit: 'cover' }} /> : <Paperclip size={11} />}
            {a.name}
            <X size={10} style={{ cursor: 'pointer' }} onClick={() => setAttachments(cur => cur.filter((_, j) => j !== i))} />
          </span>
        ))}</div>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input ref={fileRef} type="file" multiple accept=".txt,.md,.json,.js,.ts,.py,.yaml,.yml,.xml,.toml,.env,.ini,image/*,.pdf" hidden onChange={handleFiles} />
        <button onClick={() => fileRef.current?.click()} title="添加附件（API 文档/配置/截图）" style={{ border: '1px solid var(--theme-border)', borderRadius: 8, padding: '6px 8px', background: 'transparent', color: 'var(--theme-muted)', cursor: 'pointer', display: 'flex' }}><Paperclip size={14} /></button>
        <button onClick={openLatestVersion} title="修复完成后：打开最新沙盒版本目录" style={{ border: '1px solid var(--theme-border)', borderRadius: 8, padding: '6px 8px', background: 'transparent', color: 'var(--theme-accent)', cursor: 'pointer', display: 'flex' }}><FolderOpen size={14} /></button>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="说想做什么，或附上 API 文档让我读"
          style={{ flex: 1, background: 'var(--theme-input)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--theme-text)', outline: 'none' }}
        />
        <button onClick={() => void send()} disabled={busy || (!input.trim() && !attachments.length)} title="发送指令"
          style={{ border: 'none', borderRadius: 8, padding: '7px 10px', background: busy ? 'var(--theme-muted)' : 'var(--theme-primary)', color: '#fff', cursor: busy ? 'default' : 'pointer', display: 'flex', opacity: (input.trim() || attachments.length) && !busy ? 1 : 0.6 }}>
          {busy ? <Loader2 size={14} className="agent-spin" /> : <Send size={14} />}
        </button>
        </div>
      </div>
    </div>
  );
};
