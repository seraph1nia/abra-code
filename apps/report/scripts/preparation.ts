import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDiagramRenderer } from "./diagrams.ts";
import { DiagramBatch } from "./diagram-batch.ts";
type Renderer = Awaited<ReturnType<typeof createDiagramRenderer>>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const identity = async () =>
  hash(
    (
      await Promise.all([
        readFile(new URL("./mermaid-engine.ts", import.meta.url), "utf8"),
        readFile(new URL("./diagrams.ts", import.meta.url), "utf8"),
        readFile(new URL("./diagram-batch.ts", import.meta.url), "utf8"),
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

export class DiagramPreparer extends DiagramBatch {
  constructor(
    options: { factory?: () => Promise<Renderer>; compiler?: string; deadlineMs?: number } = {},
  ) {
    super({
      ...options,
      factory: options.factory ?? createDiagramRenderer,
      compiler: options.compiler ?? identity(),
    });
  }
}
export const diagramPreparer = new DiagramPreparer();

export type { createPreparedDiagrams } from "./prepared-diagram-host.ts";
