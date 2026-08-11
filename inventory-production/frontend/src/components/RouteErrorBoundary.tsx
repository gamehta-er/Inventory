import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface BoundaryProps {
  children: ReactNode;
  resetKey: string;
  onReturn(): void;
}

interface BoundaryState {
  error: Error | null;
  requestId: string;
}

class RouteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, requestId: '' };

  static getDerivedStateFromError(error: Error): BoundaryState {
    const requestId = (error as Error & { requestId?: string }).requestId
      || `UI-${Date.now().toString(36).toUpperCase()}`;
    return { error, requestId };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Inventory route failed', { error, componentStack: info.componentStack, requestId: this.state.requestId });
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, requestId: '' });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <section className="route-failure surface" role="alert">
      <span className="eyebrow">Page unavailable</span>
      <h1>This page could not be displayed</h1>
      <p>Your inventory data was not changed. Retry the page or return to Search.</p>
      <small>Support reference: {this.state.requestId}</small>
      <div>
        <button className="button button--primary" onClick={() => this.setState({ error: null, requestId: '' })}>Retry</button>
        <button className="button button--secondary" onClick={this.props.onReturn}>Return to Search</button>
      </div>
    </section>;
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return <RouteBoundary resetKey={`${location.pathname}${location.search}`} onReturn={() => navigate('/')}>
    {children}
  </RouteBoundary>;
}
