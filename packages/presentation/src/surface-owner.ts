/** Stage validated models, retire only after commit, and recreate after detach. */
export class SurfaceOwner<R, V> {
  private listeners = new Set<() => void>();
  private retired = new Set<V>();
  private view: { rendered?: V; error?: string } = {};
  constructor(
    private record: R,
    private prepare: (record: R) => V,
    private dispose: (value: V) => void,
  ) {}
  read = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.view.rendered) this.stage();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.view.rendered) this.dispose(this.view.rendered);
        for (const old of this.retired) this.dispose(old);
        this.retired.clear();
        this.view = {};
      }
    };
  };
  replace(record: R) {
    if (record === this.record) return;
    this.record = record;
    if (this.listeners.size) this.stage();
  }
  committed(view: { rendered?: V; error?: string }) {
    if (view !== this.view) return;
    for (const old of this.retired) this.dispose(old);
    this.retired.clear();
  }
  private stage() {
    try {
      const rendered = this.prepare(this.record);
      if (this.view.rendered) this.retired.add(this.view.rendered);
      this.view = { rendered };
    } catch {
      this.view = {
        ...this.view,
        error: "Generated view update unavailable: its catalog or structure is invalid.",
      };
    }
    for (const listener of this.listeners) listener();
  }
}
