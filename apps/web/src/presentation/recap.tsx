import { useEffect, useRef, useState } from "react";
import { Schema } from "effect";
import type { WebWorkItem } from "@abracode/contracts/web/wire";
import { IssueId } from "@abracode/contracts/identities";
import { Button } from "@abracode/presentation/ui/button";
import { writeRetained } from "../retained-input.ts";

const cursor = Schema.Struct({ issue: IssueId, result: Schema.String, decisions: Schema.String });
const cursors = Schema.Array(cursor).check(Schema.isMaxLength(20));
function material(w: WebWorkItem) {
  return {
    issue: w.issue_id,
    result: JSON.stringify([
      w.last_check,
      w.review_result,
      w.latest_evidence,
      w.outcome?.delivered_commit,
      w.outcome?.delivery.state,
      w.outcome?.closure,
    ]),
    decisions: JSON.stringify(
      w.decisions
        ?.map((d) => [d.key, d.generation, d.status])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ?? [],
    ),
  };
}
function read(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return { rows: raw ? Schema.decodeUnknownSync(cursors)(JSON.parse(raw)) : [], available: true };
  } catch {
    return { rows: [], available: false };
  }
}
export function Recap({
  initiallyOpen,
  session,
  work,
  selected,
  view,
  tab,
  open,
}: {
  initiallyOpen?: boolean;
  session: string;
  work: readonly WebWorkItem[];
  selected?: string;
  view: string;
  tab: string;
  open: (issue: string, tab: string) => void;
}) {
  const key = "abra-recap-v1-" + session;
  const [history, setHistory] = useState(() => read(key));
  const lastVisit = useRef("");
  const selectedWork = work.find((w) => w.issue_id === selected);
  useEffect(() => {
    if (!selected) {
      lastVisit.current = "";
      return;
    }
    if (!selectedWork || lastVisit.current === view) return;
    lastVisit.current = view;
    const current = read(key);
    const prior = current.rows.find((r) => r.issue === selected);
    const next = material(selectedWork);
    if (prior && tab !== "Verification" && tab !== "Reports") next.result = prior.result;
    if (prior && tab !== "Overview") next.decisions = prior.decisions;
    const rows = [...current.rows.filter((r) => r.issue !== selected), next].slice(-20);
    setHistory({ rows, available: current.available && writeRetained(key, rows) });
  }, [key, view, tab, selected, selectedWork]);
  const changes = history.rows.flatMap((prior) => {
    const w = work.find((w) => w.issue_id === prior.issue);
    if (!w) return [];
    const next = material(w);
    return [
      ...(prior.result !== next.result
        ? [{ issue: w.issue_id, title: w.title, what: "Verification result", tab: "Verification" }]
        : []),
      ...(prior.decisions !== next.decisions
        ? [{ issue: w.issue_id, title: w.title, what: "Decision updated", tab: "Overview" }]
        : []),
    ];
  });
  return (
    <details className="work-recap" open={initiallyOpen || undefined}>
      <summary>Since your last inspection{changes.length ? " · " + changes.length : ""}</summary>
      <p>
        {!history.available
          ? "Local reading history is unavailable."
          : history.rows.length
            ? `Comparing observed results and decisions for up to 20 recently inspected tasks on this device. Currently observed: ${work.filter((w) => history.rows.some((r) => r.issue === w.issue_id)).length}.`
            : "Inspect a task to start reading history on this device."}
      </p>
      {changes.map((item) => (
        <Button
          key={item.issue + item.tab}
          variant="outline"
          onClick={() => open(item.issue, item.tab)}
        >
          {item.what} · {item.title}
        </Button>
      ))}
    </details>
  );
}
