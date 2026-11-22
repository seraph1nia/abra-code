import { useEffect, useEffectEvent, useState } from "react";
import { Schema } from "effect";
import { IssueId } from "@abracode/contracts/identities";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { Button } from "@abracode/presentation/ui/button";
import { writeRetained } from "./retained-input.ts";

const visit = Schema.Struct({ issue: IssueId, title: Schema.optional(Schema.String) });
function readVisits(key: string) {
  const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
  // Older rows also held verification and decision signatures. Only their IDs are needed.
  return Schema.decodeUnknownSync(Schema.Array(visit))(raw).slice(-20);
}

export function useRecordInspection(session: string, selected?: IssueId, title?: string) {
  const [writable, setWritable] = useState(true);
  const record = useEffectEvent((selected: IssueId) => {
    const key = "abra-recap-v1-" + session;
    try {
      const visits = readVisits(key);
      const previous = visits.find((row) => row.issue === selected);
      setWritable(
        writeRetained(
          key,
          [
            ...visits.filter((row) => row.issue !== selected),
            { issue: selected, title: title ?? previous?.title },
          ].slice(-20),
        ),
      );
    } catch {
      setWritable(false);
    }
  });
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Report the result of the external storage write for this explicit route visit.
    if (selected) record(selected);
  }, [session, selected]);
  return writable;
}

export function RecentlyInspected({
  session,
  work,
  open,
  writable,
}: {
  session: string;
  writable: boolean;
  work: readonly WebWorkItem[];
  open: (id: string) => void;
}) {
  const [visits] = useState(() => {
    try {
      return readVisits("abra-recap-v1-" + session).reverse();
    } catch {
      return undefined;
    }
  });
  return (
    <section className="recently-inspected" aria-label="Recently inspected tasks">
      {!visits || !writable ? (
        <p>Local reading history is unavailable.</p>
      ) : !visits.length ? (
        <p>Inspect a task to start reading history on this device.</p>
      ) : (
        <ul>
          {visits.map((row) => (
            <li key={row.issue}>
              <Button variant="link" onClick={() => open(row.issue)}>
                {work.find((w) => w.issue_id === row.issue)?.title ?? row.title ?? row.issue}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
