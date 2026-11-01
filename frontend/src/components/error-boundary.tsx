import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; errorInfo: string; debugInfo: string; }

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '', debugInfo: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const infoStr = info.componentStack || '';
    this.setState({ errorInfo: infoStr });
    fetch('/api/debug/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: infoStr,
        errorKeys: Object.getOwnPropertyNames(error),
        errorCause: error.cause ? JSON.stringify(error.cause) : undefined,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: '#0a0a0a', color: '#e5e5e5', minHeight: '100vh', fontFamily: 'monospace', fontSize: 13 }}>
          <h2 style={{ color: '#7C3AED', marginBottom: 8 }}>React Error Caught</h2>
          <p style={{ color: '#ef4444', marginBottom: 16, wordBreak: 'break-all' }}>{this.state.error?.message}</p>
          {this.state.debugInfo && (
            <>
              <h3 style={{ color: '#22c55e', marginBottom: 4 }}>Object that caused #310:</h3>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#22c55e', marginBottom: 16, fontSize: 11, background: '#14532d', padding: 12, borderRadius: 8 }}>
                {this.state.debugInfo}
              </pre>
            </>
          )}
          <h3 style={{ color: '#a3a3a3', marginBottom: 4 }}>Error Stack:</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#737373', marginBottom: 16, fontSize: 11, background: '#161618', padding: 12, borderRadius: 8 }}>
            {this.state.error?.stack}
          </pre>
          <h3 style={{ color: '#a3a3a3', marginBottom: 4 }}>Component Stack:</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#737373', fontSize: 11, background: '#161618', padding: 12, borderRadius: 8 }}>
            {this.state.errorInfo}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null, errorInfo: '', debugInfo: '' })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#7C3AED', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
