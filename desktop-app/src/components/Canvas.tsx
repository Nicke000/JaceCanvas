import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant, ConnectionLineType, MarkerType, SelectionMode, type ReactFlowInstance, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeTypes } from '@/components/nodes/nodeTypes';
import { DeletableEdge } from '@/components/edges/DeletableEdge';
import { useSettingsStore } from '@/stores/settingsStore';
import { getShortcuts, matchShortcut } from '@/utils/shortcuts';
import { useThemeStore } from '@/stores/themeStore';
import { Button, Dropdown, Modal, Input, Popover, Tooltip, message } from 'antd';
import { DeleteOutlined, SaveOutlined , EyeOutlined, PushpinOutlined } from '@ant-design/icons';
import { getModels, testConnection } from '@/services/comfyui.service';
import { comfyWS } from '@/services/comfyui-ws.service';
import { CommandPalette } from '@/components/CommandPalette';
import { NodeSearchPanel } from '@/components/NodeSearchPanel';
import { AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Group, Ungroup, StickyNote, Settings2 } from 'lucide-react';
import { optimizePrompt, type PromptAction } from '@/services/promptOptimizer.service';
import type { NodeComponentType, AppNode } from '@/types';

const edgeTypes={deletable:DeletableEdge};

export const Canvas: React.FC = () => {
  const rfRef = useRef<ReactFlowInstance<AppNode, Edge> | null>(null);
  const lastClickPos = useRef<{ x: number; y: number } | null>(null);
  const nodes = useCanvasStore(s => s.nodes);
  const visibleNodes = useMemo(() => nodes.filter(n => !n.data.hidden).map(n => ({ ...n, draggable: n.data.locked ? false : undefined })) as AppNode[], [nodes]);
  const hiddenList = useMemo(() => nodes.filter(n => n.data.hidden), [nodes]);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  // ===== 批量语义操作 =====
  const [batchModal, setBatchModal] = useState<'replace' | null>(null);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [batchAiBusy, setBatchAiBusy] = useState(false);
  const selectedNodes = nodes.filter(n => n.selected);
  const applyBatchReplace = () => {
    if (!findText) { message.warning('请输入要查找的文字'); return; }
    const store = useCanvasStore.getState();
    let hit = 0;
    selectedNodes.forEach(n => {
      const cfg: Record<string, unknown> = { ...n.data.config };
      let changed = false;
      (['text', 'prompt', 'content', 'settings'] as const).forEach(k => { const v = cfg[k]; if (typeof v === 'string' && v.includes(findText)) { cfg[k] = v.split(findText).join(replaceText); changed = true; } });
      if (Array.isArray(cfg.scripts)) cfg.scripts = cfg.scripts.map((x: any) => ({ ...x, text: typeof x.text === 'string' && x.text.includes(findText) ? x.text.split(findText).join(replaceText) : x.text }));
      if (changed) { store.setNodeConfig(n.id, cfg); hit++; }
    });
    message.success(hit ? `已批量替换 ${hit} 个节点` : '选中节点中没有匹配的文字');
    setBatchModal(null);
  };
  const applyBatchColor = (color: string) => {
    const store = useCanvasStore.getState();
    selectedNodes.forEach(n => store.updateNodeData(n.id, { color }));
    message.success(`已为 ${selectedNodes.length} 个节点设置颜色`);
  };
  const applyBatchAi = async (action: PromptAction) => {
    const targets = selectedNodes.filter(n => n.data.nodeType === 'textInput' || n.data.nodeType === 'scriptInput');
    if (!targets.length) { message.warning('请先选中文本类节点（文本输入/剧本输入）'); return; }
    setBatchAiBusy(true);
    try {
      let done = 0;
      for (const n of targets) {
        const text = String(n.data.config?.text || '');
        if (!text.trim()) continue;
        const result = await optimizePrompt({ text, action, kind: 'generic' });
        const store = useCanvasStore.getState();
        store.setNodeConfig(n.id, { text: result });
        store.propagateData(n.id, 'text', result);
        done++;
      }
      message.success(`批量 AI ${action} 完成 · ${done} 个节点`);
    } catch (e: any) { message.error(String(e?.message || e)); }
    finally { setBatchAiBusy(false); }
  };
  const edges = useCanvasStore(s => s.edges);
  const visibleEdges = useMemo(() => {
    const idSet = new Set(nodes.filter(n => !n.data.hidden).map(n => n.id));
    return edges.filter(e => idSet.has(e.source) && idSet.has(e.target));
  }, [edges, nodes]);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const pushHistory = useCanvasStore(s => s._pushHistory);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const onConnect = useCanvasStore(s => s.onConnect);
  const setSelectedNodeId = useCanvasStore(s => s.setSelectedNodeId);
  const selectedNodeId = useCanvasStore(s => s.selectedNodeId);
  const addNode = useCanvasStore(s => s.addNode);
  const del = useCanvasStore(s => s.deleteSelectedNode);
  const dup = useCanvasStore(s => s.duplicateSelectedNode);
  const align = useCanvasStore(s => s.alignSelectedNodes);
  const addNoteForSelection = () => {
    const store = useCanvasStore.getState();
    const selected = store.nodes.filter(n => n.selected);
    if (!selected.length) return;
    const xs = selected.map(n => n.position.x);
    const ys = selected.map(n => n.position.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    store.addNode('note', { x: cx, y: cy - 46 }, { label: '备注' });
  };
  const groupSelected = useCanvasStore(s => s.groupSelectedNodes);
  const ungroupSelected = useCanvasStore(s => s.ungroupSelected);
  const undo = useCanvasStore(s => s.undo);
  const redo = useCanvasStore(s => s.redo);
  const openNodeLibrary = useCallback(() => window.dispatchEvent(new CustomEvent('ai-canvas-open-node-library')), []);
  const [showGrid, setShowGrid] = useState(true);
  const [gridVariant, setGridVariant] = useState<BackgroundVariant>(BackgroundVariant.Dots);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [bookmarks, setBookmarks] = useState<Array<{ id: string; name: string; x: number; y: number; zoom: number }>>(() => { try { return JSON.parse(localStorage.getItem('jacecanvas-view-bookmarks') || '[]'); } catch { return []; } });
  const persistBookmarks = (next: typeof bookmarks) => { setBookmarks(next); localStorage.setItem('jacecanvas-view-bookmarks', JSON.stringify(next)); };
  const saveBookmark = () => {
    const vp = rfRef.current?.getViewport(); if (!vp) return;
    const name = `视口 ${bookmarks.length + 1}`;
    persistBookmarks([...bookmarks, { id: Date.now().toString(), name, x: vp.x, y: vp.y, zoom: vp.zoom }]);
    message.success('已保存书签：' + name);
  };
  const gotoBookmark = (b: { x: number; y: number; zoom: number }) => rfRef.current?.setViewport({ x: b.x, y: b.y, zoom: b.zoom }, { duration: 250 });
  const removeBookmark = (id: string) => persistBookmarks(bookmarks.filter(b => b.id !== id));
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedHasFrame, setSelectedHasFrame] = useState(false);
  const [searchAnchor, setSearchAnchor] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null);
  const [gpuInfo, setGpuInfo] = useState<{name:string;mem:string;usage:string}|null>(null);
  const baseUrl = useSettingsStore(s => s.baseUrl);
  const gridStyle = useThemeStore(s => s.preferences.gridStyle);

  // 4.6.8：外观偏好中的「画布网格」实时切换 React Flow 网格样式。
  useEffect(() => {
    setGridVariant(gridStyle === 'lines' ? BackgroundVariant.Lines : gridStyle === 'cross' ? BackgroundVariant.Cross : BackgroundVariant.Dots);
  }, [gridStyle]);

  useEffect(() => {
    const check = async () => {
      const result = await testConnection();
    };
    const fetchGpu = async () => {
      try {
        const models = await getModels();
        setGpuInfo(models[0] ? {name:models[0],mem:'',usage:''} : null);
      } catch { setGpuInfo(null); }
    };
    check(); fetchGpu();
    const t=setInterval(check,30000); const g=setInterval(fetchGpu,10000);
    return () => { clearInterval(t); clearInterval(g); };
  }, [baseUrl]);

  useEffect(()=>{
    comfyWS.connect();
    const store=useCanvasStore;
    const nodeFor=(promptId?:string)=>promptId?store.getState().nodes.find(n=>n.data.promptId===promptId):undefined;
    const unProgress=comfyWS.onProgress(({value,max,node:comfyNodeId,promptId})=>{
      const node=nodeFor(promptId); if(!node||!max)return;
      const pct=Math.max(0,Math.min(100,Math.round((value/max)*100)));
      store.getState().updateNodeData(node.id,{currentNodeProgress:pct,currentNodeId:String(comfyNodeId || ''),content:`生成中 · ComfyUI 节点 ${comfyNodeId || '当前'} · ${value}/${max}`});
    });
    const unExec=comfyWS.onExecuting(({node,prompt_id})=>{
      const target=nodeFor(prompt_id); if(!target)return;
      if(node)store.getState().updateNodeData(target.id,{content:`执行节点 ${node}`});
    });
    const unDone=comfyWS.onPromptDone(({prompt_id})=>{
      const target=nodeFor(prompt_id); if(!target)return;
      store.getState().updateNodeData(target.id,{progress:100});
    });
    return ()=>{unProgress();unExec();unDone();};
  },[baseUrl]);

  const onInit = useCallback((inst: ReactFlowInstance<AppNode, Edge>) => { rfRef.current = inst; }, []);
  useEffect(()=>{
    (window as any).__focusCanvasNode=(id:string)=>{
      const node=useCanvasStore.getState().nodes.find(item=>item.id===id);
      if(!node||!rfRef.current)return false;
      rfRef.current.fitView({nodes:[node],duration:450,padding:0.35});
      setSelectedNodeId(id);
      return true;
    };
    return()=>{delete (window as any).__focusCanvasNode};
  },[setSelectedNodeId]);
  const canvasCenter=useCallback(()=>{
    if(!rfRef.current)return {x:400,y:240};
    const bounds=document.querySelector('.canvas-root')?.getBoundingClientRect();
    const point=rfRef.current.screenToFlowPosition({x:(bounds?.left||0)+(bounds?.width||window.innerWidth)/2,y:(bounds?.top||0)+(bounds?.height||window.innerHeight)/2});
    return {x:point.x-120,y:point.y-80};
  },[]);
  useEffect(()=>{(window as any).__canvasCenter=canvasCenter;return()=>{delete (window as any).__canvasCenter}},[canvasCenter]);
  const onSel = useCallback(({nodes:sel}:{nodes:{id:string}[]}) => {
    setSelectedNodeId(sel.length === 1 && sel[0].id ? sel[0].id : null);
    setSelectedCount(sel.length);
    const store = useCanvasStore.getState();
    setSelectedHasFrame(sel.some(s => store.nodes.find(n => n.id === s.id)?.type === 'frame'));
  }, [setSelectedNodeId]);
  const onPaneClick = useCallback((e?: React.MouseEvent) => {
    setSelectedNodeId(null);
    setSearchAnchor(null);
    if (e) {
      const flow = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      if (flow) lastClickPos.current = flow;
    }
  }, [setSelectedNodeId]);
  const onPaneCtx = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const flow = rfRef.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    if (flow) lastClickPos.current = flow;
    useCanvasStore.getState().showContextMenu(e.clientX, e.clientY, null);
  }, []);
  useEffect(()=>{const close=(event:PointerEvent)=>{if((event.target as HTMLElement).closest('.canvas-text-editor'))return;window.dispatchEvent(new Event('ai-canvas-close-text-editor'))};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close)},[]);
  const onConnectEnd=useCallback((event:MouseEvent|TouchEvent,state:any)=>{
    if(state?.toNode||!state?.fromNode||state?.fromHandle?.type==='target')return;
    const sourceId=state.fromNode.id as string;const source=useCanvasStore.getState().nodes.find(node=>node.id===sourceId);
    if(!source?.data.resultUrl&&!source?.data.results?.length)return;
    if(!window.confirm('该节点已有生成结果，是否在这里创建并连接新的预览节点？'))return;
    const point='changedTouches' in event?event.changedTouches[0]:event;
    if(!point||!rfRef.current)return;
    const position=rfRef.current.screenToFlowPosition({x:point.clientX,y:point.clientY});
    const previewId=addNode('preview',{x:position.x-120,y:position.y-90},{label:'结果预览'});
    onConnect({source:sourceId,sourceHandle:state.fromHandle?.id||'output',target:previewId,targetHandle:'media'});
    const results=source.data.results||[];const current=results[0];
    useCanvasStore.getState().updateNodeData(previewId,{inputValues:{media:current?.url||source.data.resultUrl,results},results});
  },[addNode,onConnect]);
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 0) 本地文件拖入：为每个文件创建"上传文件"节点并自动读取
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length && rfRef.current) {
      const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      droppedFiles.forEach((file, index) => {
        const id = addNode('uploadNode', { x: pos.x - 100 + index * 28, y: pos.y - 30 + index * 28 }, { label: file.name });
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('ai-canvas-files-dropped', { detail: { files: [file], nodeId: id } }));
        }, 300);
      });
      return;
    }
    const remoteRaw = e.dataTransfer.getData('application/remote-workflow');
    if (remoteRaw && rfRef.current) {
      try { const workflow=JSON.parse(remoteRaw); const pos=rfRef.current.screenToFlowPosition({x:e.clientX,y:e.clientY}); (window as any).__addRemoteWorkflow?.(workflow,{x:pos.x-130,y:pos.y-40}); } catch {}
      return;
    }
    // 1) 工具栏节点拖拽
    const t = e.dataTransfer.getData('application/reactflow') as NodeComponentType;
    if (t && rfRef.current) {
      const pos = rfRef.current.screenToFlowPosition({x:e.clientX,y:e.clientY});
      addNode(t,{x:pos.x-100,y:pos.y-30});
      return;
    }
    // 2) 资产库拖入：创建可连接的素材节点
    const assetRaw = e.dataTransfer.getData('application/ai-asset');
    const assetUrl = e.dataTransfer.getData('asset-url');
    if (assetUrl && rfRef.current) {
      const pos = rfRef.current.screenToFlowPosition({x:e.clientX,y:e.clientY});
      let asset:{name?:string;type?:string;url?:string}={url:assetUrl}; try{if(assetRaw)asset=JSON.parse(assetRaw)}catch{}
      const nt: NodeComponentType = 'asset';
      addNode(nt, {x:pos.x-100,y:pos.y-30}, {
        label: asset.name || `${asset.type||'素材'}加载`,
        config: { assetUrl, assetType:asset.type, assetName:asset.name },
        resultUrl: asset.type==='text'?undefined:assetUrl,
        results: [{type:(asset.type||'image') as any,url:assetUrl}],
        outputValues: { [asset.type||'image']: assetUrl, url: assetUrl, filename:asset.name },
      } as any);
    }
  }, [addNode]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const editing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
      const s = getShortcuts();
      if (editing) return; // 输入框内完全交给浏览器默认（Ctrl+C/V/Z 正常复制粘贴撤销），画布快捷键仅在非编辑态生效
      if ((window as any).__aiCanvasOverlayOpen) return; // 短剧工作室/聊天/DevAgent 覆盖层打开时禁用画布快捷键，防误删底层节点
      if (matchShortcut(e, s.copy)) { e.preventDefault(); useCanvasStore.getState().copySelectedNodes(); return; }
      if (matchShortcut(e, s.paste)) { e.preventDefault(); useCanvasStore.getState().pasteNodesAt(lastClickPos.current?.x||300, lastClickPos.current?.y||200); return; }
      if (matchShortcut(e, s.undo)) { e.preventDefault(); undo(); }
      else if (matchShortcut(e, s.redo)) { e.preventDefault(); redo(); }
      else if (matchShortcut(e, s.duplicate)) { e.preventDefault(); dup(); }
      else if (matchShortcut(e, s.group)) { e.preventDefault(); groupSelected(); }
      else if (matchShortcut(e, s.ungroup)) { e.preventDefault(); ungroupSelected(); }
      else if (matchShortcut(e, s.delete)) { e.preventDefault(); del(); }
    };
    window.addEventListener('keydown',h); return () => window.removeEventListener('keydown',h);
  }, [undo,redo,dup,del]);

  /* 一键整理画布 */
  const handleAutoLayout = useCallback(() => {
    const ns = useCanvasStore.getState().nodes;
    const es = useCanvasStore.getState().edges;
    if (ns.length < 2) { rfRef.current?.fitView({ duration: 300 }); return; }
    const incoming = new Map(ns.map(n => [n.id, 0]));
    const children = new Map(ns.map(n => [n.id, [] as string[]]));
    es.forEach(edge => {
      if (incoming.has(edge.target) && children.has(edge.source)) {
        incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
        children.get(edge.source)?.push(edge.target);
      }
    });
    const layers = new Map<string, number>();
    const queue = ns.filter(n => (incoming.get(n.id) || 0) === 0).map(n => n.id);
    if (!queue.length) ns.forEach(n => queue.push(n.id));
    while (queue.length) {
      const id = queue.shift()!;
      const layer = layers.get(id) || 0;
      (children.get(id) || []).forEach(child => {
        layers.set(child, Math.max(layers.get(child) || 0, layer + 1));
        queue.push(child);
      });
    }
    ns.forEach((node, index) => { if (!layers.has(node.id)) layers.set(node.id, index); });
    const groups = new Map<number, typeof ns>();
    ns.forEach(node => { const layer = layers.get(node.id) || 0; if (!groups.has(layer)) groups.set(layer, []); groups.get(layer)!.push(node); });
    const xGap = 390; const yGap = 230;
    const updated = ns.map(n => {
      const layer = layers.get(n.id) || 0; const group = groups.get(layer) || []; const index = group.findIndex(item => item.id === n.id);
      return { ...n, position: { x: 120 + layer * xGap, y: 100 + index * yGap } };
    });
    useCanvasStore.setState({ nodes: updated as any });
    setTimeout(() => rfRef.current?.fitView({ duration: 400 }), 80);
  }, []);

  const empty = nodes.length === 0;

  /* 导出画布截图：PNG（默认 2x 高清，SVG 矢量备用） */
  const handleSnapshot = useCallback((format: 'png' | 'svg' = 'png', scale = 2) => {
    try {
      const svgEl = document.querySelector('.react-flow__renderer svg');
      if (!svgEl) return;
      const clone = svgEl.cloneNode(true) as SVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const svgData = new XMLSerializer().serializeToString(clone);
      if (format === 'svg') {
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'canvas-snapshot.svg';
        a.click();
        return;
      }
      const url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml' }));
      const img = new Image();
      img.onload = () => {
        const vb = (svgEl.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const w = Math.max(1, (vb[2] || 800) * scale);
        const h = Math.max(1, (vb[3] || 600) * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = 'var(--theme-input)';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const a = document.createElement('a');
          a.href = canvas.toDataURL('image/png');
          a.download = `canvas-snapshot-${w}x${h}.png`;
          a.click();
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } catch { /* ignore */ }
  }, []);

  // 画布工具统一放在应用顶栏，避免被右侧节点控制面板遮住。
  useEffect(() => {
    const toggleGrid = () => setShowGrid(value => !value);
    const toggleMiniMap = () => setShowMiniMap(value => !value);
    const autoLayout = () => handleAutoLayout();
    const snapshot = () => handleSnapshot('png', 2);
    const snapshotSvg = () => handleSnapshot('svg', 1);
    const pasteAtClick = () => { const p = lastClickPos.current; useCanvasStore.getState().pasteNodesAt(p?.x || 300, p?.y || 200); };
    window.addEventListener('ai-canvas-paste-clipboard', pasteAtClick);
    window.addEventListener('ai-canvas-toggle-grid', toggleGrid);
    window.addEventListener('ai-canvas-toggle-minimap', toggleMiniMap);
    window.addEventListener('ai-canvas-auto-layout', autoLayout);
    window.addEventListener('ai-canvas-snapshot', snapshot);
    window.addEventListener('ai-canvas-snapshot-svg', snapshotSvg);
    return () => {
      window.removeEventListener('ai-canvas-paste-clipboard', pasteAtClick);
      window.removeEventListener('ai-canvas-toggle-grid', toggleGrid);
      window.removeEventListener('ai-canvas-toggle-minimap', toggleMiniMap);
      window.removeEventListener('ai-canvas-auto-layout', autoLayout);
      window.removeEventListener('ai-canvas-snapshot', snapshot);
      window.removeEventListener('ai-canvas-snapshot-svg', snapshotSvg);
    };
  }, [handleAutoLayout, handleSnapshot]);

  return (
    <div className={`canvas-root ${selectedNodeId ? 'has-inspector' : ''}`} onDoubleClick={e=>{const target=e.target as HTMLElement;if((target.classList.contains('react-flow__pane')||target.classList.contains('canvas-root'))&&rfRef.current){const flow=rfRef.current.screenToFlowPosition({x:e.clientX,y:e.clientY});setSearchAnchor({x:e.clientX,y:e.clientY,flow});}}} onDragOver={onDragOver} onDrop={onDrop}>
{selectedCount >= 1 && (
        <div className="canvas-align-bar">
          {selectedCount >= 2 && <button title="左对齐" onClick={() => align('left')}><AlignStartHorizontal size={14} /></button>}
          {selectedCount >= 2 && <button title="水平居中" onClick={() => align('centerX')}><AlignCenterHorizontal size={14} /></button>}
          {selectedCount >= 2 && <button title="右对齐" onClick={() => align('right')}><AlignEndHorizontal size={14} /></button>}
          {selectedCount >= 2 && <span className="canvas-align-sep" />}
          {selectedCount >= 2 && <button title="顶对齐" onClick={() => align('top')}><AlignStartVertical size={14} /></button>}
          {selectedCount >= 2 && <button title="垂直居中" onClick={() => align('centerY')}><AlignCenterVertical size={14} /></button>}
          {selectedCount >= 2 && <button title="底对齐" onClick={() => align('bottom')}><AlignEndVertical size={14} /></button>}
          {selectedCount >= 2 && <span className="canvas-align-sep" />}
          <button title={selectedCount >= 2 ? "成组 (Ctrl+G)" : "至少选中 2 个节点才能成组"} onClick={selectedCount >= 2 ? groupSelected : undefined} disabled={selectedCount < 2} className={selectedCount < 2 ? 'canvas-align-btn-disabled' : ''}><Group size={14} /></button>
          {selectedHasFrame && <button title="解散分组 (Ctrl+Shift+G)" onClick={ungroupSelected}><Ungroup size={14} /></button>}
          <span className="canvas-align-sep" />
          <button title="给选中区域添加备注" onClick={addNoteForSelection}><StickyNote size={14} /></button>
          <span className="canvas-align-sep" />
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'replace', label: '批量替换文字…', onClick: () => { setFindText(''); setReplaceText(''); setBatchModal('replace'); } },
            { key: 'color', label: '批量改颜色', children: ['#6366f1', '#22d3ee', '#f472b6', '#34d399', 'var(--theme-warning)', 'var(--theme-error)', '#a78bfa', 'var(--theme-text)'].map(c => ({ key: 'c-' + c, label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: '50%', background: c, display: 'inline-block' }} />{c}</span>, onClick: () => applyBatchColor(c) })) },
            { key: 'ai', label: batchAiBusy ? '批量 AI 处理中…' : '批量 AI 生成', disabled: batchAiBusy, children: [
              { key: 'continue', label: '续写', onClick: () => void applyBatchAi('continue') },
              { key: 'expand', label: '扩写', onClick: () => void applyBatchAi('expand') },
              { key: 'summarize', label: '总结', onClick: () => void applyBatchAi('summarize') },
              { key: 'optimize', label: '优化', onClick: () => void applyBatchAi('optimize') },
            ] },
          ] }}>
            <button className="canvas-align-btn" title="批量操作（替换文字 / 改颜色 / AI 生成）" style={{ opacity: batchAiBusy ? 0.5 : 1 }}><Settings2 size={14} /></button>
          </Dropdown>
          {selectedCount === 1 && <span className="canvas-align-hint">再选中一个节点即可对齐/成组（按住 Ctrl 拖拽或 Shift 点击可加选）</span>}
        </div>
      )}

      {empty && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:5}}>
          <div style={{textAlign:'center'}}>
            <div className="welcome-brand"><img src="./icon1.png" alt="JaceCanvas" /><strong>JaceCanvas</strong></div>
            <div className="welcome-heading">开始搭建你的创作工作流</div>
            <div className="welcome-sub">展开工作区，拖入或点击节点添加到画布开始创作</div>
            <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 620, pointerEvents: 'auto' }}>
              {[
                ['① 添加节点', '双击空白处搜索节点，或从左侧工具栏拖入：文本/上传/生成/预览…'],
                ['② 生成内容', '付费节点填提示词即可生成（需先配置 API）；服务器节点连上 ComfyUI 即可用'],
                ['③ 连线编排', '拖动节点端口连线，下游自动继承上游内容，形成流水线'],
                ['④ 一键跑通', '顶部「短剧工作室」→ 填入示例剧本 → 一键生成 → 导出拍摄表'],
              ].map(([t, d], i) => (
                <div key={i} style={{ flex: '1 1 250px', textAlign: 'left', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--theme-text)', marginBottom: 4 }}>{t}</div>
                  <div style={{ fontSize: 10, color: 'var(--theme-muted)', lineHeight: 1.6 }}>{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Modal title="批量替换文字" open={batchModal === 'replace'} onCancel={() => setBatchModal(null)} onOk={applyBatchReplace} okText="替换" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input placeholder="查找…" value={findText} onChange={e => setFindText(e.target.value)} />
          <Input placeholder="替换为…（留空即删除）" value={replaceText} onChange={e => setReplaceText(e.target.value)} />
        </div>
      </Modal>
      {hiddenList.length > 0 && (
        <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 30 }}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setHiddenOpen(o => !o)}>隐藏节点（{hiddenList.length}）</Button>
          {hiddenOpen && (
            <div style={{ position: 'absolute', right: 0, top: 32, width: 230, maxHeight: 320, overflow: 'auto', background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 8, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)', zIndex: 31 }}>
              {hiddenList.map(n => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 11 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--theme-muted)' }}>{n.data.label || '未命名节点'}</span>
                  <Button size="small" type="text" onClick={() => useCanvasStore.getState().toggleNodeHidden(n.id)}>显示</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ReactFlow nodes={visibleNodes} edges={visibleEdges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} edgeTypes={edgeTypes}
        onConnect={onConnect} onConnectEnd={onConnectEnd} onInit={onInit} onSelectionChange={onSel} onNodeDragStop={pushHistory} onPaneClick={onPaneClick} onPaneContextMenu={onPaneCtx} nodeTypes={nodeTypes}
        fitView fitViewOptions={{ maxZoom: 1 }} minZoom={0.02} maxZoom={8} zoomOnDoubleClick={false} deleteKeyCode={null} selectionKeyCode="Control" multiSelectionKeyCode="Shift" selectionMode={SelectionMode.Partial}
        connectionLineType={ConnectionLineType.Bezier} onlyRenderVisibleElements
        defaultEdgeOptions={{type:'deletable',animated:true,markerEnd:{type:MarkerType.ArrowClosed,width:14,height:14,color:'var(--theme-edge)'},style:{stroke:'var(--theme-edge)',strokeWidth:2.2}}}>
        {showGrid && <Background variant={gridVariant} gap={20} size={1} color="var(--theme-grid)" />}
        <Controls position="top-right" showFitView showZoom showInteractive={false} />
        {showMiniMap && <MiniMap position="bottom-right" nodeColor={n=>(n.data?.color as string)??'#6366f1'} maskColor="rgba(0,0,0,0.5)" />}
        <Popover trigger="click" placement="topRight" content={<div style={{ width: 230 }}>
          <Button size="small" block icon={<SaveOutlined />} onClick={saveBookmark}>保存当前视口</Button>
          <div style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
            {bookmarks.length === 0 && <div style={{ color: 'var(--theme-muted)', fontSize: 11, textAlign: 'center', padding: 8 }}>暂无书签（保存视口后可一键跳转）</div>}
            {bookmarks.map(b => <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <Button size="small" style={{ flex: 1, textAlign: 'left', fontSize: 11 }} icon={<PushpinOutlined />} onClick={() => gotoBookmark(b)}>{b.name}</Button>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeBookmark(b.id)} />
            </div>)}
          </div>
        </div>}>
          <Tooltip title="画布书签 / 多区域跳转"><Button size="small" icon={<PushpinOutlined />} style={{ position: 'absolute', right: 12, bottom: 300, zIndex: 5 }} /></Tooltip>
        </Popover>
      </ReactFlow>
      <CommandPalette />
      <NodeSearchPanel anchor={searchAnchor} onClose={() => setSearchAnchor(null)} />
    </div>
  );
};