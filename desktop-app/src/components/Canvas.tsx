import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant, ConnectionLineType, MarkerType, SelectionMode, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Tooltip } from 'antd';
import { CameraOutlined, AppstoreOutlined, BgColorsOutlined, ApartmentOutlined } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { nodeTypes } from '@/components/nodes/nodeTypes';
import { DeletableEdge } from '@/components/edges/DeletableEdge';
import { useSettingsStore } from '@/stores/settingsStore';
import { getModels, testConnection } from '@/services/comfyui.service';
import { comfyWS } from '@/services/comfyui-ws.service';
import type { NodeComponentType } from '@/types';

const edgeTypes={deletable:DeletableEdge};

export const Canvas: React.FC = () => {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const onNodesChange = useCanvasStore(s => s.onNodesChange);
  const onEdgesChange = useCanvasStore(s => s.onEdgesChange);
  const onConnect = useCanvasStore(s => s.onConnect);
  const setSelectedNodeId = useCanvasStore(s => s.setSelectedNodeId);
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

  const onInit = useCallback((inst: ReactFlowInstance) => { rfRef.current = inst; }, []);
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
  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect='move'; }, []);
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
    if (ns.length < 2) { rfRef.current?.fitView({ duration: 300 }); return; }
    const cols = Math.ceil(Math.sqrt(ns.length)), spacing = 350;
    const updated = ns.map((n, i) => ({
      ...n, position: { x: 200 + (i % cols) * spacing, y: 100 + Math.floor(i / cols) * spacing * 0.7 }
    }));
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

  return (
    <div className="canvas-root" style={{width:'100%',height:'100%',background:'#0f0f1a'}} onDoubleClick={e=>{const target=e.target as HTMLElement;if(target.classList.contains('react-flow__pane')||target.classList.contains('canvas-root'))openNodeLibrary()}} onDragOver={onDragOver} onDrop={onDrop}>
      {/* 画布工具按钮 - 右上角 */}
      <div style={{position:'absolute',top:56,right:56,zIndex:20,display:'flex',gap:4}}>
        <Tooltip title={showGrid?'隐藏网格':'显示网格'}>
          <Button type="text" size="small" icon={<BgColorsOutlined style={{opacity:showGrid?1:0.4}}/>}
            onClick={()=>setShowGrid(!showGrid)} style={{background:'#16162add',borderRadius:6,color:'#888'}}/>
        </Tooltip>
        <Tooltip title={showMiniMap?'隐藏缩略图':'显示缩略图'}>
          <Button type="text" size="small" icon={<AppstoreOutlined style={{opacity:showMiniMap?1:0.4}}/>}
            onClick={()=>setShowMiniMap(!showMiniMap)} style={{background:'#16162add',borderRadius:6,color:'#888'}}/>
        </Tooltip>
        <Tooltip title="一键整理画布">
          <Button type="text" size="small" icon={<ApartmentOutlined/>}
            onClick={handleAutoLayout} style={{background:'#16162add',borderRadius:6,color:'#888'}}/>
        </Tooltip>
        <Tooltip title="导出画布截图">
          <Button type="text" size="small" icon={<CameraOutlined/>}
            onClick={handleSnapshot} style={{background:'#16162add',borderRadius:6,color:'#888'}}/>
        </Tooltip>
      </div>

      {empty && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:5}}>
          <div style={{textAlign:'center'}}>
            <div className="empty-orb">✦</div>
            <div style={{fontSize:20,fontWeight:700,color:'#a9a9c4',marginBottom:8}}>开始搭建你的创作工作流</div>
            <div style={{fontSize:13,color:'#62627d'}}>从上方选择节点，点击添加或拖到画布中</div>
          </div>
        </div>
      )}

      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} edgeTypes={edgeTypes}
        onConnect={onConnect} onConnectEnd={onConnectEnd} onInit={onInit} onSelectionChange={onSel} nodeTypes={nodeTypes}
        fitView minZoom={0.02} maxZoom={8} zoomOnDoubleClick={false} deleteKeyCode={null} multiSelectionKeyCode="Shift" selectionKeyCode="Control" selectionOnDrag selectionMode={SelectionMode.Partial}
        snapToGrid snapGrid={[20,20]} connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={{type:'deletable',animated:true,markerEnd:{type:MarkerType.ArrowClosed,width:14,height:14,color:'#7c6df2'},style:{stroke:'#7c6df2',strokeWidth:2.2}}}>
        {showGrid && <Background variant={gridVariant} gap={20} size={1} color="#1a1a30" />}
        <Controls position="bottom-right" showFitView showZoom showInteractive={false} />
        {showMiniMap && <MiniMap position="bottom-left" nodeColor={n=>(n.data?.color as string)??'#6366f1'} maskColor="rgba(0,0,0,0.5)" />}
      </ReactFlow>
    </div>
  );
};