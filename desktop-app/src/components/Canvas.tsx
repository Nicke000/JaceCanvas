import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant, ConnectionLineType, MarkerType, SelectionMode, type ReactFlowInstance, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeTypes } from '@/components/nodes/nodeTypes';
import { DeletableEdge } from '@/components/edges/DeletableEdge';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { getModels, testConnection } from '@/services/comfyui.service';
import { comfyWS } from '@/services/comfyui-ws.service';
import type { NodeComponentType, AppNode } from '@/types';

const edgeTypes={deletable:DeletableEdge};

export const Canvas: React.FC = () => {
  const rfRef = useRef<ReactFlowInstance<AppNode, Edge> | null>(null);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const pushHistory = useCanvasStore(s => s._pushHistory);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const onConnect = useCanvasStore(s => s.onConnect);
  const setSelectedNodeId = useCanvasStore(s => s.setSelectedNodeId);
  const selectedNodeId = useCanvasStore(s => s.selectedNodeId);
  const addNode = useCanvasStore(s => s.addNode);
  const del = useCanvasStore(s => s.deleteSelectedNode);
  const dup = useCanvasStore(s => s.duplicateSelectedNode);
  const undo = useCanvasStore(s => s.undo);
  const redo = useCanvasStore(s => s.redo);
  const openNodeLibrary = useCallback(() => window.dispatchEvent(new CustomEvent('ai-canvas-open-node-library')), []);
  const [showGrid, setShowGrid] = useState(true);
  const [gridVariant, setGridVariant] = useState<BackgroundVariant>(BackgroundVariant.Dots);
  const [showMiniMap, setShowMiniMap] = useState(true);
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
  }, [setSelectedNodeId]);
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);
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
      const c = e.ctrlKey||e.metaKey;
      if (c&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); undo(); }
      else if (c&&e.key==='z'&&e.shiftKey) { e.preventDefault(); redo(); }
      else if (c&&e.key==='d') { e.preventDefault(); dup(); }
      else if ((e.key==='Delete'||e.key==='Backspace')&&!(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)) { del(); }
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

  /* 导出画布截图为PNG - 使用SVG导出 */
  const handleSnapshot = useCallback(() => {
    try {
      const svgEl = document.querySelector('.react-flow__renderer svg');
      if (svgEl) {
        const clone = svgEl.cloneNode(true) as SVGElement;
        const svgData = new XMLSerializer().serializeToString(clone);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'canvas-snapshot.svg';
        a.click();
      }
    } catch { /* ignore */ }
  }, []);

  // 画布工具统一放在应用顶栏，避免被右侧节点控制面板遮住。
  useEffect(() => {
    const toggleGrid = () => setShowGrid(value => !value);
    const toggleMiniMap = () => setShowMiniMap(value => !value);
    const autoLayout = () => handleAutoLayout();
    const snapshot = () => handleSnapshot();
    window.addEventListener('ai-canvas-toggle-grid', toggleGrid);
    window.addEventListener('ai-canvas-toggle-minimap', toggleMiniMap);
    window.addEventListener('ai-canvas-auto-layout', autoLayout);
    window.addEventListener('ai-canvas-snapshot', snapshot);
    return () => {
      window.removeEventListener('ai-canvas-toggle-grid', toggleGrid);
      window.removeEventListener('ai-canvas-toggle-minimap', toggleMiniMap);
      window.removeEventListener('ai-canvas-auto-layout', autoLayout);
      window.removeEventListener('ai-canvas-snapshot', snapshot);
    };
  }, [handleAutoLayout, handleSnapshot]);

  return (
    <div className={`canvas-root ${selectedNodeId ? 'has-inspector' : ''}`} onDoubleClick={e=>{const target=e.target as HTMLElement;if(target.classList.contains('react-flow__pane')||target.classList.contains('canvas-root'))openNodeLibrary()}} onDragOver={onDragOver} onDrop={onDrop}>
      {empty && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:5}}>
          <div style={{textAlign:'center'}}>
            <div className="welcome-brand"><img src="./icon1.png" alt="JaceCanvas" /><strong>JaceCanvas</strong></div>
            <div className="welcome-heading">开始搭建你的创作工作流</div>
            <div className="welcome-sub">展开工作区，拖入或点击节点添加到画布开始创作</div>
          </div>
        </div>
      )}

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} edgeTypes={edgeTypes}
        onConnect={onConnect} onConnectEnd={onConnectEnd} onInit={onInit} onSelectionChange={onSel} onNodeDragStop={pushHistory} onPaneClick={onPaneClick} nodeTypes={nodeTypes}
        fitView minZoom={0.02} maxZoom={8} zoomOnDoubleClick={false} deleteKeyCode={null} multiSelectionKeyCode="Shift" selectionKeyCode="Control" selectionOnDrag={false} selectionMode={SelectionMode.Partial}
        snapToGrid snapGrid={[20,20]} connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{type:'deletable',animated:true,markerEnd:{type:MarkerType.ArrowClosed,width:14,height:14,color:'var(--theme-edge)'},style:{stroke:'var(--theme-edge)',strokeWidth:2.2}}}>
        {showGrid && <Background variant={gridVariant} gap={20} size={1} color="var(--theme-grid)" />}
        <Controls position="top-right" showFitView showZoom showInteractive={false} />
        {showMiniMap && <MiniMap position="bottom-right" nodeColor={n=>(n.data?.color as string)??'#6366f1'} maskColor="rgba(0,0,0,0.5)" />}
      </ReactFlow>
    </div>
  );
};