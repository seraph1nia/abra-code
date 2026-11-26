import { Effect } from "effect";
import { timestamp } from "@abracode/contracts/identities";
import { BindingReadQuery, selectBindingRows } from "@abracode/contracts/web/bindings";
import type { Queries } from "../workflow/queries.ts";
import { decode } from "../decode.ts";
import { bindRetainedWork, retainedWork } from "./projections.ts";
export const readBindings = (queries: Queries, input: typeof BindingReadQuery.Type) =>
  Effect.gen(function* () {
    const query = yield* decode(BindingReadQuery, input, "Work binding read");
    const explicit = [...new Set(query.issue_ids)];
    const population = query.include_population ? yield* queries.bindingPopulation() : undefined;
    const requested = [...new Set([...explicit, ...(population?.ids ?? [])])].slice(0, 100);
    const results = yield* Effect.forEach(
      requested,
      (id) =>
        queries.observeTask(id).pipe(
          Effect.map((task) => ({
            issue_id: id,
            status: task.execution_unavailable ? ("unavailable" as const) : ("available" as const),
            task,
          })),
          Effect.catch((error) =>
            Effect.succeed({
              issue_id: id,
              status:
                error.code === "ISSUE_MISSING" ? ("missing" as const) : ("unavailable" as const),
              task: undefined,
            }),
          ),
        ),
      { concurrency: 4 },
    );
    const work = results.flatMap(({ task }) =>
      task
        ? [
            bindRetainedWork(
              retainedWork(
                queries.settings.supervisionMode,
                task.issue,
                task.execution,
                undefined,
                task.closed_at,
              ),
              task.execution,
              task.issue,
              Date.parse(task.source.captured_at),
            ),
          ]
        : [],
    );
    const selected = selectBindingRows(
      { ids: explicit, unfiltered: !!query.include_population },
      work,
      population?.total,
    );
    const unavailable = results.some((entry) => entry.status !== "available");
    return {
      ...(population?.capacity && { capacity: population.capacity }),
      work: selected.rows,
      coverage: {
        ...selected.coverage,
        unavailable_ids: [
          ...new Set([
            ...selected.coverage.unavailable_ids,
            ...results
              .filter((entry) => explicit.includes(entry.issue_id) && entry.status !== "available")
              .map((entry) => entry.issue_id),
          ]),
        ],
        status: unavailable ? ("unavailable" as const) : selected.coverage.status,
      },
      results: results
        .filter((entry) => explicit.includes(entry.issue_id))
        .map(({ issue_id, status }) => ({ issue_id, status })),
      observed_at: yield* timestamp,
      ...(population ? { work_revision: population.work_revision } : {}),
    };
  });
