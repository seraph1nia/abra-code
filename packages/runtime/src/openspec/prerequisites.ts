import { Graph } from "effect";
import type { ArtifactId } from "@abracode/contracts/identities";
import { ensure } from "../domain.ts";
import type { SpecStatus, ApplyStatus } from "./contracts.ts";

/** Interpret the native artifact graph; do not infer completion from filenames. */
export function planningPrerequisites(status: SpecStatus) {
  ensure(
    status.artifacts.length > 0 &&
      status.artifacts.length <= 128 &&
      status.applyRequires.length > 0,
    "PLAN_INCOMPLETE",
    "Native implementation prerequisites are missing or excessive",
  );
  const artifacts = new Map(status.artifacts.map((a) => [a.id, a]));
  ensure(
    artifacts.size === status.artifacts.length,
    "PLAN_INCOMPLETE",
    "Native artifact identities must be unique",
  );
  const nodes = new Map<ArtifactId, Graph.NodeIndex>();
  const roots: Graph.NodeIndex[] = [];
  const graph = Graph.directed<ArtifactId, undefined>((graph) => {
    function include(id: ArtifactId): Graph.NodeIndex {
      const existing = nodes.get(id);
      if (existing !== undefined) return existing;
      const artifact = artifacts.get(id);
      ensure(
        artifact && Array.isArray(artifact.requires),
        "PLAN_INCOMPLETE",
        `Native prerequisite ${id} or its dependency list is missing`,
      );
      ensure(
        artifact.status === "done" || artifact.status === "skipped",
        "PLAN_INCOMPLETE",
        `Native prerequisite ${id} is ${artifact.status}; complete it or use a supported native omission`,
      );
      const node = Graph.addNode(graph, id);
      nodes.set(id, node);
      for (const required of artifact.requires)
        Graph.addEdge(graph, node, include(required), undefined);
      return node;
    }
    for (const id of status.applyRequires) roots.push(include(id));
  });
  ensure(Graph.isAcyclic(graph), "PLAN_INCOMPLETE", "Native artifact dependencies contain a cycle");
  return [...Graph.values(Graph.dfsPostOrder(graph, { start: roots }))];
}
export function trackedImplementation(apply: ApplyStatus) {
  ensure(
    apply.state !== "blocked" &&
      apply.taskTrackingConfigured &&
      apply.progress.total > 0 &&
      apply.tasks.length === apply.progress.total &&
      new Set(apply.tasks.map((task) => task.id)).size === apply.tasks.length &&
      apply.tasks.filter((task) => task.done).length === apply.progress.complete,
    "PLAN_INCOMPLETE",
    "Apply prerequisites or consistent implementation task tracking are missing",
  );
}
