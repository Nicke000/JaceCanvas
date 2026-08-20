export interface AppUpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'latest' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

const unavailable = (): AppUpdateState => ({ status: 'error', message: '当前运行环境不支持应用内更新' });

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  return (window as any).electronAPI?.checkAppUpdate?.() || unavailable();
}

export async function downloadAppUpdate(): Promise<AppUpdateState> {
  return (window as any).electronAPI?.downloadAppUpdate?.() || unavailable();
}

export async function installAppUpdate(): Promise<boolean> {
  return Boolean(await (window as any).electronAPI?.installAppUpdate?.());
}

export function listenForAppUpdate(callback: (state: AppUpdateState) => void): (() => void) {
  return (window as any).electronAPI?.onAppUpdateState?.(callback) || (() => undefined);
}
