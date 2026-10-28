import { Component, type ReactNode } from 'react';
import { LoadError } from './states';

interface BoundaryState {
  failed: boolean;
}

/**
 * Something that breaks (a layout, a panel) shows the error state in its place, with Retry; the
 * rest of the page keeps working.
 */
export class ErrorBoundary extends Component<{ children?: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <LoadError error={null} onRetry={() => this.setState({ failed: false })} />;
    }
    return this.props.children;
  }
}
