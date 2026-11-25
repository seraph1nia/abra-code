/** Stage validated models, retire only after commit, and recreate after detach. */
export class SurfaceOwner<R, V> {
  private listeners = new Set<() => void>();
  private retired = new Set<V>();
  private view: { rendered?: V; error?: string } = {};
  constructor(
    private record: R,
    private prepare: (record: R) => V,
    private dispose: (value: V) => void,
    private sameRecord: (previous: R, next: R) => boolean = Object.is,
    private update?: (current: V, record: R) => boolean,
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
    if (!this.view.error && (this.record === record || this.sameRecord(this.record, record)))
      return;
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
      const current = this.view.rendered;
      if (current && this.update?.(current, this.record)) {
        this.view = { rendered: current };
      } else {
        const rendered = this.prepare(this.record);
        if (current) this.retired.add(current);
        this.view = { rendered };
      }
    } catch (cause) {
      this.view = {
        ...this.view,
        error:
          cause instanceof Error
            ? cause.message.slice(0, 512)
            : "Generated view update unavailable",
      };
    }
    for (const listener of this.listeners) listener();
  }
}
