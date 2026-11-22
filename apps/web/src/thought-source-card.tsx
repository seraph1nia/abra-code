import { useState } from "react";
import type { ThoughtReference } from "@abracode/contracts/visibility/thoughts";
import { WorkspaceApi } from "./data.ts";
import { RequestState } from "./request-state.tsx";

function original(ref: ThoughtReference) {
  try {
    const url = new URL(ref.instance);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === ref.instance &&
      /^memos\/[a-z0-9][a-z0-9-]{0,99}$/i.test(ref.name)
    )
      return new URL(ref.name, url.origin + "/").href;
  } catch {
    /* Older references may have no usable original. */
  }
}
export function ThoughtSource({
  reference,
  excerpt,
}: {
  reference: ThoughtReference;
  excerpt?: string;
}) {
  const [preview, setPreview] = useState(false);
  const url = original(reference);
  return (
    <article className="thought-source">
      <strong>{reference.name}</strong> <small>{reference.account}</small>
      {excerpt && (
        <>
          <h4>Accepted excerpt</h4>
          <blockquote>{excerpt}</blockquote>
        </>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          Open in Memos
        </a>
      )}
      <details onToggle={(event) => setPreview(event.currentTarget.open)}>
        <summary>Live notebook preview</summary>
        {preview && (
          <RequestState
            query={WorkspaceApi.query("work", "thoughtDetail", {
              query: reference,
              timeToLive: "0 seconds",
            })}
          >
            {(item) => (
              <>
                <time dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleDateString()}
                </time>
                <p>{item.snippet}</p>
                <small>{item.tags.map((tag) => "#" + tag).join(" ")}</small>
              </>
            )}
          </RequestState>
        )}
      </details>
    </article>
  );
}
