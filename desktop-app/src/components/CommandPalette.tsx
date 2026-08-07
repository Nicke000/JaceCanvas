import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { Type, StickyNote, FileText, Clapperboard, Eye, Upload, GitCompare, LayoutGrid, Grid3x3, Map, Camera, FolderOpen, Keyboard, Undo2, Redo2 } from 'lucide-react';
import type { NodeComponentType } from '@/types';

interface Cmd { id: string; label: string; group: string; icon: React.ReactNode; keywords: string; run: () => void; }

/** 命令面板：Ctrl/Cmd+K 呼出，搜索并执行画布命令（专业工具标配）。 */
export const CommandPalette: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
        setQuery('');
        setIndex(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  const close = () => setOpen(false);
  const fire = (eventName: string) => { window.dispatchEvent(new Event(eventName)); close(); };
  const addNodeAtCenter = (type: NodeComponentType, label?: string) => {
    const pos = (window as any).__canvasCenter?.() || { x: 200, y: 160 };
    useCanvasStore.getState().addNode(type, pos, label ? ({ label } as any) : undefined);
    close();
  };

  const commands: Cmd[] = useMemo(() => [
    { id: 'n-text', group: '添加节点', icon: <Type size={13} />, label: '文本输入', keywords: 'text 文本', run: () => addNodeAtCenter('textInput') },
    { id: 'n-note', group: '添加节点', icon: <StickyNote size={13} />, label: '备注', keywords: 'note 注释 便利贴', run: () => addNodeAtCenter('note', '备注') },
    { id: 'n-script', group: '添加节点', icon: <FileText size={13} />, label: '剧本输入', keywords: 'script 剧本', run: () => addNodeAtCenter('scriptInput') },
    { id: 'n-scene', group: '添加节点', icon: <Clapperboard size={13} />, label: '场景设定', keywords: 'scene 场景', run: () => addNodeAtCenter('sceneSettings') },
    { id: 'n-preview', group: '添加节点', icon: <Eye size={13} />, label: '结果预览', keywords: 'preview 预览', run: () => addNodeAtCenter('preview', '结果预览') },
    { id: 'n-upload', group: '添加节点', icon: <Upload size={13} />, label: '上传文件', keywords: 'upload 上传', run: () => addNodeAtCenter('uploadNode') },
    { id: 'n-compare', group: '添加节点', icon: <GitCompare size={13} />, label: '前后对比', keywords: 'compare 对比', run: () => addNodeAtCenter('compare') },
    { id: 'a-layout', group: '画布操作', icon: <LayoutGrid size={13} />, label: '一键整理画布', keywords: 'layout 整理 布局 auto', run: () => fire('ai-canvas-auto-layout') },
    { id: 'a-grid', group: '画布操作', icon: <Grid3x3 size={13} />, label: '切换网格', keywords: 'grid 网格', run: () => fire('ai-canvas-toggle-grid') },
    { id: 'a-minimap', group: '画布操作', icon: <Map size={13} />, label: '切换小地图', keywords: 'minimap 小地图', run: () => fire('ai-canvas-toggle-minimap') },
    { id: 'a-snapshot', group: '画布操作', icon: <Camera size={13} />, label: '导出画布截图', keywords: 'snapshot 截图 导出', run: () => fire('ai-canvas-snapshot') },
    { id: 'a-library', group: '画布操作', icon: <FolderOpen size={13} />, label: '打开节点库', keywords: 'library 节点库 工作流', run: () => fire('ai-canvas-open-node-library') },
    { id: 'a-shortcuts', group: '画布操作', icon: <Keyboard size={13} />, label: '快捷键与操作帮助', keywords: 'shortcut 快捷键 帮助', run: () => fire('ai-canvas-open-shortcuts') },
    { id: 'a-undo', group: '画布操作', icon: <Undo2 size={13} />, label: '撤销', keywords: 'undo 撤销', run: () => { useCanvasStore.getState().undo(); close(); } },
    { id: 'a-redo', group: '画布操作', icon: <Redo2 size={13} />, label: '重做', keywords: 'redo 重做', run: () => { useCanvasStore.getState().redo(); close(); } },
  ], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(c => `${c.label} ${c.group} ${c.keywords}`.toLowerCase().includes(q));
  }, [query, commands]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { if (index >= filtered.length) setIndex(Math.max(0, filtered.length - 1)); }, [filtered, index]);

  if (!open) return null;
  return (
    <div className="cmd-palette-overlay" onMouseDown={close}>
      <div className="cmd-palette" onMouseDown={e => e.stopPropagation()}>
        <div className="cmd-palette-input-row">
          <span className="cmd-palette-kbd">Ctrl K</span>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索命令 / 添加节点…"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && filtered[index]) { filtered[index].run(); }
            }} />
        </div>
        <div className="cmd-palette-list">
          {filtered.length === 0 && <div className="cmd-palette-empty">没有匹配的命令</div>}
          {filtered.map((c, i) => (
            <button key={c.id} className={`cmd-item ${i === index ? 'cmd-item--active' : ''}`}
              onMouseEnter={() => setIndex(i)} onClick={() => c.run()}>
              <span className="cmd-item-icon">{c.icon}</span>
              <span className="cmd-item-label">{c.label}</span>
              <span className="cmd-item-group">{c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
