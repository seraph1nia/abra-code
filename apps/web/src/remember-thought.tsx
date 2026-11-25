import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Exit, Schema } from "effect";
import { RepositoryId, RequestId } from "@abracode/contracts/identities";
import type { ThoughtDetail } from "@abracode/contracts/visibility/thoughts";
import { Button } from "@abracode/presentation/ui/button";
import { WorkspaceApi, repositoriesQuery, memoryEnabledQuery } from "./data.ts";
import { requestError } from "./request-error.ts";

import { MemoryScope } from "@abracode/contracts/visibility/memory";
import { readRetained, writeRetained } from "./retained-input.ts";

const Pending = Schema.Struct({
  id: RequestId,
  destination: MemoryScope,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  length: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(8192)),
});
const publish = WorkspaceApi.mutation("workspace", "memoryPublish");
export function RememberThought({ item }: { item: typeof ThoughtDetail.Type }) {
  const enabled = useAtomValue(memoryEnabledQuery);
  const { instance, account, name, wording_hash } = item.reference;
  const storageKey = "abra-remember/" + JSON.stringify([instance, account, name, wording_hash]);
  const [open, setOpen] = useState(() => Boolean(readRetained(storageKey, Pending)));
  const [excerpt, setExcerpt] = useState("");
  if (!AsyncResult.isSuccess(enabled) || !enabled.value) return null;
  if (!open)
    return (
      <Button
        variant="outline"
        onClick={() => {
          const selected = window.getSelection()?.toString();
          setExcerpt(selected && item.content.includes(selected) ? selected : "");
          setOpen(true);
        }}
      >
        Remember for…
      </Button>
    );
  return (
    <RememberForm
      item={item}
      storageKey={storageKey}
      initial={excerpt}
      close={() => setOpen(false)}
    />
  );
}
function RememberForm({
  item,
  initial,
  storageKey,
  close,
}: {
  item: typeof ThoughtDetail.Type;
  initial: string;
  storageKey: string;
  close: () => void;
}) {
  const projects = useAtomValue(repositoriesQuery);
  const send = useAtomSet(publish, { mode: "promiseExit" });
  const [pending] = useState(() => readRetained(storageKey, Pending));
  const [excerpt, setExcerpt] = useState(
    pending ? item.content.slice(pending.offset, pending.offset + pending.length) : initial,
  );
  const [destination, setDestination] = useState(
    pending?.destination.kind === "shared"
      ? "shared"
      : pending
        ? "repo:" + pending.destination.repository_id
        : "",
  );
  const [id, setId] = useState(() => pending?.id ?? RequestId.make(crypto.randomUUID()));
  const [state, setState] = useState<"editing" | "busy" | "saved" | "failed">(
    pending ? "failed" : "editing",
  );
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const changed = () => {
    setId(RequestId.make(crypto.randomUUID()));
    setState("editing");
    setMessage("");
  };
  return (
    <form
      className="space-y-2"
      aria-label="Remember selected wording"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          submitting.current ||
          state === "saved" ||
          !destination ||
          !excerpt ||
          !item.content.includes(excerpt)
        )
          return;
        const dest =
          destination === "shared"
            ? { kind: "shared" as const }
            : {
                kind: "repository" as const,
                repository_id: RepositoryId.make(destination.slice(5)),
              };
        if (
          !writeRetained(storageKey, {
            id,
            destination: dest,
            offset: item.content.indexOf(excerpt),
            length: excerpt.length,
          })
        ) {
          setMessage("Enable browser storage to keep this save available for retry.");
          return;
        }
        submitting.current = true;
        setState("busy");
        const result = await send({
          payload: {
            request_id: id,
            destination: dest,
            content: excerpt,
            source: { kind: "thought", reference: item.reference },
          },
        });
        submitting.current = false;
        if (Exit.isFailure(result)) {
          setState("failed");
          setMessage(requestError(result.cause));
        } else {
          if (readRetained(storageKey, Pending)?.id === id) writeRetained(storageKey, null);
          setState("saved");
          setMessage(
            "Remembered for " +
              (dest.kind === "shared" ? "all projects" : dest.repository_id) +
              ".",
          );
        }
      }}
    >
      <label className="block">
        Exact wording
        <textarea
          className="block w-full"
          value={excerpt}
          maxLength={8192}
          disabled={state === "busy" || state === "saved"}
          onChange={(e) => {
            changed();
            setExcerpt(e.target.value);
          }}
        />
      </label>
      {excerpt && !item.content.includes(excerpt) && (
        <p role="alert">Choose a continuous excerpt from this thought.</p>
      )}
      <label className="block">
        Destination
        <select
          className="block w-full"
          value={destination}
          disabled={state === "busy" || state === "saved"}
          onChange={(e) => {
            changed();
            setDestination(e.target.value);
          }}
        >
          <option value="">Choose destination</option>
          {AsyncResult.isSuccess(projects) &&
            projects.value.map((p) => (
              <option key={p.id} value={"repo:" + p.id}>
                {p.name}
              </option>
            ))}
          <option value="shared">All projects (shared)</option>
        </select>
      </label>
      {state !== "saved" && (
        <Button
          type="submit"
          disabled={state === "busy" || !excerpt || !destination || !item.content.includes(excerpt)}
        >
          {state === "failed" ? "Retry save" : "Save to memory"}
        </Button>
      )}
      <Button type="button" variant="outline" disabled={state === "busy"} onClick={close}>
        {state === "saved" ? "Done" : "Cancel"}
      </Button>
      {message && <p role={state === "failed" ? "alert" : "status"}>{message}</p>}
    </form>
  );
}
