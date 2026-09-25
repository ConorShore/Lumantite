import { Component, type ReactNode } from "react";

/** Keeps one broken tab from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`[${this.props.label}]`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-2 rounded border border-fail/50 bg-fail/10 p-4 text-fail" role="alert">
        <div className="font-semibold">{this.props.label} crashed: {this.state.error.message}</div>
        <button className="btn mt-2" onClick={() => this.setState({ error: null })}>Retry</button>
      </div>
    );
  }
}
