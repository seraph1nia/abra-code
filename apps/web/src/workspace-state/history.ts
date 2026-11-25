import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { Effect, Exit } from "effect";
import { toast } from "../notifications.tsx";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { WorkspaceSnapshot, TranscriptMessage } from "@abracode/contracts/web/contracts";
import type {
  PresentationAttachmentSchema,
  PresentationDiagnosticSchema,
} from "@abracode/contracts/presentation/contracts";
import { historyQuery } from "../data.ts";
import { requestError } from "../request-error.ts";
import type { Conversation } from "./conversation.ts";
export function useWorkspaceHistory(workspace: WorkspaceSnapshot, conversation: Conversation) {
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
  async function loadHistory(beforeLoad: () => void) {
    const next = cursor ?? workspace.older;
    if (!next || historyLoading.current || !mounted.current) return;
    beforeLoad();
    historyLoading.current = true;
    setLoadingHistory(true);
    const query = historyQuery(next);
    if (AsyncResult.isFailure(registry.get(query))) registry.refresh(query);
    const result = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, query, { suspendOnWaiting: true }),
    );
    if (mounted.current) {
      if (Exit.isSuccess(result)) {
        toast.dismiss("load-earlier-messages");
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
      } else {
        toast.error("Couldn’t load earlier messages", {
          id: "load-earlier-messages",
          description: requestError(result.cause),
          duration: 10000,
          action: {
            label: "Retry",
            onClick: (event) => {
              event.preventDefault();
              void loadHistory(beforeLoad);
            },
          },
        });
      }
      setLoadingHistory(false);
    }
    historyLoading.current = false;
  }
  const messages = useMemo(
    () => [
      ...new Map(
        [...older, ...conversation.messages].map((message) => [message.id, message]),
      ).values(),
    ],
    [older, conversation.messages],
  );
  const presentations = useMemo(
    () => ({
      entries: [
        ...new Map(
          [...earlierPresentations, ...(conversation.presentations?.entries ?? [])].map((entry) => [
            JSON.stringify([entry.message_id, entry.tool_call_id, entry.target]),
            entry,
          ]),
        ).values(),
      ],
      truncated: earlierPresentationLimit || Boolean(conversation.presentations?.truncated),
      diagnostics: [
        ...new Map(
          [
            ...earlierPresentationDiagnostics,
            ...(conversation.presentations?.diagnostics ?? []),
          ].map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
        ).values(),
      ],
    }),
    [
      earlierPresentations,
      conversation.presentations?.entries,
      earlierPresentationLimit,
      conversation.presentations?.truncated,
      earlierPresentationDiagnostics,
      conversation.presentations?.diagnostics,
    ],
  );
  return {
    messages,
    presentations,
    hasHistory: Boolean(cursor ?? workspace.older),
    loadingHistory,
    loadHistory,
  };
}
