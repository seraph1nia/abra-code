import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

/** Each mounted search owns its timer and cannot settle another reader's input. */
export function useDebouncedValue<A>(value: A, millis: number) {
  const [{ source, settled }] = useState(() => {
    const source = Atom.make(value);
    return { source, settled: source.pipe(Atom.debounce(millis), Atom.setIdleTTL(0)) };
  });
  const set = useAtomSet(source);
  useEffect(() => set(value), [set, value]);
  return useAtomValue(settled);
}
