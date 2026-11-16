import { spawn, type ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const requested = Number(process.env.ABRACODE_TEST_WORKERS ?? Math.min(12, availableParallelism()));
if (!Number.isSafeInteger(requested) || requested < 1)
  throw Error("ABRACODE_TEST_WORKERS must be a positive integer");
const budget = Math.min(availableParallelism(), requested);
const reports = process.env.ABRACODE_TEST_REPORT_DIR;
if (reports) await mkdir(reports, { recursive: true });
const children = new Set<ChildProcess>();
let interrupted = false;
const stop = () => {
  interrupted = true;
  for (const child of children) child.kill("SIGINT");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

async function run(file: string, args: string[], env = process.env) {
  if (interrupted) return 130;
  const child = spawn(file, args, { stdio: "inherit", env });
  children.add(child);
  try {
    return await new Promise<number>((done, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => done(code ?? 1));
    });
  } finally {
    children.delete(child);
  }
}

const started = performance.now();
const build = await run("pnpm", ["web:build"]);
if (build) process.exitCode = build;
else {
  // A global longest-first queue can otherwise start only native services and
  // compilers. Reserve workers so controller tests make progress alongside them.
  const core = Math.max(1, Math.floor(budget / 4));
  const integration = Math.max(1, Math.floor(budget / 6));
  const plans =
    budget < 3
      ? [{ name: "all", projects: ["fast", "unit", "integration", "e2e"], workers: budget }]
      : [
          { name: "core", projects: ["fast", "unit"], workers: core },
          { name: "integration", projects: ["integration"], workers: integration },
          { name: "e2e", projects: ["e2e"], workers: budget - core - integration },
        ];
  console.log(
    `Complete test worker budget: ${plans.map((p) => `${p.name}=${p.workers}`).join(", ")}`,
  );
  const results = await Promise.all(
    plans.map(async (plan) => {
      const start = performance.now();
      const code = await run(
        process.execPath,
        [
          resolve("node_modules/vite-plus/bin/vp"),
          "test",
          "run",
          ...plan.projects.flatMap((project) => ["--project", project]),
          ...(reports
            ? [
                "--reporter=default",
                "--reporter=json",
                `--outputFile=${join(resolve(reports), `${plan.name}.json`)}`,
              ]
            : []),
          ...process.argv.slice(2),
        ],
        {
          ...process.env,
          ABRACODE_TEST_WORKERS: String(plan.workers),
          ABRACODE_TEST_WEB_ASSETS: resolve("apps/web/dist"),
          RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? "1",
        },
      );
      console.log(
        `${plan.name}: ${code ? "FAIL" : "PASS"} in ${((performance.now() - start) / 1000).toFixed(2)}s`,
      );
      return code;
    }),
  );
  process.exitCode = results.some((code) => code !== 0) ? 1 : 0;
}
console.log(`Complete test wall time: ${((performance.now() - started) / 1000).toFixed(2)}s`);
