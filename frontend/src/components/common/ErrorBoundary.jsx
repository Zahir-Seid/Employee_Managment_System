import { Component } from "react";

// The app previously had no error boundary anywhere, so any uncaught
// render exception (see Dashboard's scope-switch bug, #8) unmounted the
// entire tree to a blank white screen, which reads exactly like an
// unexpected logout even though the session was never touched. This
// contains that failure mode to a single message with a recovery action,
// regardless of what causes a future render crash.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Unhandled render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-pagebg px-6">
          <div className="jm-card max-w-sm text-center">
            <p className="text-base font-semibold text-ink mb-1">Something went wrong</p>
            <p className="text-sm text-ink-muted mb-4">
              This page hit an unexpected error. Your session is still active, this view just needs a reload.
            </p>
            <button className="jm-btn-primary w-full justify-center" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
