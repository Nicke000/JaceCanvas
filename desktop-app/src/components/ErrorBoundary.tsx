import React from 'react';

interface State { hasError: boolean; message: string; }
interface Props { children: React.ReactNode; }

/** 全局错误边界：渲染异常时显示可恢复的错误页，避免整树卸载导致黑屏。 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reload = () => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--theme-bg)', color: 'var(--theme-text)', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 520 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>应用遇到了一个错误</h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--theme-muted)', wordBreak: 'break-all' }}>{this.state.message}</p>
          <button onClick={this.reload} style={{ padding: '8px 22px', border: 'none', borderRadius: 6, background: '#7c6df2', color: '#fff', fontSize: 14, cursor: 'pointer' }}>重新加载</button>
        </div>
      </div>
    );
  }
}
