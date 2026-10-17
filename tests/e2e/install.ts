import { cp, mkdir, mkdtemp } from "node:fs/promises";
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
  );
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
