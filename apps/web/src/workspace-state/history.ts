/* oxlint-disable effecttsgo/unstable-api-usage -- Scoped browser observation and typed HTTP atoms. */
import { useContext, useEffect, useRef, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { Effect, Exit } from "effect";
import { AtomRegistry } from "effect/reactivity";
import type { WorkspaceSnapshot, TranscriptMessage } from "@abracode/contracts/web/contracts";
import type {
  PresentationAttachmentSchema,
  PresentationDiagnosticSchema,
} from "@abracode/contracts/presentation/contracts";
import { historyQuery } from "../data.ts";
import { requestError } from "../request-state.tsx";
export function useWorkspaceHistory(
  workspace: WorkspaceSnapshot,
  setError: (text: string) => void,
) {
  const registry = useContext(RegistryContext);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [older, setOlder] = useState<readonly TranscriptMessage[]>([]);
  const [earlierPresentations, setEarlierPresentations] = useState<
    readonly (typeof PresentationAttachmentSchema.Type)[]
  >([]);
  const [earlierPresentationLimit, setEarlierPresentationLimit] = useState(false);
  const [earlierPresentationDiagnostics, setEarlierPresentationDiagnostics] = useState<
    readonly (typeof PresentationDiagnosticSchema.Type)[]
  >([]);
  const [cursor, setCursor] = useState<string>();
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyLoading = useRef(false);
  async function loadHistory() {
    const next = cursor ?? workspace.older;
    if (!next || historyLoading.current) return;
    historyLoading.current = true;
    setLoadingHistory(true);
    const result = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, historyQuery(next)),
    );
    if (mounted.current) {
      if (Exit.isSuccess(result)) {
        setOlder((previous) => [...result.value.messages, ...previous]);
        setEarlierPresentations((previous) => [
          ...(result.value.presentations?.entries ?? []),
          ...previous,
        ]);
        if (result.value.presentations?.truncated) setEarlierPresentationLimit(true);
        setEarlierPresentationDiagnostics((previous) => [
          ...(result.value.presentations?.diagnostics ?? []),
          ...previous,
        ]);
        setCursor(result.value.older ?? "");
      } else setError(requestError(result.cause));
      setLoadingHistory(false);
    }
    historyLoading.current = false;
  }
  const messages = [
    ...new Map([...older, ...workspace.messages].map((message) => [message.id, message])).values(),
  ];
  const presentations = {
    entries: [
      ...new Map(
        [...earlierPresentations, ...(workspace.presentations?.entries ?? [])].map((entry) => [
          JSON.stringify([entry.message_id, entry.tool_call_id, entry.target]),
          entry,
        ]),
      ).values(),
    ],
    truncated: earlierPresentationLimit || Boolean(workspace.presentations?.truncated),
    diagnostics: [
      ...new Map(
        [...earlierPresentationDiagnostics, ...(workspace.presentations?.diagnostics ?? [])].map(
          (diagnostic) => [JSON.stringify(diagnostic), diagnostic],
        ),
      ).values(),
    ],
  };
  return {
    messages,
    presentations,
    hasHistory: Boolean(cursor ?? workspace.older),
    loadingHistory,
    loadHistory,
  };
}
