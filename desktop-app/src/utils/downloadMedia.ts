export function safeFileName(name: string, fallback = 'ai-canvas-result') {
  return (name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || fallback;
}

function extension(type: string, url: string) {
  const match = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (match) return match[1].toLowerCase();
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  if (type === 'text') return 'txt';
  if (type === '3d') return 'glb';
  return 'png';
}

/** Electron/浏览器通用保存：优先下载 Blob，避免远程 URL 的 download 属性被忽略。 */
export async function downloadMedia(url: string, name: string, type: string): Promise<void> {
  if (!url) throw new Error('没有可保存的文件地址');
  // 本地 file:// 文件经主进程读取（渲染进程 fetch file:// 会被 CORS 拦截）
  if (url.startsWith('file://')) {
    const res = await (window as any).electronAPI?.loadMediaB64?.({ url });
    if (!res?.b64) throw new Error('无法读取本地文件');
    const bytes = Uint8Array.from(atob(res.b64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: res.mime || 'application/octet-stream' });
    const objectUrl = URL.createObjectURL(blob);
    // 按 MIME 推断扩展名，避免保存后无后缀/被识别为 json 需要手动改后缀
    const mimeToExt: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'model/gltf-binary': 'glb' };
    const mime = String(res.mime || '');
    const ext = mimeToExt[mime] || (url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1]?.toLowerCase() || '';
    const finalName = /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${safeFileName(name)}${ext ? '.' + ext : ''}`;
    const a = document.createElement('a'); a.href = objectUrl; a.download = finalName;
    a.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`文件下载失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeFileName(name, 'ai-canvas-result') + (name.includes('.') ? '' : `.${extension(type, url)}`);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}