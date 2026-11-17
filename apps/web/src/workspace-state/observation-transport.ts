import type { HttpAgentFetchFn } from "@ag-ui/client";

/** SDK detachment releases observers; this owner also releases its HTTP body. */
export function ownObservationRequests(agent: { fetch: HttpAgentFetchFn }) {
  const original = agent.fetch;
  const controller = new AbortController();
  const owned: HttpAgentFetchFn = (url, request) =>
    original.call(agent, url, {
      ...request,
      signal: request.signal
        ? AbortSignal.any([request.signal, controller.signal])
        : controller.signal,
    });
  agent.fetch = owned;
  return () => {
    controller.abort();
    if (agent.fetch === owned) agent.fetch = original;
  };
}
