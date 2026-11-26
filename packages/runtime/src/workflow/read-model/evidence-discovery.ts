import { Effect } from "effect";
import type {
  EvidenceHit,
  EvidenceKind,
  EvidenceSearch,
  EvidenceSearchPage,
} from "@abracode/contracts/visibility/discovery-contracts";
import type { ResourceSelection } from "@abracode/contracts/web/resources";
import { type Execution } from "../../domain.ts";
import type { RepositoryId, IssueId } from "@abracode/contracts/identities";
import type { Queries } from "../queries.ts";
import type { scanLeads } from "../leads/contracts.ts";
import { presentationHash } from "../../presentation/identity.ts";

type Reads = Pick<Queries, "execution" | "projects" | "searchOwners" | "diff" | "planDocuments">;
type Owner = { key: string; repository_id: RepositoryId; issue_id?: IssueId; title: string };
type Collect = (
  kind: EvidenceKind,
  identity: string,
  label: string,
  context: string,
  resource?: ResourceSelection,
  asset?: EvidenceHit["asset"],
) => void;
const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function retained(e: Execution, add: Collect) {
  const issue_id = e.issue_id;
  for (const build of e.visual_reports ?? []) {
    if (build.status !== "published" || !build.artifact) continue;
    const { hash, request_id } = build.artifact;
    add("report", request_id + "/" + hash, build.request.title ?? request_id, "Report · " + hash, {
      action: "open_artifact",
      issue_id,
      request_id,
      hash,
    });
  }
  for (const d of e.decisions ?? [])
    add("decision", d.key + "/" + d.generation, d.question, d.owner + " · " + d.status, {
      action: "open_decision",
      issue_id,
      key: d.key,
      generation: d.generation,
    });
  for (const w of e.waits ?? [])
    add(
      "wait",
      w.key + "/" + w.generation,
      w.condition,
      [w.owner, w.status, w.reference, w.evidence].filter(Boolean).join(" · "),
    );
  for (const f of [...(e.feedback?.findings ?? []), ...(e.feedback?.history ?? [])])
    add(
      "finding",
      f.id + "/" + f.revision,
      f.text,
      [f.kind, f.path, f.head].filter(Boolean).join(" · "),
      { action: "open_finding", issue_id, finding_id: f.id, revision: f.revision },
    );
  for (const c of e.check_history ?? [])
    add("check", c.fingerprint + "/" + c.at, c.commands.join(" · "), c.fingerprint);
  if (e.verification_receipt) {
    const c = e.verification_receipt;
    add(
      "check",
      c.fingerprint + "/" + c.at,
      c.commands.map((v) => (Array.isArray(v) ? v : v.argv).join(" ")).join(" · "),
      c.fingerprint,
    );
  }
  if (e.review_receipt) {
    const r = e.review_receipt;
    add(
      "review",
      r.session_id + "/" + r.fingerprint,
      r.findings || "Independent review",
      r.passed ? "Passed" : "Changes requested",
    );
  }
  for (const r of e.worker_evidence ?? [])
    add(r.kind, r.request_id + "/" + r.hash, r.description, r.path + " · " + r.hash, undefined, r);
  for (const m of e.messages ?? []) {
    const reply = m.type !== "finding" ? m.reply?.body : undefined;
    add(
      "communication",
      m.request_id + "/" + m.generation,
      m.body ?? (m.type === "finding" ? m.request_id : m.prompt),
      [m.role, m.sender_session_id, reply].filter(Boolean).join(" · "),
    );
  }
}

// A cursor names the next owner and the last returned identity within that owner.
// Insertions and removals before that key cannot shift a later page.
export function discoverEvidence(
  reads: Reads,
  leads: () => ReturnType<typeof scanLeads>,
  query: EvidenceSearch,
) {
  return Effect.gen(function* () {
    const wanted = (kind: EvidenceKind) => !query.kind || query.kind === kind;
    const needle = query.search?.trim().toLowerCase() ?? "";
    const coverage = new Set<string>();
    const entries: EvidenceHit[] = [];
    const limit = 12;
    const after = query.after_owner ?? "";
    const issues = yield* reads.searchOwners(
      after.startsWith("work/") ? after.slice(5) : "",
      query.repository_id,
      query.issue_id,
    );
    const projects = yield* reads.projects();
    const registered = new Set(projects.map((p) => p.id));
    const owners: Owner[] = [];
    if (!query.issue_id && wanted("proposal"))
      for (const p of projects) {
        if (!query.repository_id || p.id === query.repository_id)
          owners.push({ key: "repo/" + p.id, repository_id: p.id, title: p.id });
      }
    for (const i of issues)
      owners.push({
        key: "work/" + i.id,
        repository_id: i.repository_id,
        issue_id: i.id,
        title: i.title,
      });
    const ordered = owners.filter((o) => o.key >= after).sort((a, b) => order(a.key, b.key));
    const scan = wanted("lead") || wanted("proposal") ? yield* leads() : undefined;
    if (scan?.errors.length) coverage.add("Some lead registrations are unavailable.");
    let next: typeof EvidenceSearchPage.Type.next;
    for (const owner of ordered.slice(0, 4)) {
      const matches = new Map<string, EvidenceHit>();
      const { repository_id, issue_id } = owner;
      let largestKey = "";
      const add: Collect = (kind, identity, label, context, resource, asset) => {
        if (!registered.has(repository_id)) return;
        if (!wanted(kind) || (query.identity && query.identity !== identity)) return;
        const key = kind + "/" + identity;
        if (owner.key === after && query.after_entry && key <= query.after_entry) return;
        if (
          needle &&
          ![kind, identity, label, context, repository_id, issue_id, owner.title].some((v) =>
            v?.toLowerCase().includes(needle),
          )
        )
          return;
        if (matches.size === limit + 1 && order(key, largestKey) > 0) return;
        matches.set(key, {
          kind,
          identity,
          label: query.identity ? label : label.slice(0, 256),
          ...(query.identity && asset && { asset }),
          context: [owner.title, query.identity ? context : context.slice(0, 1024)]
            .filter(Boolean)
            .join(" · "),
          repository_id,
          ...(issue_id && { issue_id }),
          ...(resource && { resource }),
        });
        if (matches.size > limit + 1) {
          matches.delete(largestKey);
          largestKey = "";
          for (const retained of matches.keys())
            if (order(retained, largestKey) > 0) largestKey = retained;
        } else if (order(key, largestKey) > 0) largestKey = key;
      };
      for (const lead of scan?.records ?? []) {
        if (issue_id) {
          for (const m of lead.requests)
            if (m.issue_id === issue_id)
              add(
                "lead",
                lead.id + "/" + m.request.request_id + "/" + m.request.generation,
                m.request.body ?? m.request.prompt,
                [lead.id, m.request.status, m.request.reply?.body].filter(Boolean).join(" · "),
              );
        } else {
          for (const p of lead.proposals)
            for (const t of p.batch.tasks)
              if (t.repository_id === repository_id)
                add(
                  "proposal",
                  lead.id + "/" + p.request_id + "/" + p.revision + "/" + t.client_key,
                  t.title,
                  [lead.id, p.accepted ? "Accepted" : "Proposed", t.description].join(" · "),
                );
        }
      }
      if (issue_id && registered.has(repository_id)) {
        const record = yield* reads.execution(issue_id).pipe(Effect.result);
        if (record._tag === "Failure") coverage.add("Execution unavailable for " + issue_id);
        else if (record.success?.repository_id === repository_id) {
          const e = record.success;
          retained(e, add);
          if (wanted("file") && e.base_commit) {
            const result = yield* reads.diff(issue_id, "all", undefined, true).pipe(Effect.result);
            if (
              result._tag === "Failure" ||
              result.success.limited ||
              (result.success.message && !result.success.head)
            )
              coverage.add("Changed-file coverage is limited for " + issue_id);
            if (result._tag === "Success" && result.success.head)
              for (const f of result.success.files) {
                const head = result.success.head;
                add("file", presentationHash([f.path, head]), f.path, f.status + " · " + head, {
                  action: "open_changes",
                  issue_id,
                  head,
                  file: f.path,
                  scope: "all",
                });
              }
          }
          if (wanted("plan") && (e.worktree_directory || e.archive_path)) {
            const docs = yield* reads.planDocuments(e).pipe(Effect.result);
            if (docs._tag === "Failure" || docs.success.observation.limited)
              coverage.add("Planning document coverage is limited for " + issue_id);
            if (docs._tag === "Success")
              for (const file of docs.success.paths) {
                const doc = yield* docs.success.read(file).pipe(Effect.result);
                if (doc._tag === "Failure") {
                  coverage.add("A planning document is unavailable for " + issue_id);
                  continue;
                }
                const hash = presentationHash(doc.success);
                const pathHash = presentationHash(file);
                const lines = doc.success.split("\n");
                for (const [index, line] of lines.entries()) {
                  if (index && !line.trim()) continue;
                  const start = index + 1;
                  add(
                    "plan",
                    hash + "/" + pathHash + "/" + String(start).padStart(6, "0"),
                    file + " · " + start,
                    line,
                    {
                      action: "open_passage",
                      issue_id,
                      generation: e.control_generation,
                      hash,
                      file,
                      start,
                      end: start,
                    },
                  );
                }
              }
          }
        }
      }
      const sorted = [...matches].sort(([a], [b]) => order(a, b));
      const take = sorted.slice(0, limit - entries.length);
      entries.push(...take.map(([, hit]) => hit));
      if (take.length < sorted.length) {
        next = { after_owner: owner.key, after_entry: take.at(-1)?.[0] ?? "" };
        break;
      }
      const following = ordered[ordered.indexOf(owner) + 1];
      if (following) next = { after_owner: following.key, after_entry: "" };
      else next = undefined;
      if (entries.length === limit) break;
    }
    return { entries, next, coverage: [...coverage] };
  });
}
