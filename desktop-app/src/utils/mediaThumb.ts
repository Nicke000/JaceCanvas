import { downsampleImage } from './imageUtils';

/**
 * 媒体缩略图/封面：图片降采样、视频抽帧封面。
 * 双层缓存：内存 Map（会话内）+ localStorage（落盘，重启复用，最多 160 条）。
 * 用于画布/历史/素材库/导演台等列表展示，避免全量加载大图/视频导致卡顿。
 * 下游链路始终使用原始 url（原图原视频），缩略图仅用于显示层。
 */
const imgCache = new Map<string, string>();
const vidCache = new Map<string, string>();

const IMG_KEY = 'jacecanvas-image-thumbs';
const VID_KEY = 'jacecanvas-video-covers';
const MAX_ENTRIES = 160;

let imgDisk: Record<string, string> | null = null;
let vidDisk: Record<string, string> | null = null;

function loadDisk(key: string): Record<string, string> {
  if (key === IMG_KEY) {
    if (imgDisk === null) { try { imgDisk = JSON.parse(localStorage.getItem(IMG_KEY) || '{}'); } catch { imgDisk = {}; } }
    return imgDisk as Record<string, string>;
  }
  if (vidDisk === null) { try { vidDisk = JSON.parse(localStorage.getItem(VID_KEY) || '{}'); } catch { vidDisk = {}; } }
  return vidDisk as Record<string, string>;
}

function persistDisk(key: string, cache: Record<string, string>, url: string, value: string): void {
  try {
    cache[url] = value;
    const entries = Object.entries(cache);
    if (entries.length > MAX_ENTRIES) {
      const trimmed: Record<string, string> = {};
      entries.slice(entries.length - MAX_ENTRIES).forEach(([k, v]) => { trimmed[k] = v; });
      if (key === IMG_KEY) imgDisk = trimmed; else vidDisk = trimmed;
    }
    const target = key === IMG_KEY ? imgDisk : vidDisk;
    localStorage.setItem(key, JSON.stringify(target));
  } catch { /* 超容量则仅内存缓存 */ }
}

/** 图片缩略图：降采样到 max 像素（JPEG），失败回退原图 */
export function imageThumb(url: string, max = 800): Promise<string> {
  const hit = imgCache.get(url);
  if (hit) return Promise.resolve(hit);
  const diskHit = loadDisk(IMG_KEY)[url];
  if (diskHit) { imgCache.set(url, diskHit); return Promise.resolve(diskHit); }
  return downsampleImage(url, max).then(t => {
    imgCache.set(url, t);
    persistDisk(IMG_KEY, loadDisk(IMG_KEY), url, t);
    return t;
  });
}

/** 视频封面：seek 到首帧附近抽帧并压缩为 JPEG，失败回退原 url */
export function videoCover(url: string, maxW = 480): Promise<string> {
  const hit = vidCache.get(url);
  if (hit) return Promise.resolve(hit);
  const diskHit = loadDisk(VID_KEY)[url];
  if (diskHit) { vidCache.set(url, diskHit); return Promise.resolve(diskHit); }
  return new Promise<string>((resolve) => {
    let settled = false;
    const done = (result: string) => { if (settled) return; settled = true; vidCache.set(url, result); if (!result.startsWith('data:')) { /* 失败回退原 url，不落盘 */ } else { persistDisk(VID_KEY, loadDisk(VID_KEY), url, result); } resolve(result); };
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    v.src = url;
    v.onloadedmetadata = () => {
      try { v.currentTime = Math.min(0.1, Math.max(0, (v.duration || 0.2) * 0.1)); } catch { done(url); }
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth || 640, h = v.videoHeight || 360;
        const scale = Math.min(1, maxW / w);
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        if (ctx) { ctx.drawImage(v, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', 0.7)); return; }
      } catch { /* 抽帧失败回退 */ }
      done(url);
    };
    v.onerror = () => done(url);
    setTimeout(() => done(url), 4000); // 超时保护
  });
}
