import { Effect, Latch } from "effect";

/** One latch per provider checkpoint. Closing a run also releases future arrivals. */
export class JourneyGates {
  readonly seen = new Set<string>();
  private readonly gates = new Map<string, Latch.Latch>();
  private closed = false;

  private gate(key: string) {
    let gate = this.gates.get(key);
    if (!gate) {
      gate = Latch.makeUnsafe();
      this.gates.set(key, gate);
    }
    return gate;
  }
  wait(key: string) {
    this.seen.add(key);
    if (this.closed) return Promise.resolve();
    return Effect.runPromise(this.gate(key).await);
  }
  release = (key: string) => this.gate(key).openUnsafe();
  close() {
    this.closed = true;
    for (const gate of this.gates.values()) gate.openUnsafe();
    this.gates.clear();
  }
}
