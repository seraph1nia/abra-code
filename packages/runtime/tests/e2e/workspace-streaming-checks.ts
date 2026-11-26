import { HttpAgent } from "@ag-ui/client";

import { NativeWebBackend } from "../../src/web/backend.ts";
import type { WorkspaceJourneyInput } from "./workspace.ts";
export function observeWorkspaceStreaming(
  input: WorkspaceJourneyInput,
  backend: NativeWebBackend,
  origin: string,
) {
  const nativeTrace: {
    type: string;
    id?: string;
    busy?: boolean;
    repair?: boolean;
    sequence?: number;
  }[] = [];
  const observeNative = backend.nativeEvent;
  backend.nativeEvent = (event) => {
    const result = observeNative(event);
    nativeTrace.push({
      type: event.type,
      id: event.id,
      busy: result.view?.busy,
      repair: result.repair,
      sequence: event.durable?.seq,
    });
    return result;
  };
  const partialBeforeRelease = { tool: false, text: false };
  const observers: { agent: HttpAgent; done: Promise<void>; events: string[]; errors: string[] }[] =
    [];
  async function attachObserver() {
    const agent = new HttpAgent({
      url: `${origin}/api/copilotkit/agent/abra/connect`,
      headers: { origin: origin },
      agentId: "abra",
      threadId: input.session,
    });
    let ready!: () => void;
    const baseline = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const events: string[] = [],
      errors: string[] = [];
    const done = agent
      .runAgent(
        {},
        {
          onMessagesSnapshotEvent: ({ event }) => {
            ready();
            for (const message of event.messages) {
              if (message.role !== "assistant") continue;
              if (
                typeof message.content === "string" &&
                message.content.includes("Streaming native text") &&
                !message.content.includes("completed.")
              ) {
                partialBeforeRelease.text = true;
                input.streaming.release("text");
              }
              for (const call of message.toolCalls ?? [])
                if (call.id === "call_workspace_stream") {
                  partialBeforeRelease.tool = true;
                  input.streaming.release("tool");
                }
            }
          },
          onTextMessageContentEvent: ({ event }) => {
            events.push("text");
            if (event.delta.includes("Streaming native text")) {
              partialBeforeRelease.text = true;
              input.streaming.release("text");
            }
          },
          onToolCallStartEvent: ({ event }) => {
            if (event.toolCallId === "call_workspace_stream") {
              partialBeforeRelease.tool = true;
              input.streaming.release("tool");
            }
          },
          onToolCallArgsEvent: ({ event }) => {
            events.push("arguments");
            if (event.toolCallId === "call_workspace_stream" && event.delta) {
              partialBeforeRelease.tool = true;
              input.streaming.release("tool");
            }
          },
          onToolCallResultEvent: () => {
            events.push("result");
          },
        },
      )
      .then(() => undefined)
      .catch((error) => {
        errors.push(String(error));
      });
    const observer = { agent, done, events, errors };
    observers.push(observer);
    await Promise.race([
      baseline,
      done.then(() => {
        throw new Error(`Native observer ended before baseline: ${errors.join("; ")}`);
      }),
    ]);
    return observer;
  }
  return {
    nativeTrace,
    partialBeforeRelease,
    observers,
    attachObserver,
    async close() {
      for (const observer of observers) await observer.agent.detachActiveRun();
      await Promise.all(observers.map((observer) => observer.done));
    },
  };
}
export type WorkspaceStreaming = ReturnType<typeof observeWorkspaceStreaming>;
