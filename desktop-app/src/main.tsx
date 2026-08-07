import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// 渲染端全局错误上报（写入崩溃日志，便于排查）
window.addEventListener('error', (e) => {
  try { (window as any).electronAPI?.logRenderError?.({ type: 'window-error', message: String(e.message), stack: e.error?.stack, url: e.filename, line: e.lineno }); } catch { /* 忽略 */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try { (window as any).electronAPI?.logRenderError?.({ type: 'unhandledrejection', reason: String(e.reason) }); } catch { /* 忽略 */ }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
