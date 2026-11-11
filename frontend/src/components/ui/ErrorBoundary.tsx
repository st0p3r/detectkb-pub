import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  /** Changing it (e.g. the path) clears the error, so moving on works */
  resetKey?: string;
  children: React.ReactNode;
}

/**
 * Catches a crash while rendering a page, so the rest of the app (the menu,
 * the search) keeps working instead of the whole screen going blank.
 */
export class ErrorBoundary extends React.Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A page chunk from before an update no longer exists on the server
    const stale = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);
    return (
      <div role="alert" className="max-w-xl mx-auto mt-16 rounded-lg border border-border bg-card p-6 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
        <h2 className="mt-3 text-lg font-semibold">{stale ? 'DetectKB was updated' : 'This page could not be shown'}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {stale ? 'Reload to get the new version.' : 'Something went wrong while showing it. Your data is not affected; the rest of the app still works.'}
        </p>
        {!stale && <p className="mt-2 font-mono text-xs text-muted-foreground break-words">{error.message}</p>}
        <div className="mt-4 flex justify-center gap-2">
          {!stale && (
            <button onClick={() => this.setState({ error: null })} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-accent">
              <RotateCcw className="w-3.5 h-3.5" /> Try again
            </button>
          )}
          <button onClick={() => window.location.reload()} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
