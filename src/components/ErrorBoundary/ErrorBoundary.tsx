import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('Viewer boundary caught an error', error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal">
        <div>
          <p className="eyebrow">Viewer error</p>
          <h1>The viewer recovered to a safe state.</h1>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Reload local viewer</button>
        </div>
      </main>
    );
  }
}

