import React, { useEffect, useState } from 'react';
import { imageThumb, videoCover } from '@/utils/mediaThumb';

/**
 * 媒体缩略图/封面显示组件。
 * 图片降采样显示，视频只显示封面图；点击 onPreview 打开原图/原视频预览。
 * 原始 url 始终保留在调用方，用于下游链路（不污染数据）。
 */
export const MediaThumb: React.FC<{
  url: string;
  type: 'image' | 'video' | 'audio' | 'text' | '3d' | string;
  onPreview?: (e?: React.MouseEvent) => void;
  style?: React.CSSProperties;
  className?: string;
}> = ({ url, type, onPreview, style, className }) => {
  const [thumb, setThumb] = useState<string>('');
  useEffect(() => {
    let alive = true;
    if (type === 'image') {
      void imageThumb(url).then(t => { if (alive) setThumb(t); });
    } else if (type === 'video') {
      void videoCover(url).then(t => { if (alive) setThumb(t); });
    }
    return () => { alive = false; };
  }, [url, type]);

  const baseStyle: React.CSSProperties = { objectFit: 'cover', background: '#111' };
  if (type === 'video') {
    return (
      <div style={{ position: 'relative', ...style }} className={className} onClick={onPreview}>
        <img src={thumb || ''} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,.55)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>▶</span>
        </span>
      </div>
    );
  }
  return <img src={thumb || url} alt="" loading="lazy" onClick={onPreview} style={{ ...baseStyle, ...style }} className={className} />;
};
