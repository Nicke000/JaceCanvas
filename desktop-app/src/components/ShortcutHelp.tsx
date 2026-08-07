import React, { useEffect, useState } from 'react';
import { Modal, Button, Space } from 'antd';
import { SHORTCUT_DEFS, getShortcuts, setShortcut, resetShortcuts } from '@/utils/shortcuts';

const STATIC_GROUPS: { title: string; rows: [string, string][] }[] = [
  { title: '画布导航', rows: [
    ['左键拖拽', '移动画布'],
    ['滚轮', '缩放画布'],
    ['双击空白处', '搜索并添加节点'],
    ['Ctrl + 拖拽', '框选多个节点'],
    ['Shift + 点击', '多选加选 / 减选'],
  ]},
  { title: '快捷工具', rows: [
    ['Ctrl + K', '打开命令面板'],
    ['选中 ≥2 个节点', '顶部工具栏：对齐 / 成组'],
  ]},
];

/** 快捷键帮助面板：帮助菜单打开，可点击快捷键自定义。 */
export const ShortcutHelp: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [shortcuts, setShortcutsState] = useState<Record<string, string>>(getShortcuts());
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const openHelp = () => { setShortcutsState(getShortcuts()); setOpen(true); };
    window.addEventListener('ai-canvas-open-shortcuts', openHelp);
    return () => window.removeEventListener('ai-canvas-open-shortcuts', openHelp);
  }, []);
  const captureKey = (e: React.KeyboardEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { setEditing(null); return; }
    if (e.key === 'Backspace') {
      const def = SHORTCUT_DEFS.find(d => d.id === id);
      if (def) setShortcut(id, def.default);
    } else {
      const combo = [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+');
      setShortcut(id, combo || e.key);
    }
    setShortcutsState(getShortcuts()); setEditing(null);
  };
  return (
    <Modal title="快捷键与操作（点击按键可自定义）" open={open} onCancel={() => setOpen(false)} footer={null} width={560}>
      {STATIC_GROUPS.map(group => (
        <div key={group.title} className="shortcut-group">
          <h4 className="shortcut-group__title">{group.title}</h4>
          {group.rows.map(([key, desc]) => (
            <div key={key} className="shortcut-row">
              <kbd className="shortcut-key">{key}</kbd>
              <span className="shortcut-desc">{desc}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="shortcut-group">
        <h4 className="shortcut-group__title">节点编辑（可自定义，点击按键修改）</h4>
        {SHORTCUT_DEFS.map(def => (
          <div key={def.id} className="shortcut-row">
            {editing === def.id ? (
              <kbd tabIndex={0} autoFocus onKeyDown={e => captureKey(e, def.id)} className="shortcut-key shortcut-key--editing" style={{ outline: '2px solid var(--theme-primary)' }}>按新按键…（Esc 取消 / Backspace 恢复默认）</kbd>
            ) : (
              <kbd className="shortcut-key" onClick={() => setEditing(def.id)} title="点击修改">{shortcuts[def.id] || def.default}</kbd>
            )}
            <span className="shortcut-desc">{def.desc}</span>
          </div>
        ))}
        <Space style={{ marginTop: 10 }}>
          <Button size="small" onClick={() => { resetShortcuts(); setShortcutsState(getShortcuts()); message_success(); }}>恢复默认</Button>
          <span style={{ fontSize: 10, color: 'var(--theme-muted)' }}>修改立即生效</span>
        </Space>
      </div>
    </Modal>
  );
};
function message_success() { /* 轻提示占位：通过 antd message 不可行时静默 */ }
