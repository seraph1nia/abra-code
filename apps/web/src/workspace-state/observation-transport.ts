import type { HttpAgentFetchFn } from "@ag-ui/client";

/** SDK detachment releases observers; this owner also releases its HTTP body. */
export function ownObservationRequests(agent: { fetch: HttpAgentFetchFn }) {
  const original = agent.fetch;
  const controller = new AbortController();
  const owned: HttpAgentFetchFn = (url, request) =>
    /\/(?:connect|run)$/.test(new URL(url, "http://localhost").pathname)
      ? original.call(agent, url, {
          ...request,
          signal: request.signal
            ? AbortSignal.any([request.signal, controller.signal])
            : controller.signal,
        })
      : original.call(agent, url, request);
  agent.fetch = owned;
  return () => {
    controller.abort();
    if (agent.fetch === owned) agent.fetch = original;
  };
}

export function bindObservationThread(agent: { threadId: string }, thread: string) {
  agent.threadId = thread;
}
