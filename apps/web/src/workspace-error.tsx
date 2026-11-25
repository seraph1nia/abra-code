import { Component, type ReactNode } from "react";
import { Button } from "@abracode/presentation/ui/button";

export function WorkspaceError() {
  return (
    <main className="loading" role="alert">
      <h1>AbraCode could not display this page</h1>
      <Button variant="outline" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </main>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <WorkspaceError /> : this.props.children;
  }
}
