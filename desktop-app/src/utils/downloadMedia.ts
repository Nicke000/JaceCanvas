export function safeFileName(name: string, fallback = 'ai-canvas-result') {
  return (name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || fallback;
}

function extension(type: string, url: string) {
  const match = url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (match) return match[1].toLowerCase();
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  if (type === 'text') return 'txt';
  return 'png';
}

/** Electron/浏览器通用保存：优先下载 Blob，避免远程 URL 的 download 属性被忽略。 */
export async function downloadMedia(url: string, name: string, type: string): Promise<void> {
  if (!url) throw new Error('没有可保存的文件地址');
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