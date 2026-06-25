import React from 'react';

/**
 * 全局错误边界：捕获渲染期异常，避免整页白屏。
 * 出错时显示可读的报错信息 + 重新加载按钮，并把错误打到 console 方便定位。
 */
interface State { error: Error | null; info: string }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 打到控制台，便于排查
    console.error('[HiExplore] 渲染崩溃:', error, info);
    this.setState({ info: info?.componentStack || '' });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: '32px', fontFamily: 'monospace', overflow: 'auto' }}>
        <h2 style={{ color: '#f87171', fontSize: 18, fontWeight: 700, marginBottom: 12 }}>😵 页面出错了（已被错误边界拦下，没有丢数据）</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>把下面这段报错发给开发者就能定位。你的项目/笔记都存在本地，刷新即可恢复。</p>
        <pre style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 16, fontSize: 12, color: '#fca5a5', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
{String(error?.stack || error?.message || error)}
{info ? '\n\n组件栈:' + info : ''}
        </pre>
        <button
          onClick={() => { this.setState({ error: null, info: '' }); }}
          style={{ marginTop: 16, marginRight: 8, padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
        >返回应用</button>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 16, padding: '10px 20px', background: '#334155', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
        >刷新页面</button>
      </div>
    );
  }
}

export default ErrorBoundary;
