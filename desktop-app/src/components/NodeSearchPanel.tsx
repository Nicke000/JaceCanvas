import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { NodeIcon } from '@/config/nodeIcons';
import { Search } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { fetchWorkflows, type ServerWorkflow } from '@/services/comfyui.service';
import type { NodeComponentType } from '@/types';

interface Anchor { x: number; y: number; flow: { x: number; y: number }; }
interface Props { anchor: Anchor | null; onClose: () => void; }

const LOCAL_NODES: { type: NodeComponentType; label: string; keywords: string; needs?: 'paid' | 'server' }[] = [
  { type: 'textInput', label: '文本输入', keywords: 'text' },
  { type: 'note', label: '备注', keywords: 'note 注释 便利贴' },
  { type: 'reroute', label: '转接点', keywords: 'reroute 连线 转接' },
  { type: 'scriptInput', label: '剧本输入', keywords: 'script' },
  { type: 'sceneSettings', label: '场景设定', keywords: 'scene' },
  { type: 'preview', label: '结果预览', keywords: 'preview' },
  { type: 'uploadNode', label: '上传文件', keywords: 'upload' },
  { type: 'compare', label: '前后对比', keywords: 'compare' },
  { type: 'videoTrim', label: '视频剪辑', keywords: 'trim 剪辑' },
  { type: 'imageCrop', label: '修图裁切', keywords: 'crop 裁切' },
  // 以下节点需要配置后才可用，未配置时不显示
  { type: 'imageGeneration', label: '文生图', keywords: 'image gen', needs: 'server' },
  { type: 'imageToImage', label: '图生图', keywords: 'img2img', needs: 'server' },
  { type: 'videoGeneration', label: '视频生成', keywords: 'video', needs: 'server' },
  { type: 'paidTextToImage', label: '付费API·文生图', keywords: 'paid 付费', needs: 'paid' },
  { type: 'paidImageToImage', label: '付费API·图生图', keywords: 'paid 付费', needs: 'paid' },
  { type: 'paidTextToVideo', label: '付费API·文生视频', keywords: 'paid 付费', needs: 'paid' },
  { type: 'paidImageToVideo', label: '付费API·图生视频', keywords: 'paid 付费', needs: 'paid' },
];

/** 双击空白处弹出的节点快速搜索面板（ComfyUI 同款交互）。
 *  未配置（付费 API 无 Key / 服务器未连接）的节点不显示，避免添加后无法使用的空壳节点。 */
export const NodeSearchPanel: React.FC<Props> = ({ anchor, onClose }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [serverNodes, setServerNodes] = useState<ServerWorkflow[]>([]);
  const [serverLoaded, setServerLoaded] = useState(false);
  const [serverReachable, setServerReachable] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const paidConfigured = useSettingsStore(s => Object.values(s.paidApiProviders).some(p => p && p.apiKey));
  const serverConfigured = useSettingsStore(s => !!s.baseUrl || (s.servers?.length ?? 0) > 0);
  const activeServerId = useSettingsStore(s => s.activeServerId);

  useEffect(() => {
    if (!anchor) return;
    setQuery('');
    setIndex(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    setServerLoaded(false);
    setServerReachable(null);
    fetchWorkflows()
      .then(ws => { setServerNodes(ws); setServerReachable(true); setServerLoaded(true); })
      .catch(() => { setServerNodes([]); setServerReachable(false); setServerLoaded(true); });
  }, [anchor]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // 点击面板外部关闭
  useEffect(() => {
    if (!anchor) return;
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest('.node-search')) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', h); };
  }, [anchor, onClose]);

  // 注意：所有 hooks 必须位于 early return 之前，否则 React 会因 hook 数量
  // 变化而崩溃（React error #310）。
  const flowPos = anchor?.flow ?? { x: 0, y: 0 };
  const results = useMemo(() => {
    if (!anchor) return [];
    const q = query.trim().toLowerCase();
    // 双击快速面板只显示基础节点（服务器/付费节点统一从节点库与工作流入口添加）
    const visibleLocal = LOCAL_NODES.filter(n => !n.needs);
    const local = visibleLocal
      .filter(n => !q || `${n.label} ${n.keywords}`.toLowerCase().includes(q))
      .map(n => ({ key: `l-${n.type}`, icon: <NodeIcon type={n.type} size={13} />, label: n.label, group: '基础节点', run: () => {
        useCanvasStore.getState().addNode(n.type, { x: flowPos.x - 60, y: flowPos.y - 20 }, { ...(n.type === 'note' ? { label: '备注' } as any : {}), serverId: activeServerId || undefined });
        onClose();
      } }));
    const server: never[] = [];
    return [...local, ...server];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, serverLoaded, serverReachable, serverNodes, anchor, paidConfigured, serverConfigured]);

  useEffect(() => { if (results.length && index >= results.length) setIndex(Math.max(0, results.length - 1)); }, [results, index]);

  if (!anchor) return null;

  const panelW = 340;
  const panelH = Math.min(380, results.length * 34 + 64);
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - panelW - 8));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - panelH - 8));
  const hiddenCount = LOCAL_NODES.filter(n => (n.needs === 'paid' && !paidConfigured) || (n.needs === 'server' && !serverConfigured)).length + (serverConfigured && !serverReachable ? 1 : 0);

  return (
    <div className="node-search" style={{ left, top, width: panelW }}>
      <div className="node-search-input-row">
        <span className="node-search-icon"><Search size={13} /></span>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索节点…（回车添加）"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && results[index]) { results[index].run(); }
          }} />
      </div>
      <div className="node-search-list">
        {results.length === 0 && <div className="node-search-empty">没有匹配的节点</div>}
        {results.map((r, i) => (
          <button key={r.key} className={`node-search-item ${i === index ? 'node-search-item--active' : ''}`}
            onMouseEnter={() => setIndex(i)} onClick={() => r.run()}>
            <span className="node-search-item-icon">{r.icon}</span>
            <span className="node-search-item-label">{r.label}</span>
            <span className="node-search-item-group">{r.group}</span>
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <div className="node-search-hint">
          已隐藏 {hiddenCount} 个未配置节点{serverConfigured && serverReachable === false ? '（服务器未连接）' : ''}，在设置中配置后显示
        </div>
      )}
    </div>
  );
};
