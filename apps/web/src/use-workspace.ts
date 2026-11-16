/* oxlint-disable effecttsgo/unstable-api-usage -- React integrates pinned Effect HTTP atoms with CopilotKit's native observer. */
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { HttpAgent } from "@ag-ui/client";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";
import { RegistryContext, useAtomSet } from "@effect/atom-react";
import { Effect, Exit, Schema } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { WorkspaceStateJson, SubmissionSchema } from "../../../src/web/workspace-wire.ts";
import type { WorkspaceSnapshot, TranscriptMessage } from "../../../src/web/contracts.ts";
import type {
  PresentationAttachmentSchema,
  PresentationDiagnosticSchema,
} from "../../../src/presentation/contracts.ts";
import { bootstrapQuery, historyQuery, invalidateWork } from "./data.ts";
import { requestError } from "./request-state.tsx";

type Pending = typeof SubmissionSchema.Type;
const updates = [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnMessagesChanged];

function readPending(key: string): Pending | undefined {
  try {
    const result = Schema.decodeUnknownResult(SubmissionSchema)(
      JSON.parse(localStorage.getItem(key) ?? "null"),
    );
    return result._tag === "Success" ? result.success : undefined;
  } catch {
    return undefined;
  }
}

/** Owns one observer and independent admission transports; never owns native execution. */
export function useWorkspace(initial: WorkspaceSnapshot) {
  const registry = useContext(RegistryContext);
  const { agent, isReady } = useAgent({
    agentId: "abra-workspace",
    runtimeAgentId: "abra",
    threadId: initial.session_id,
    updates,
  });
  const [workspace, setWorkspace] = useState(initial);
  const [revision, setRevision] = useState(0);
  const latest = useRef(initial);
  const [stateError, setStateError] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const draftKey = `abra-draft-${initial.session_id}`;
  const [draft, setDraft] = useState(() => {
    try {
      return (localStorage.getItem(draftKey) ?? "").slice(0, 32768);
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (draft) localStorage.setItem(draftKey, draft);
      else localStorage.removeItem(draftKey);
    } catch {
      /* An unavailable browser store does not discard the mounted draft. */
    }
  }, [draft, draftKey]);
  const storageKey = `abra-pending-${initial.session_id}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [admitting, setAdmitting] = useState(false);
  const admittingRef = useRef(false);
  const mounted = useRef(false);
  const senders = useRef(new Map<string, { agent: HttpAgent; admitted: boolean }>());
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
  const invalidate = useAtomSet(invalidateWork, { mode: "promiseExit" });
  const invalidatedAt = useRef(0);

  const accept = useCallback(
    (value: WorkspaceSnapshot) => {
      if (
        value.session_id !== initial.session_id ||
        !Number.isFinite(Date.parse(value.at)) ||
        Date.parse(value.at) < Date.parse(latest.current.at)
      )
        return false;
      latest.current = value;
      setWorkspace(value);
      setRevision((version) => version + 1);
      return true;
    },
    [initial.session_id],
  );
  useEffect(() => {
    const receive = (state: unknown) => {
      if (!state || typeof state !== "object" || !Object.hasOwn(state, "workspace")) return;
      const result = Schema.decodeUnknownResult(WorkspaceStateJson)(state);
      if (result._tag === "Failure" || result.success.workspace.session_id !== initial.session_id) {
        setStateError("Workspace update unavailable. Showing the last valid state.");
        return;
      }
      if (!accept(result.success.workspace)) {
        setStateError(
          "An older or invalid observation was received. Showing the last valid state.",
        );
        return;
      }
      setStateError("");
      setConnectionError("");
    };
    receive(agent.state);
    const subscription = agent.subscribe({
      onStateChanged: ({ state }) => receive(state),
      onCustomEvent: ({ event }) => {
        if (event.name === "abracode.connection" && event.value?.status === "reconnecting")
          setConnectionError(
            "Native observation unavailable. Reconnecting; showing the last valid state.",
          );
      },
    });
    return () => subscription.unsubscribe();
  }, [agent, initial.session_id, accept]);

  useEffect(() => {
    const timer = setTimeout(
      () => {
        invalidatedAt.current = Date.now();
        void invalidate(latest.current.work.work.map((work) => work.issue_id)).then((result) => {
          if (mounted.current && Exit.isFailure(result)) setError(requestError(result.cause));
        });
      },
      Math.max(0, 1000 - (Date.now() - invalidatedAt.current)),
    );
    return () => clearTimeout(timer);
  }, [revision, invalidate]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (!active) return;
      void agent
        .connectAgent()
        .catch(() => {
          if (active) setConnectionError("Live connection interrupted. Reconnecting…");
        })
        .finally(() => {
          if (active) timer = setTimeout(connect, 2000);
        });
    };
    connect();
    const admissions = senders.current;
    return () => {
      active = false;
      clearTimeout(timer);
      void agent.detachActiveRun();
      for (const sender of admissions.values()) void sender.agent.detachActiveRun();
      admissions.clear();
    };
  }, [agent, isReady]);

  const refresh = useCallback(() => {
    registry.refresh(bootstrapQuery);
    void Effect.runPromiseExit(
      AtomRegistry.getResult(registry, bootstrapQuery, { suspendOnWaiting: true }),
    ).then((result) => {
      if (!mounted.current) return;
      if (Exit.isSuccess(result)) {
        // HttpApi returns decoded values; AG-UI state must contain JSON wire values.
        if (Date.parse(result.value.at) < Date.parse(latest.current.at)) return;
        agent.setState(Schema.encodeSync(WorkspaceStateJson)({ workspace: result.value }));
        accept(result.value);
      } else setError(requestError(result.cause));
    });
  }, [registry, agent, accept]);

  useEffect(() => {
    if (!pending) return;
    const receipt = workspace.receipts.find((r) => r.request_id === pending.request_id);
    if (receipt?.status === "admitted") {
      const sender = senders.current.get(pending.request_id);
      if (sender) {
        sender.admitted = true;
        void sender.agent.detachActiveRun();
      }
      setPending(undefined);
      setAdmitting(false);
      admittingRef.current = false;
      localStorage.removeItem(storageKey);
    } else if (receipt?.status === "uncertain") {
      setAdmitting(false);
      admittingRef.current = false;
      setError(
        "Submission is uncertain. Use Reconcile submission to check the same input identity.",
      );
    }
  }, [workspace.receipts, pending, storageKey]);

  async function send(input?: Pending) {
    if (!isReady || admittingRef.current || (!input && pending)) return;
    const submission = input ?? {
      request_id: crypto.randomUUID(),
      text: draft.trim(),
      delivery: "queue" as const,
    };
    if (!submission.text) return;
    // Persist before starting network admission; a storage failure leaves the draft intact.
    try {
      localStorage.setItem(storageKey, JSON.stringify(submission));
    } catch {
      setError(
        "Cannot retain submission identity in browser storage. Enable storage before sending.",
      );
      return;
    }
    admittingRef.current = true;
    setAdmitting(true);
    setPending(submission);
    setDraft("");
    setError("");
    const sender = {
      agent: new HttpAgent({
        url: "/api/copilotkit/agent/abra/run",
        agentId: "abra",
        threadId: initial.session_id,
        initialMessages: [{ id: submission.request_id, role: "user", content: submission.text }],
      }),
      admitted: false,
    };
    senders.current.set(submission.request_id, sender);
    try {
      await sender.agent.runAgent({
        tools: [],
        context: [],
        forwardedProps: { request_id: submission.request_id, delivery: submission.delivery },
      });
    } catch (cause) {
      if (!sender.admitted && mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Submission could not be confirmed. Reconcile before sending again.",
        );
    } finally {
      senders.current.delete(submission.request_id);
      if (mounted.current && !sender.admitted) {
        admittingRef.current = false;
        setAdmitting(false);
        refresh();
      }
    }
  }

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
    workspace,
    isReady,
    stateError,
    error,
    setError,
    connectionError,
    draft,
    setDraft,
    pending,
    admitting,
    refresh,
    send,
    messages,
    presentations,
    hasHistory: Boolean(cursor ?? workspace.older),
    loadingHistory,
    loadHistory,
  };
}
