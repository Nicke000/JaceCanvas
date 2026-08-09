import React, { useState } from 'react';
import { Modal, Button, Input, message } from 'antd';
import { StarOutlined, StarFilled, DeleteOutlined, UpOutlined, DownOutlined, SendOutlined } from '@ant-design/icons';

interface FavPrompt { id: string; text: string; name: string; pinned: boolean; createdAt: number; order?: number; }
const KEY = 'jacecanvas-fav-prompts';

function load(): FavPrompt[] {
  try { const raw = localStorage.getItem(KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
}

/** 顶部「提示词库」：收藏常用提示词，可置顶/排序/改名/删除，一键发送到画布（创建文本节点）。 */
export const PromptLibrary: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [favs, setFavs] = useState<FavPrompt[]>(load);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const save = (next: FavPrompt[]) => { setFavs(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { message.warning('收藏保存失败（本地存储已满）'); } };
  const sorted = [...favs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
  const add = () => {
    const t = input.trim(); if (!t) return;
    save([...favs, { id: String(Date.now()), text: t, name: '提示词 ' + (favs.length + 1), pinned: false, createdAt: Date.now(), order: favs.reduce((m, f) => Math.max(m, f.order ?? f.createdAt), 0) + 1 }]);
    setInput('');
  };
  const togglePin = (id: string) => save(favs.map(f => f.id === id ? { ...f, pinned: !f.pinned } : f));
  const remove = (id: string) => save(favs.filter(f => f.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const arr = [...sorted]; const i = arr.findIndex(f => f.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    // 跨置顶/非置顶组时禁止移动（保持组边界稳定）
    if (Boolean(arr[i].pinned) !== Boolean(arr[j].pinned)) { message.info('置顶与普通分组之间不可拖动排序'); return; }
    const lo = arr[i].order ?? arr[i].createdAt; const hi = arr[j].order ?? arr[j].createdAt;
    const fixed = arr.map((f, idx) => idx === i ? { ...f, order: hi } : idx === j ? { ...f, order: lo } : f);
    save(fixed);
  };
  const rename = (id: string) => {
    if (editingId === id) { save(favs.map(f => f.id === id ? { ...f, name: editName.trim() || f.name } : f)); setEditingId(null); }
    else { setEditingId(id); setEditName(favs.find(f => f.id === id)?.name || ''); }
  };
  const send = (f: FavPrompt) => { window.dispatchEvent(new CustomEvent('ai-canvas-add-text-node', { detail: { text: f.text } })); onClose(); };
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={560} title={<><StarFilled style={{ color: '#f5b301' }} /> 提示词库</>}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <Input value={input} onChange={e => setInput(e.target.value)} onPressEnter={add} placeholder="收藏当前提示词，或直接输入新提示词…" />
        <Button type="primary" onClick={add}>收藏</Button>
      </div>
      <div style={{ maxHeight: 380, overflow: 'auto' }}>
        {sorted.length === 0 && <div style={{ color: 'var(--theme-muted)', fontSize: 12, textAlign: 'center', padding: 20 }}>还没有收藏提示词，输入后点「收藏」</div>}
        {sorted.map(f => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--theme-border)', fontSize: 12 }}>
            <StarOutlined onClick={() => togglePin(f.id)} style={{ color: f.pinned ? '#f5b301' : 'var(--theme-muted)', cursor: 'pointer', fontSize: 14, flex: 'none' }} />
            {editingId === f.id
              ? <Input size="small" value={editName} onChange={e => setEditName(e.target.value)} onPressEnter={() => rename(f.id)} onBlur={() => rename(f.id)} style={{ width: 120 }} />
              : <span onClick={() => rename(f.id)} style={{ minWidth: 80, maxWidth: 120, flex: 'none', color: 'var(--theme-text-2)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="点击改名">{f.name}</span>}
            <span style={{ flex: 1, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.text}>{f.text}</span>
            <Button size="small" type="text" icon={<SendOutlined />} onClick={() => send(f)} title="发送到画布（创建文本节点）" style={{ flex: 'none' }} />
            <Button size="small" type="text" icon={<UpOutlined />} onClick={() => move(f.id, -1)} title="上移" style={{ flex: 'none' }} />
            <Button size="small" type="text" icon={<DownOutlined />} onClick={() => move(f.id, 1)} title="下移" style={{ flex: 'none' }} />
            <Button size="small" type="text" icon={<DeleteOutlined style={{ color: '#ef4444' }} />} onClick={() => remove(f.id)} title="删除" style={{ flex: 'none' }} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--theme-muted)' }}>发送到画布会创建一个「文本输入」节点，可继续连接到付费节点等使用。置顶的提示词排在最前。</div>
    </Modal>
  );
};
