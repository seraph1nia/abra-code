import { Button } from "./ui/button.tsx";
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";

/** Optional chunk failures stay local; reload clears the browser's failed module cache. */
export function deferred<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  label: string,
  className?: string,
  isActive: (props: P) => boolean = () => true,
  loading?: (props: P) => ReactNode,
) {
  const Loaded = lazy(load);
  class Boundary extends Component<{ children: ReactNode; active: boolean }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? (
        this.props.active ? (
          <div role="alert" className={className}>
            <p>{label} could not load.</p>
            <Button variant="outline" type="button" onClick={() => window.location.reload()}>
              Reload to retry
            </Button>
          </div>
        ) : null
      ) : (
        this.props.children
      );
    }
  }
  return function DeferredCapability(props: P) {
    const active = isActive(props);
    return (
      <Boundary active={active}>
        <Suspense
          fallback={
            active ? (
              loading ? (
                loading(props)
              ) : (
                <output className={className}>Loading {label.toLowerCase()}…</output>
              )
            ) : null
          }
        >
          <Loaded {...props} />
        </Suspense>
      </Boundary>
    );
  };
}
