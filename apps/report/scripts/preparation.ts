import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDiagramRenderer } from "./diagrams.ts";
import {
  diagramBudget,
  diagramSourcePolicy,
  diagramLimits,
  type DiagramInput,
  type DiagramPreparation,
  type DiagramResult,
} from "@abracode/contracts/presentation/diagrams";

type Renderer = Awaited<ReturnType<typeof createDiagramRenderer>>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const identity = async () =>
  hash(
    (
      await Promise.all([
        readFile(new URL("./mermaid-engine.ts", import.meta.url), "utf8"),
        readFile(new URL("./diagrams.ts", import.meta.url), "utf8"),
        readFile(new URL("./preparation.ts", import.meta.url), "utf8"),
        readFile(
          new URL("../../../packages/contracts/src/presentation/diagrams.ts", import.meta.url),
          "utf8",
        ),
        readFile(new URL("../node_modules/mermaid/package.json", import.meta.url), "utf8"),
        readFile(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8"),
      ])
    ).join("\n"),
  );

/** One service owner, with an existing renderer seam for bounded resource tests. */
export class DiagramPreparer {
  private active = 0;
  private queue: Array<() => void> = [];
  private cache = new Map<string, string>();
  private bytes = 0;
  private pending = new Map<string, Promise<string>>();
  private compiler: Promise<string>;
  readonly metrics = { launches: 0, compilations: 0, hits: 0 };
  constructor(
    private options: {
      factory?: () => Promise<Renderer>;
      compiler?: string;
      deadlineMs?: number;
    } = {},
  ) {
    this.compiler = options.compiler ? Promise.resolve(options.compiler) : identity();
  }
  private remember(key: string, svg: string) {
    const size = Buffer.byteLength(svg);
    if (size > 32 * 1024 * 1024) return;
    this.cache.set(key, svg);
    this.bytes += size;
    while (this.cache.size > 128 || this.bytes > 32 * 1024 * 1024) {
      const first = this.cache.keys().next().value!;
      this.bytes -= Buffer.byteLength(this.cache.get(first)!);
      this.cache.delete(first);
    }
  }
  async prepare(
    inputs: readonly DiagramInput[],
    signal?: AbortSignal,
  ): Promise<DiagramPreparation> {
    const compiler = await this.compiler;
    const error = (status: DiagramResult["status"], message: string): DiagramPreparation => ({
      compiler,
      verified: false,
      assets: [],
      results: inputs.slice(0, 32).map(({ id }) => ({ id, status, message })),
    });
    const budget = diagramBudget(inputs);
    if (budget) return error("limit", budget);
    if (signal?.aborted) return error("unavailable", "Diagram preparation canceled");
    if (this.active >= 2 && this.queue.length >= 8)
      return error("busy", "Diagram preparation queue is full");
    let renderer: Promise<Renderer> | undefined;
    let started = false,
      expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queued: (() => void) | undefined;
    const cleanup = async () => {
      if (renderer)
        await renderer.then(
          (r) => r.close(),
          () => {},
        );
    };
    const run = async (): Promise<DiagramPreparation> => {
      if (this.active >= 2)
        await new Promise<void>((resolve) => {
          queued = resolve;
          this.queue.push(resolve);
        });
      if (expired) return error("timeout", "Diagram preparation exceeded its deadline");
      started = true;
      this.active++;
      const metrics = { compilations: 0, launches: 0, hits: 0 };
      const results: DiagramResult[] = [],
        assets: DiagramPreparation["assets"][number][] = [];
      try {
        for (const input of inputs) {
          if (expired) break;
          const policy = diagramSourcePolicy(input.source);
          if (policy) {
            results.push({ id: input.id, status: "forbidden", message: policy });
            continue;
          }
          try {
            const key = hash(compiler + "\n" + input.source);
            let svg = this.cache.get(key);
            if (svg !== undefined) {
              this.metrics.hits++;
              metrics.hits++;
              this.cache.delete(key);
              this.cache.set(key, svg);
            } else {
              let pending = this.pending.get(key);
              if (!pending) {
                pending = (async () => {
                  if (!renderer) {
                    this.metrics.launches++;
                    metrics.launches++;
                    renderer = (this.options.factory ?? createDiagramRenderer)().catch((error) => {
                      throw new Error(
                        `UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    });
                  }
                  const active = await renderer;
                  if (expired)
                    throw new Error("TIMEOUT: Diagram preparation exceeded its deadline");
                  this.metrics.compilations++;
                  metrics.compilations++;
                  const compiled = await active.render(input.source);
                  if (Buffer.byteLength(compiled) > diagramLimits.output)
                    throw new Error("LIMIT: Prepared diagram exceeds 8 MiB");
                  if (!expired) this.remember(key, compiled);
                  return compiled;
                })();
                this.pending.set(key, pending);
                void pending
                  .finally(() => {
                    if (this.pending.get(key) === pending) this.pending.delete(key);
                  })
                  .catch(() => {});
              }
              svg = await pending;
            }
            assets.push({ ...input, svg });
            if (Buffer.byteLength(JSON.stringify(assets)) > diagramLimits.output)
              return error("limit", "Prepared diagrams exceed 8 MiB");
            results.push({
              id: input.id,
              status: "verified",
              message:
                "Parsed, rendered and checked; factual correctness and readability are not verified.",
            });
          } catch (cause) {
            const detail = cause instanceof Error ? cause.message : String(cause);
            const status = detail.includes("SYNTAX:")
              ? "syntax"
              : detail.includes("FORBIDDEN:")
                ? "forbidden"
                : detail.includes("LIMIT:")
                  ? "limit"
                  : detail.includes("TIMEOUT:")
                    ? "timeout"
                    : /UNAVAILABLE:|Could not launch/.test(detail)
                      ? "unavailable"
                      : "render";
            const line = /(?:line |line: ?)(\d+)/i.exec(detail)?.[1];
            results.push({
              id: input.id,
              status,
              message: detail
                .replace(/https?:\/\/[^\s)]+|(?:[A-Za-z]:)?\/(?:[^\s/:]+\/)+[^\s:]*/g, "[resource]")
                .slice(0, 2048),
              ...(line ? { line: Number(line) } : {}),
            });
          }
        }
        const prepared = {
          compiler,
          verified:
            results.length === inputs.length && results.every((r) => r.status === "verified"),
          results,
          assets,
          metrics,
        };
        if (Buffer.byteLength(JSON.stringify(prepared)) > diagramLimits.output)
          return error("limit", "Prepared diagrams and diagnostics exceed 8 MiB");
        return prepared;
      } finally {
        await cleanup();
        this.active--;
        this.queue.shift()?.();
      }
    };
    const work = run();
    const timeout = new Promise<DiagramPreparation>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        if (!started && queued) {
          const i = this.queue.indexOf(queued);
          if (i >= 0) this.queue.splice(i, 1);
          queued();
        }
        void cleanup().catch(() => {});
        resolve(error("timeout", "Diagram preparation exceeded its 60-second deadline"));
      }, this.options.deadlineMs ?? 60000);
    });
    // Caller cancellation detaches only this waiter; shared compilation keeps its bounded deadline.
    let detach: (() => void) | undefined;
    const canceled = new Promise<DiagramPreparation>((resolve) => {
      detach = () => resolve(error("unavailable", "Diagram preparation canceled"));
      signal?.addEventListener("abort", detach, { once: true });
    });
    void work
      .finally(() => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", detach!);
      })
      .catch(() => {});
    return Promise.race([work, timeout, canceled]);
  }
}

export const diagramPreparer = new DiagramPreparer();
