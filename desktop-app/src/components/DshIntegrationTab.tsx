import React, { useCallback, useEffect, useState } from 'react';
import { Button, Space, Modal, message, Input } from 'antd';

interface DshStatus {
  available: boolean;
  command: string | null;
  via: string | null;
  version: string | null;
  home: string;
  profiles: Record<string, { exists: boolean; patch: string | null; injected: boolean }>;
  bridgePort: number;
  bridgeFile: string | null;
}

/** 设置 → DSH 集成：探测 dsh、注入 MCP 配置、打开 DSH Web 面板 */
export const DshIntegrationTab: React.FC = () => {
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [detail, setDetail] = useState<string>('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const st = await (window as any).electronAPI?.dshApi?.getStatus?.();
      setStatus(st || null);
    } catch { setStatus(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const inject = async (profile: string) => {
    setInjecting(true);
    try {
      const r = await (window as any).electronAPI?.dshApi?.injectMcpConfig?.({ profile });
      if (r?.ok) message.success(r.message);
      else message.warning(r?.message || '注入失败');
      setDetail(r?.message || '');
      await refresh();
    } catch (e: any) { message.error('注入异常：' + String(e?.message || e)); }
    finally { setInjecting(false); }
  };

  const openWeb = async () => {
    try {
      const r = await (window as any).electronAPI?.dshApi?.openWeb?.();
      if (r?.ok) message.success('已打开 DSH 面板');
      else message.warning(r?.message || '无法打开 DSH 面板');
    } catch (e: any) { message.error('打开失败：' + String(e?.message || e)); }
  };

  const profiles = status?.profiles || {};
  const anyInjected = Object.values(profiles).some(p => p?.injected);
  const dshReady = !!(status?.available);

  /** 首次运行向导步骤（每步含状态与操作） */
  const wizardSteps: Array<{ key: string; title: string; state: 'done' | 'active' | 'todo' | 'error'; desc: string; action?: React.ReactNode }> = [];
  // 1) 检测 dsh
  if (!status) wizardSteps.push({ key: 'check', title: '检测 dsh 安装', state: 'active', desc: '正在检测本机是否已安装 dsh…' });
  else if (dshReady) wizardSteps.push({ key: 'check', title: '检测 dsh 安装', state: 'done', desc: `已就绪：${status.command}${status.version ? '（v' + status.version + '）' : ''}` });
  else wizardSteps.push({ key: 'check', title: '检测 dsh 安装', state: 'error', desc: '未检测到 dsh。请先全局安装，然后点击「重新检测」。' });
  // 2) 安装 dsh
  wizardSteps.push(dshReady
    ? { key: 'install', title: '安装 dsh', state: 'done', desc: '已安装，无需重复操作。' }
    : { key: 'install', title: '安装 dsh', state: 'todo', desc: '在终端执行：npm install -g @deepseek-ai/dsh', action: <code style={{ background: 'var(--theme-input)', padding: '2px 6px', borderRadius: 4 }}>npm install -g @deepseek-ai/dsh</code> });
  // 3) 注入 MCP 配置
  wizardSteps.push(anyInjected
    ? { key: 'inject', title: '注入 MCP 配置（画布工具）', state: 'done', desc: '已注入 mcp-canvas，DSH agent 可获得 mcp__canvas__* 工具。' }
    : { key: 'inject', title: '注入 MCP 配置（画布工具）', state: dshReady ? 'active' : 'todo', desc: dshReady ? '让 DSH agent 能直接操作画布（加节点/连线/改配置/执行/查错）。' : '需先完成第 1、2 步。', action: (dshReady
        ? <Space wrap size={4}>
            <Button size="small" type="primary" loading={injecting} onClick={() => void inject('headless')}>注入（headless）</Button>
            <Button size="small" loading={injecting} onClick={() => void inject('web')}>注入（web）</Button>
          </Space>
        : null) });
  // 4) 使用 DSH
  const step4state = !status ? 'todo' : (!dshReady ? 'todo' : 'active');
  wizardSteps.push({ key: 'use', title: '开始使用', state: step4state, desc: '打开 DSH 面板对话操作画布，或在画布添加「DSH Agent」节点。', action: (dshReady
    ? <Space wrap size={4}>
        <Button size="small" onClick={() => void openWeb()}>打开 DSH 面板</Button>
        <Button size="small" onClick={() => { (window as any).electronAPI?.dshApi?.openWeb?.().then(() => {}); }}>顶部「聊天」入口（同面板）</Button>
      </Space>
    : null) });

  return (
    <div className="settings-tab-content">
      <div className="settings-section-title">DeepSeek Harness（DSH）集成</div>
      <div className="settings-section-hint">
        把画布接入 DeepSeek Harness：DSH Agent 通过 <b>mcp__canvas__*</b> 工具直接操作画布
        （加节点 / 连线 / 改配置 / 执行 / 查错修复），并可用它自己的文件系统、终端、Web 搜索与
        Skills 能力；画布里的「DSH Agent」节点可把任务交给 DSH headless 会话执行。
        本功能为<b>可选集成</b>，未安装 dsh 时不影响其它功能。
      </div>

      {/* 首次运行向导 */}
      <div style={{ marginBottom: 14, padding: '12px 14px', background: 'var(--theme-input)', borderRadius: 8, border: '1px solid var(--theme-border)' }}>
        <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--theme-text)' }}>首次运行向导</div>
        {wizardSteps.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderTop: i === 0 ? 'none' : '1px dashed var(--theme-border)' }}>
            <span style={{
              flex: '0 0 auto', width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600,
              background: s.state === 'done' ? 'var(--theme-success)' : s.state === 'active' ? 'var(--theme-primary, #4f46e5)' : s.state === 'error' ? 'var(--theme-error)' : 'var(--theme-border)',
              color: s.state === 'todo' ? 'var(--theme-muted)' : '#fff',
            }}>{s.state === 'done' ? '✓' : s.state === 'error' ? '!' : i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--theme-text)' }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--theme-muted)', marginTop: 2 }}>{s.desc}</div>
              {s.action && <div style={{ marginTop: 6 }}>{s.action}</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 12, padding: 12, background: 'var(--theme-input)', borderRadius: 8, border: '1px solid var(--theme-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ color: 'var(--theme-text)' }}>状态：</b>
          {loading ? <span style={{ color: 'var(--theme-muted)' }}>检测中…</span> : !status ? (
            <span style={{ color: 'var(--theme-error)' }}>未检测到 dsh（当前非 Electron 环境）</span>
          ) : status.available ? (
            <span style={{ color: 'var(--theme-success)' }}>已就绪</span>
          ) : (
            <span style={{ color: 'var(--theme-warning)' }}>未安装 dsh</span>
          )}
          {status?.version && <span style={{ color: 'var(--theme-muted)', fontSize: 12 }}>v{status.version}</span>}
          {status?.command && <span style={{ color: 'var(--theme-muted)', fontSize: 12 }}>· {status.command}</span>}
          {status?.bridgePort ? <span style={{ color: 'var(--theme-success)', fontSize: 12 }}>· MCP 桥 127.0.0.1:{status.bridgePort}</span> : null}
        </div>
        {!status?.available && (
          <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.7, color: 'var(--theme-muted)' }}>
            安装 dsh：在终端执行 <code>npm install -g @deepseek-ai/dsh</code>，然后重启应用并点击「重新检测」。
            （dsh 是 MIT 开源项目：<a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noreferrer">github.com/deepseek-ai/deepseek-harness</a>）
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Space wrap>
            <Button size="small" loading={loading} onClick={() => void refresh()}>重新检测</Button>
            <Button size="small" type="primary" disabled={!status?.available} onClick={() => void inject('headless')} loading={injecting}>注入 MCP 配置（headless）</Button>
            <Button size="small" type="primary" disabled={!status?.available} onClick={() => void inject('web')} loading={injecting}>注入 MCP 配置（web）</Button>
            <Button size="small" disabled={!status?.available} onClick={() => void openWeb()}>打开 DSH 面板</Button>
          </Space>
        </div>
      </div>

      {Object.keys(profiles).length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--theme-muted)', lineHeight: 1.8 }}>
          <b>DSH profiles：</b>
          {Object.entries(profiles).map(([name, info]) => (
            <div key={name} style={{ marginTop: 4 }}>
              <code>{name}</code>：{info?.exists ? (
                <span style={{ color: 'var(--theme-success)' }}>已初始化{info?.injected ? ' · 已注入 mcp-canvas' : ''}（{info.patch}）</span>
              ) : <span style={{ color: 'var(--theme-warning)' }}>未初始化（首次使用 dsh 时自动创建）</span>}
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div style={{ marginBottom: 12, padding: 10, background: 'rgba(79,70,229,.08)', border: '1px solid rgba(79,70,229,.35)', borderRadius: 8, fontSize: 12, color: 'var(--theme-text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{detail}</div>
      )}

      <div className="settings-section-hint" style={{ marginTop: 12 }}>
        使用方式：① 在画布添加「DSH Agent」节点，输入任务描述并点击执行按钮；② 打开 DSH 面板，
        在对话中直接要求操作画布（DSH 会调用 mcp__canvas__ 工具）；③ 注入配置后需重启 DSH（或让 DSH 热重载）
        才能看到新工具。源码写入 / 删除类操作仍需画布内人工确认（安全边界）。
      </div>
    </div>
  );
};