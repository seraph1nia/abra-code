/* oxlint-disable effecttsgo/unstable-api-usage -- Review draft state is owned by Effect atoms backed by browser storage. */
import { useCallback, useContext, useEffect, useMemo } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { Schema } from "effect";
import {
  ReviewAnswersSchema,
  ReviewSubmitSchema,
  ReviewReceiptSchema,
  type ReviewRecord,
  type ReviewAnswers,
} from "@abracode/contracts/web/reviews";
import { readRetained, writeRetained } from "./retained-input.ts";

const DraftSchema = Schema.Struct({
  answers: ReviewAnswersSchema,
  pending: Schema.optionalKey(ReviewSubmitSchema),
  receipt: Schema.optionalKey(ReviewReceiptSchema),
});
type Draft = typeof DraftSchema.Type & {
  working?: boolean;
  error?: string;
  errors?: Record<string, string>;
};
type ReviewIdentity = {
  review_id: string;
  revision: number;
  hash: string;
};
type DraftEntry = {
  key: string;
  identity: ReviewIdentity;
  value: Draft;
  persisted: string | undefined;
  unsaved: boolean;
  atom: Atom.Writable<Draft, Draft>;
};

const MAX_DRAFTS = 64;
const registryCaches = new WeakMap<AtomRegistry.AtomRegistry, Map<string, DraftEntry>>();
const activeCounts = new WeakMap<DraftEntry, number>();

function restoreDraft(
  key: string,
  { review_id, revision, hash }: ReviewIdentity,
): Draft | undefined {
  const draft = readRetained(key, DraftSchema);
  const matches = (value: NonNullable<Draft["receipt"] | Draft["pending"]>) =>
    value.review_id === review_id && value.revision === revision && value.hash === hash;
  if (
    !draft ||
    (draft.pending && !matches(draft.pending)) ||
    (draft.receipt && !matches(draft.receipt))
  )
    return undefined;
  return draft;
}

function getOrCreateEntry(
  registry: AtomRegistry.AtomRegistry,
  key: string,
  identity: ReviewIdentity,
): DraftEntry {
  let cache = registryCaches.get(registry);
  if (!cache) {
    cache = new Map();
    registryCaches.set(registry, cache);
  }
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const initial = restoreDraft(key, identity);
  const entry: DraftEntry = {
    key,
    identity,
    value: initial ?? { answers: {} },
    persisted: JSON.stringify(initial),
    unsaved: false,
    atom: undefined as unknown as Atom.Writable<Draft, Draft>,
  };
  entry.atom = Atom.writable<Draft, Draft>(
    () => entry.value,
    (ctx, next) => {
      entry.value = next;
      ctx.setSelf(next);
    },
  );
  cache.set(key, entry);
  if (cache.size > MAX_DRAFTS) {
    for (const [candidateKey, candidate] of cache) {
      if ((activeCounts.get(candidate) ?? 0) === 0 && candidateKey !== key) {
        cache.delete(candidateKey);
        if (cache.size <= MAX_DRAFTS) break;
      }
    }
  }
  return entry;
}

function subscribeStorage(registry: AtomRegistry.AtomRegistry, entry: DraftEntry) {
  activeCounts.set(entry, (activeCounts.get(entry) ?? 0) + 1);
  refreshEntry(registry, entry);
  const changed = (event: StorageEvent) => {
    if (event.key === entry.key) refreshEntry(registry, entry);
  };
  window.addEventListener("storage", changed);
  return () => {
    activeCounts.set(entry, Math.max(0, (activeCounts.get(entry) ?? 1) - 1));
    window.removeEventListener("storage", changed);
  };
}

function refreshEntry(registry: AtomRegistry.AtomRegistry, entry: DraftEntry) {
  if (entry.value.working) return;
  const stored = restoreDraft(entry.key, entry.identity);
  if (!stored) return;
  const serialized = JSON.stringify(stored);
  if (serialized === entry.persisted) return;
  entry.persisted = serialized;
  registry.set(entry.atom, entry.unsaved ? { ...stored, answers: entry.value.answers } : stored);
}

function updateEntry(
  registry: AtomRegistry.AtomRegistry,
  entry: DraftEntry,
  next: Partial<Draft>,
  required = false,
): boolean {
  const updated: Draft = { ...entry.value, ...next };
  const retained = {
    answers: updated.answers,
    pending: updated.pending,
    receipt: updated.receipt,
  };
  const saved = writeRetained(entry.key, retained);
  if (saved) entry.persisted = JSON.stringify(retained);
  entry.unsaved = !saved;
  if (!saved && required)
    updated.error =
      "Cannot retain submission identity in browser storage. Your draft is preserved; enable storage before sending.";
  registry.set(entry.atom, updated);
  return saved;
}

export function useReviewDraft(record: ReviewRecord) {
  const registry = useContext(RegistryContext);
  const {
    session_id,
    revision,
    hash,
    review: { review_id },
  } = record;
  const key = `abra-review-${session_id}-${review_id}-${revision}-${hash}`;
  const entry = useMemo(
    () => getOrCreateEntry(registry, key, { review_id, revision, hash }),
    [registry, key, review_id, revision, hash],
  );
  const state = useAtomValue(entry.atom);
  useEffect(() => subscribeStorage(registry, entry), [registry, entry]);
  const update = useCallback(
    (next: Partial<Draft>, required = false) => updateEntry(registry, entry, next, required),
    [registry, entry],
  );
  const change = useCallback(
    (id: string, answer: string | readonly string[]) => {
      updateEntry(registry, entry, {
        answers: { ...entry.value.answers, [id]: answer } as ReviewAnswers,
        errors: {},
        error: undefined,
      });
    },
    [registry, entry],
  );
  const current = useCallback(() => entry.value, [entry]);
  return { state, update, change, current };
}
