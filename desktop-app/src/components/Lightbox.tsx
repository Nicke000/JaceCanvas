import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface LightboxItem { url: string; type: 'image' | 'video' | 'audio' | 'text' | '3d' | string; name?: string; }

/** 双击媒体放大查看：图片支持滚轮缩放 + 拖拽平移，点击空白关闭。
 *  标题/提示/关闭按钮仅在鼠标移动时短暂显示，静止后淡出，保证查看的图片/视频不被 UI 遮挡、始终最顶层。 */
export const Lightbox: React.FC<{ item: LightboxItem | null; onClose: () => void }> = ({ item, onClose }) => {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // 打开/切换对象时重置缩放与 UI 可见性
  useEffect(() => {
    setScale(1); setPos({ x: 0, y: 0 }); setControlsVisible(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
    // 只在切换查看对象时重置缩放，父组件重渲染不重置（用户放大/拖动后保持）
  }, [item?.url]);

  // 鼠标移动时显示控制条，静止 2.2s 后淡出，避免 UI 盖在查看内容上
  const pokeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2200);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault(); e.stopPropagation();
    pokeControls();
    setScale(s => Math.min(10, Math.max(0.2, s * (e.deltaY < 0 ? 1.15 : 0.87))));
  }, [pokeControls]);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }, [pos]);
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => { if (dragRef.current) setPos({ x: dragRef.current.ox + (e.clientX - dragRef.current.sx), y: dragRef.current.oy + (e.clientY - dragRef.current.sy) }); };
    const onUp = () => { dragRef.current = null; setDragging(false); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging]);

  if (!item || !item.url) return null;
  const isImage = item.type === 'image' || /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i.test(item.url.split('?')[0]);
  const controlsStyle: React.CSSProperties = {
    opacity: controlsVisible ? 1 : 0,
    transition: 'opacity .45s ease',
    pointerEvents: controlsVisible ? 'auto' : 'none',
  };
  return createPortal((
    <div onWheel={onWheel} onMouseMove={pokeControls} onClick={() => onCloseRef.current()}
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', userSelect: 'none' }}>
      <div style={{ ...controlsStyle, position: 'absolute', top: 12, left: 14, color: '#e5e7eb', fontSize: 12, opacity: .85, maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.name || '预览'} {isImage && <span style={{ marginLeft: 8, opacity: .6 }}>滚轮缩放 · 拖动平移 · 点击空白关闭</span>}
      </div>
      <div onClick={e => e.stopPropagation()} onMouseDown={onMouseDown} style={{ cursor: isImage ? 'grab' : 'default', transform: isImage ? `translate(${pos.x}px, ${pos.y}px) scale(${scale})` : undefined, transition: dragging ? 'none' : 'transform .12s ease', maxWidth: '92vw', maxHeight: '92vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isImage
          ? <img src={item.url} alt={item.name || ''} style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, boxShadow: '0 10px 60px rgba(0,0,0,.6)', pointerEvents: 'none' }} />
          : item.type === 'video'
            ? <video src={item.url} controls autoPlay style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 8, background: '#000' }} />
            : item.type === 'audio'
              ? <audio src={item.url} controls autoPlay style={{ width: 480, maxWidth: '86vw' }} />
              : <div style={{ color: '#e5e7eb', fontSize: 16 }}>无法预览此类型文件</div>}
      </div>
      <button onClick={() => onCloseRef.current()} style={{ ...controlsStyle, position: 'absolute', top: 10, right: 14, border: 'none', background: 'rgba(255,255,255,.14)', color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 16, cursor: 'pointer' }}>✕</button>
    </div>
  ), document.body);
};
