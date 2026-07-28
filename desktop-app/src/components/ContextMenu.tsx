import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';

export const ContextMenu: React.FC = () => {
  const ctx = useCanvasStore(s => s.contextMenu);
  const hide = useCanvasStore(s => s.hideContextMenu);
  const exec = useCanvasStore(s => s.executeNode);
  const execFrom = useCanvasStore(s => s.executeFromNode);
  const del = useCanvasStore(s => s.deleteSelectedNode);
  const dup = useCanvasStore(s => s.duplicateSelectedNode);
  const tog = useCanvasStore(s => s.toggleNodeDisabled);
  const pause = useCanvasStore(s => s.pauseNode);
  const nodes = useCanvasStore(s => s.nodes);
  if (!ctx.visible) return null;
  const node = nodes.find(n => n.id === ctx.nodeId);
  const resultUrl = node?.data.resultUrl || (node?.data.outputValues?.image as string) || (node?.data.outputValues?.video as string) || (node?.data.outputValues?.audio as string);
  const saveResult = async () => {
    if (!resultUrl) return;
    try {
      const response = await fetch(resultUrl); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob(); const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = objectUrl;
      const rawName=String(node?.data.outputValues?.filename || node?.data.label || 'result').replace(/[\\/:*?"<>|]/g,'_');
      a.download = /\.[a-z0-9]{2,5}$/i.test(rawName)?rawName:rawName+(blob.type.includes('video')?'.mp4':blob.type.includes('audio')?'.mp3':'.png');
      a.click(); setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    } catch { window.open(resultUrl,'_blank'); }
  };
  const items = [
    { l: '\u25B6 \u6267\u884C\u6B64\u8282\u70B9', a: () => ctx.nodeId && exec(ctx.nodeId) },
    { l: '\u26A1 \u4ECE\u6B64\u5F00\u59CB\u6267\u884C', a: () => ctx.nodeId && execFrom(ctx.nodeId) },
    { l: node?.data.status==='running' ? 'Ⅱ 暂停等待并阻断下游' : 'Ⅱ 标记暂停并阻断下游', a: () => ctx.nodeId && pause(ctx.nodeId) },
    ...(resultUrl ? [{ l: '↓ 保存生成结果', a: saveResult }] : []),
    { l: '---', a: null },
    { l: '\uD83D\uDCCB \u590D\u5236', a: () => { useCanvasStore.getState().setSelectedNodeId(ctx.nodeId); dup(); } },
    { l: node?.data.disabled ? '\u2705 \u542F\u7528' : '\uD83D\uDEAB \u7981\u7528', a: () => ctx.nodeId && tog(ctx.nodeId) },
    { l: '---', a: null },
    { l: '\uD83D\uDDD1 \u5220\u9664', a: () => { useCanvasStore.getState().setSelectedNodeId(ctx.nodeId); del(); }, danger: true },
  ];
  return <>
    <div style={{position:'fixed',inset:0,zIndex:999}} onClick={hide}/>
    <div style={{position:'fixed',zIndex:1000,left:ctx.x,top:ctx.y,background:'#1a1a2e',borderRadius:10,
      boxShadow:'0 8px 32px rgba(0,0,0,0.6)',border:'1px solid #2a2a3e',padding:'6px 0',minWidth:180,fontSize:12}}>
      {items.map((it,i) => it.l==='---' ?
        <div key={i} style={{height:1,background:'#2a2a3e',margin:'4px 12px'}}/> :
        <div key={i} onClick={()=>{it.a?.();hide();}}
          style={{padding:'8px 16px',cursor:'pointer',color:it.danger?'#ef4444':'#c0c0d0',
            transition:'background 0.1s'}}
          onMouseEnter={e=>(e.currentTarget.style.background='#2a2a3e')}
          onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>{it.l}</div>
      )}</div></>;
};