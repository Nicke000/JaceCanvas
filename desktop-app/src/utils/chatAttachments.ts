import type { ChatAttachment } from '@/services/chat.service';
import { downsampleImage } from '@/utils/imageUtils';

/**
 * 发送前把本地引用（file:// / 超大 dataURL）转成远端可访问的 dataURL：
 * - file:// 由主进程读回（渲染进程 fetch file:// 会被 CORS 拦）
 * - 超大图片降采样，避免撑爆聊天 API
 */
export async function resolveAttachmentUrl(a: ChatAttachment): Promise<ChatAttachment> {
  const src = a.dataUrl || a.url || '';
  if (!src) return a;
  if (src.startsWith('file://')) {
    try {
      const res = await (window as any).electronAPI?.loadMediaB64?.({ url: src });
      if (res?.b64) {
        const mime = res.mime && res.mime !== 'application/octet-stream' ? res.mime : a.mimeType;
        const dataUrl = `data:${mime};base64,${res.b64}`;
        const shrunk = a.mimeType?.startsWith('image/') ? await downsampleImage(dataUrl, 2048) : dataUrl;
        return { ...a, dataUrl: shrunk, url: '' };
      }
    } catch { /* 保留原样，交由服务层兜底 */ }
  }
  if (src.startsWith('data:image/') && src.length > 2_000_000) {
    try {
      const shrunk = await downsampleImage(src, 2048);
      return { ...a, dataUrl: shrunk, url: '' };
    } catch { /* ignore */ }
  }
  // http(s) 图片（内网/签名 URL）云 API 可能访问不到 → 先本地抓取转 dataURL 再发
  if (a.mimeType?.startsWith('image/') && /^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const shrunk = dataUrl.length > 2_000_000 ? await downsampleImage(dataUrl, 2048) : dataUrl;
        return { ...a, dataUrl: shrunk, url: '' };
      }
    } catch { /* 抓取失败则保持原样（可能本来就是公网可访问） */ }
  }
  return a;
}
