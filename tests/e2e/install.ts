import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
export const command = promisify(execFile);
export async function installationRoot(prefix: string) {
  const parent = process.env.ABRACODE_TEST_INSTALL_ROOT ?? join(homedir(), ".cache/abracode-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}

/** Install current source into a disposable checkout using only the frozen supplier cache. */
export async function installSource(home: string) {
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "vite.config.ts",
    "abracode.example.yaml",
    "abracode.schema.json",
    ".gitignore",
    "LICENSE",
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "THIRD_PARTY_NOTICES.md",
    "docs",
    "licenses",
    "src",
    "scripts",
    ".opencode",
    ".agents",
    "templates",
  ])
    await cp(resolve(path), join(home, path), {
      recursive: true,
      filter: (path) => !/\/(?:node_modules|dist|\.vite)(?:\/|$)/.test(path),
    });
  const { stdout } = await command("pnpm", ["store", "path"], { cwd: process.cwd() });
  await command(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--prod=false",
      "--offline",
      "--package-import-method",
      "copy",
      "--store-dir",
      stdout.trim(),
    ],
    { cwd: home, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
  ).catch((cause: unknown) => {
    if (cause instanceof Error)
      throw new Error(
        `${cause.message}\n${String(Reflect.get(cause, "stdout") ?? "").slice(-8000)}\n${String(Reflect.get(cause, "stderr") ?? "").slice(-8000)}\ncode=${String(Reflect.get(cause, "code"))} signal=${String(Reflect.get(cause, "signal"))}`,
        { cause },
      );
    throw cause;
  });
  if (process.env.ABRACODE_TEST_METRICS === "1") {
    await mkdir(join(home, "tests/operational"), { recursive: true });
    await cp(resolve("tests/operational/metrics.ts"), join(home, "tests/operational/metrics.ts"));
    await cp(resolve("tests/operational/faults.ts"), join(home, "tests/operational/faults.ts"));
    const processPath = join(home, "src/process.ts");
    const processSource = await readFile(processPath, "utf8");
    const processAnchor = "let stdoutSize = 0,";
    if (!processSource.includes(processAnchor))
      throw Error("Native report process fixture seam changed");
    await writeFile(
      processPath,
      'import { recordReportChild } from "../tests/operational/metrics.ts";\n' +
        processSource.replace(
          processAnchor,
          "recordReportChild(Number(child.pid), file, args);\n            " + processAnchor,
        ),
    );
    const path = join(home, "src/opencode/application.ts");
    const source = await readFile(path, "utf8");
    const anchor = "yield* Effect.addFinalizer(() => application.controller.close());";
    if (!source.includes(anchor)) throw Error("Native metrics fixture seam changed");
    await writeFile(
      path,
      'import { measureApplication } from "../../tests/operational/metrics.ts";\n' +
        source.replace(anchor, anchor + "\n      measureApplication(application);"),
    );
    const plugin = join(home, ".opencode/plugins/abracode/index.ts");
    const entry = await readFile(plugin, "utf8");
    const monitor = "monitor(ctx, c, application.scheduler)";
    if (!entry.includes(monitor)) throw Error("Native event fixture seam changed");
    await writeFile(
      plugin,
      'import { faultEvents } from "../../../tests/operational/faults.ts";\n' +
        entry.replace(monitor, "monitor(faultEvents(ctx), c, application.scheduler)"),
    );
  }
}

/** Exercise the normal interactive entry point through util-linux's disposable PTY. */
export async function interactiveLaunch(home: string, env: NodeJS.ProcessEnv) {
  const { spawn } = await import("node:child_process");
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const child = spawn(
    "script",
    [
      "--quiet",
      "--return",
      "--command",
      `${quote(join(home, "node_modules/.bin/tsx"))} ${quote(join(home, "scripts/launch.ts"))}`,
      "/dev/null",
    ],
    { cwd: home, env: { ...env, TERM: "xterm-256color" }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  const ended = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  try {
    const deadline = Date.now() + 30_000;
    while (!output.includes("Talk to Abra")) {
      if (child.exitCode !== null || Date.now() >= deadline)
        throw new Error(
          `Interactive Abra launch did not render its footer: ${output.slice(-3000)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    // Native quit input leaves the retained background service running.
    child.stdin.write("\u0003\u0003");
    const timer = setTimeout(() => child.kill("SIGTERM"), 3000);
    try {
      await ended;
    } finally {
      clearTimeout(timer);
    }
  }
}
