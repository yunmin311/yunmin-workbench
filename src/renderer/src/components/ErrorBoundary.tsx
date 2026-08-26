import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Workbench view crashed:', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  private readonly reload = () => window.location.reload();

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="panel" role="alert">
          <h2>This panel hit an unexpected error</h2>
          <p className="packet-alert">{this.state.error.message}</p>
          <p className="hint">
            Workbench-owned state on disk was not modified. Recover without deleting anything.
          </p>
          <div className="packet-copy-row">
            <button className="primary" onClick={this.reload}>Reload Workbench</button>
            <button onClick={this.reset}>Back to Workbench</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
