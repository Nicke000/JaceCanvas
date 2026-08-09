import React from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { downloadMedia } from '@/utils/downloadMedia';
import { message } from 'antd';

export const ContextMenu: React.FC = () => {
  const ctx = useCanvasStore(s => s.contextMenu);
  const hide = useCanvasStore(s => s.hideContextMenu);
  const exec = useCanvasStore(s => s.enqueueNode);
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
    const type = /(\.mp4|\.mov|\.webm|\.mkv|\.avi)(?:[?#]|$)/i.test(resultUrl) || node?.data.outputValues?.video ? 'video' : /(\.mp3|\.wav|\.m4a|\.aac|\.flac|\.ogg)(?:[?#]|$)/i.test(resultUrl) ? 'audio' : /(\.glb|\.gltf)(?:[?#]|$)/i.test(resultUrl) ? '3d' : 'image';
    const name = String(node?.data.outputValues?.filename || node?.data.label || 'result').replace(/[\\/:*?"<>|]/g, '_');
    try {
      await downloadMedia(resultUrl, name, type);
    } catch (err: any) {
      message.warning('下载失败：' + String(err?.message || err).slice(0, 60));
      window.open(resultUrl, '_blank');
    }
  };
  const canvasItems: Array<{ l: string; a: (() => void) | null; danger?: boolean }> = [
    { l: '➕ 添加节点', a: () => { hide(); window.dispatchEvent(new CustomEvent('ai-canvas-open-search', { detail: { x: ctx.x, y: ctx.y } })); } },
    { l: '📋 粘贴（Ctrl+V）', a: () => { hide(); window.dispatchEvent(new Event('ai-canvas-paste-clipboard')); } },
    { l: '🧹 一键整理画布', a: () => { hide(); window.dispatchEvent(new Event('ai-canvas-auto-layout')); } },
    { l: '✕ 取消全选', a: () => { hide(); useCanvasStore.setState({ nodes: useCanvasStore.getState().nodes.map(n => ({ ...n, selected: false })) }); useCanvasStore.getState().setSelectedNodeId(null); } },
  ];
  const items = [
    { l: '\u25B6 \u52a0\u5165\u672c\u5730\u961f\u5217', a: () => ctx.nodeId && exec(ctx.nodeId) },
    { l: '\u26A1 \u4ECE\u6B64\u5F00\u59CB\u6267\u884C', a: () => ctx.nodeId && execFrom(ctx.nodeId) },
    { l: node?.data.status==='running' ? 'Ⅱ 暂停等待并阻断下游' : 'Ⅱ 标记暂停并阻断下游', a: () => ctx.nodeId && pause(ctx.nodeId) },
    ...(resultUrl ? [{ l: '↓ 保存生成结果', a: saveResult }] : []),
    { l: '---', a: null },
    { l: '\uD83D\uDCCB \u590D\u5236', a: () => { useCanvasStore.getState().setSelectedNodeId(ctx.nodeId); dup(); } },
    { l: node?.data.locked ? '🔓 解锁' : '🔒 锁定', a: () => ctx.nodeId && useCanvasStore.getState().toggleNodeLocked(ctx.nodeId) },
    { l: node?.data.hidden ? '👁 显示' : '🙈 隐藏', a: () => ctx.nodeId && useCanvasStore.getState().toggleNodeHidden(ctx.nodeId) },
    { l: node?.data.disabled ? '\u2705 \u542F\u7528' : '\uD83D\uDEAB \u7981\u7528', a: () => ctx.nodeId && tog(ctx.nodeId) },
    { l: '---', a: null },
    { l: '\uD83D\uDDD1 \u5220\u9664', a: () => { useCanvasStore.getState().setSelectedNodeId(ctx.nodeId); del(); }, danger: true },
  ];
  return <>
    <div style={{position:'fixed',inset:0,zIndex:999}} onClick={hide}/>
    <div className="app-context-menu" style={{left:ctx.x,top:ctx.y}}>
      {(ctx.nodeId ? items : canvasItems).map((it,i) => it.l==='---' ?
        <div key={i} className="app-context-menu__sep"/> :
        <div key={i} className={'app-context-menu__item' + (it.danger?' is-danger':'')} onClick={()=>{it.a?.();hide();}}>{it.l}</div>
      )}</div></>;
};