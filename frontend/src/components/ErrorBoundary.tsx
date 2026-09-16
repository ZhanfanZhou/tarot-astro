import React from 'react';

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界。
 *
 * 没有它时，任何一次 render 抛错都会让 React 卸载整棵树，页面只剩 body 底色——
 * 排查时根本分不清「JS 崩了」和「浏览器合成层出问题闪了一下」。有了它，
 * 前者会留下一张可见的错误卡片 + 控制台栈，后者仍然只是画面闪烁，一眼可辨。
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] 渲染崩溃：', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#06060f',
          color: '#ede6d6',
        }}
      >
        <div style={{ maxWidth: 560, textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🕯️</div>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '.75rem', color: '#c9a96e' }}>
            页面出了点问题
          </h1>
          <p style={{ opacity: 0.7, marginBottom: '1.25rem', lineHeight: 1.7 }}>
            刷新一下通常就好了。若反复出现，请把浏览器控制台里以
            [ErrorBoundary] 开头的报错发给开发者。
          </p>
          <pre
            style={{
              textAlign: 'left',
              fontSize: '.75rem',
              opacity: 0.6,
              whiteSpace: 'pre-wrap',
              marginBottom: '1.25rem',
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '.6rem 1.6rem',
              borderRadius: 999,
              border: '1px solid rgba(201,169,110,.4)',
              background: 'transparent',
              color: '#c9a96e',
              cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
