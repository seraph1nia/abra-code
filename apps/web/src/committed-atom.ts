import { useContext, useMemo, useSyncExternalStore } from "react";
import { RegistryContext } from "@effect/atom-react";
import type { Atom, AtomRegistry } from "effect/reactivity";

/** Suspended or discarded renders may read a placeholder. Only a committed
 * subscription starts the query, and multiple readers share its last value. */
export function committedAtom<A, B>(
  registry: AtomRegistry.AtomRegistry,
  query: Atom.Atom<A>,
  initial: B,
  select: (value: A) => B,
  enabled = true,
) {
  let readers = 0;
  let latest: A;
  let initialized = false;
  let snapshot = initial;
  return {
    read: () => {
      if (readers) {
        const next = registry.get(query);
        if (!initialized || next !== latest) {
          initialized = true;
          latest = next;
          snapshot = select(next);
        }
      }
      return snapshot;
    },
    subscribe: (notify: () => void) => {
      if (!enabled) return () => {};
      readers++;
      const release = registry.subscribe(query, notify);
      return () => {
        readers--;
        release();
      };
    },
  };
}

const identity = <A>(value: A) => value;
export function useCommittedAtomValue<A>(query: Atom.Atom<A>, initial: A, enabled: boolean) {
  const registry = useContext(RegistryContext);
  const reader = useMemo(
    () => committedAtom(registry, query, initial, identity, enabled),
    [registry, query, initial, enabled],
  );
  return useSyncExternalStore(reader.subscribe, reader.read);
}
