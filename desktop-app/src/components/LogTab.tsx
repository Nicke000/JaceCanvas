import React, { useCallback, useEffect, useState } from 'react';
import { Button, Space, message } from 'antd';
import { ReloadOutlined, FolderOpenOutlined, CopyOutlined } from '@ant-design/icons';

export interface LogEntry {
  t?: number;
  source?: string;
  type?: string;
  message?: string;
  reason?: string;
  stack?: string;
  raw?: string;
  [key: string]: unknown;
}

const TYPE_LABELS: Record<string, string> = {
  'render-process-gone': '渲染进程崩溃',
  'unresponsive': '页面无响应',
  'uncaughtException': '未捕获异常（主进程）',
  'unhandledRejection': '未处理 Promise 拒绝',
  'window-error': '页面错误（渲染进程）',
  'app-quit': '正常退出',
};

export const LogTab: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await (window as any).electronAPI?.getCrashLogs?.();
      setLogs(Array.isArray(list) ? list : []);
    } catch { setLogs([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copyLogs = async () => {
    const text = logs.map(item => JSON.stringify(item)).join('\n');
    if (!text) { message.info('暂无日志'); return; }
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制日志');
    } catch { message.warning('复制失败，请手动查看日志文件夹'); }
  };

  return <div className="settings-tab-content">
    <h3 className="settings-tab-title">崩溃日志</h3>
    <div className="settings-section-hint">记录崩溃、未捕获错误和渲染进程异常，便于排查问题。日志保存在应用数据目录 logs/error.log（超过 1MB 自动轮转）。</div>
    <Space wrap style={{ marginBottom: 12 }}>
      <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={() => void load()}>刷新</Button>
      <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void (window as any).electronAPI?.openLogFolder?.()}>打开日志文件夹</Button>
      <Button size="small" icon={<CopyOutlined />} onClick={() => void copyLogs()} disabled={!logs.length}>复制日志</Button>
    </Space>
    {logs.length === 0 ? <div className="settings-section-hint">暂无崩溃日志。若应用崩溃过，这里会显示原因。</div> :
      <div style={{ maxHeight: 420, overflow: 'auto', background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 8, padding: 10, fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1' }}>
        {logs.slice().reverse().map((item, i) => (
          <div key={i} style={{ marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,.06)', paddingBottom: 6 }}>
            <div style={{ color: 'var(--theme-muted)' }}>{item.t ? new Date(Number(item.t)).toLocaleString() : '未知时间'} · {TYPE_LABELS[String(item.type || '')] || String(item.type || item.source || 'log')}{item.source ? `（${item.source}）` : ''}</div>
            <div>{String(item.message || item.reason || item.raw || '')}</div>
            {item.stack && <div style={{ color: 'var(--theme-muted)' }}>{String(item.stack).split('\n').slice(0, 6).join('\n')}</div>}
          </div>
        ))}
      </div>}
  </div>;
};
