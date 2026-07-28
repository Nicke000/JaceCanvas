import React, { useEffect, useRef, useState } from 'react';

const STARTUP_VIDEO = './启动动画设置.mp4';
const FADE_AT_MS = 7000;
const FALLBACK_END_MS = 10500;

/**
 * 启动视频覆盖层。它和主界面同时渲染，保证视频播放期间主界面可以完成初始化。
 */
export const StartupAnimation: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setFading(true), FADE_AT_MS);
    const endTimer = window.setTimeout(() => setVisible(false), FALLBACK_END_MS);
    const video = videoRef.current;
    void video?.play().catch(() => setVisible(false));
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(endTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`startup-animation${fading ? ' startup-animation--fading' : ''}`} aria-label="JaceCanvas 正在启动">
      <video
        ref={videoRef}
        className="startup-animation__video"
        src={STARTUP_VIDEO}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={() => setVisible(false)}
        onError={() => setVisible(false)}
      />
    </div>
  );
};
