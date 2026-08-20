import { APP_VERSION, UPDATE_DOWNLOAD_PAGE_URL, UPDATE_MANIFEST_URL } from '@/config/appVersion';

export interface UpdateManifest {
  version: string;
  downloadUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  sha256?: string;
}

export type UpdateCheckResult =
  | { status: 'latest'; currentVersion: string }
  | { status: 'available'; currentVersion: string; update: UpdateManifest }
  | { status: 'error'; currentVersion: string; message: string };

function normalizeVersion(value: string): number[] {
  return String(value || '').replace(/^v/i, '').split('.').map(part => Number(part) || 0);
}

export function isNewerVersion(candidate: string, current = APP_VERSION): boolean {
  const next = normalizeVersion(candidate);
  const installed = normalizeVersion(current);
  const length = Math.max(next.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    if ((next[index] || 0) !== (installed[index] || 0)) return (next[index] || 0) > (installed[index] || 0);
  }
  return false;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}`);
    const update = await response.json() as UpdateManifest;
    if (!update?.version || !/^v?\d+(?:\.\d+){1,3}$/.test(String(update.version))) throw new Error('更新清单格式无效');
    return isNewerVersion(update.version) ? { status: 'available', currentVersion: APP_VERSION, update } : { status: 'latest', currentVersion: APP_VERSION };
  } catch (error) {
    return { status: 'error', currentVersion: APP_VERSION, message: error instanceof Error ? error.message : '无法连接更新服务' };
  }
}

export function openUpdateDownload(url?: string): void {
  window.open(url || UPDATE_DOWNLOAD_PAGE_URL, '_blank', 'noopener,noreferrer');
}
