import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  symlink,
  realpath,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { homedir } from "node:os";
import { join, resolve, relative } from "node:path";
export const command = promisify(execFile);
export async function installationRoot(prefix: string) {
  const parent = process.env.ABRACODE_TEST_INSTALL_ROOT ?? join(homedir(), ".cache/abracode-tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, prefix));
}

/** Materialize only the trusted renderer's installed dependency closure. Other
 * tools keep immutable links; every renderer input resolves inside the fixture. */
async function rendererSuppliers(includeWeb: boolean) {
  const store = await realpath(resolve("node_modules/.pnpm"));
  const selected = new Set<string>();
  const visit = async (path: string) => {
    const actual = await realpath(path);
    if (!actual.startsWith(store + "/")) return;
    const entry = join(store, relative(store, actual).split("/")[0]!);
    if (selected.has(entry)) return;
    selected.add(entry);
    await dependencies(join(entry, "node_modules"));
  };
  const dependencies = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) await visit(path);
      else if (entry.name.startsWith("@") && entry.isDirectory()) await dependencies(path);
    }
  };
  await visit(resolve("node_modules/vite-plus"));
  for (const workspace of [
    "apps/report",
    "packages/presentation",
    "packages/contracts",
    ...(includeWeb ? ["apps/web"] : []),
  ])
    await dependencies(resolve(workspace, "node_modules"));
  return selected;
}

/** Prepare private current source and suppliers; fresh mode exercises the frozen offline install. */
export async function installSource(
  home: string,
  options: { buildWeb?: boolean; fresh?: boolean; sharedSuppliers?: boolean } = {},
) {
  const preparedWeb =
    !options.fresh && options.buildWeb !== false ? process.env.ABRACODE_TEST_WEB_ASSETS : undefined;
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
    "scripts",
    ".opencode",
    ".agents",
    "apps",
    "packages",
  ])
    await cp(resolve(path), join(home, path), {
      recursive: true,
      filter: (path) => !/\/(?:node_modules|dist|\.vite)(?:\/|$)/.test(path),
    });
  if (!options.fresh) {
    // No hooks run against shared suppliers. Compiler inputs get private bytes;
    // protocol-only fixtures can share the entire immutable external store.
    const installation = await realpath(resolve("."));
    const privateEntries = options.sharedSuppliers
      ? new Set<string>()
      : await rendererSuppliers(options.buildWeb !== false && !preparedWeb);
    const store = join(installation, "node_modules/.pnpm");
    const links = async (from: string, to: string) => {
      await mkdir(to, { recursive: true });
      for (const entry of await readdir(from, { withFileTypes: true })) {
        // Generated task/compiler caches must be allocated by this installation.
        if (
          !entry.isFile() &&
          entry.name.startsWith(".") &&
          ![".bin", ".pnpm"].includes(entry.name)
        )
          continue;
        const input = join(from, entry.name),
          output = join(to, entry.name);
        if (entry.name === ".bin") await cp(input, output, { recursive: true });
        else if (entry.isFile()) await cp(input, output);
        else if (input === store && privateEntries.size) {
          await mkdir(output);
          for (const child of await readdir(input)) {
            const path = join(input, child);
            if (!privateEntries.has(path)) await symlink(path, join(output, child));
          }
        } else if (entry.name.startsWith("@") && entry.isDirectory()) await links(input, output);
        else {
          const actual = await realpath(input),
            local = relative(installation, actual);
          const workspace = /^(?:packages|apps)[/\\][^/\\]+$/.test(local);
          const supplier =
            actual.startsWith(store + "/") &&
            privateEntries.has(join(store, relative(store, actual).split("/")[0]!));
          await symlink(workspace || supplier ? join(home, local) : actual, output);
        }
      }
    };
    const workspaces = ["."];
    for (const parent of ["apps", "packages"])
      for (const entry of await readdir(resolve(parent), { withFileTypes: true }))
        if (entry.isDirectory()) workspaces.push(join(parent, entry.name));
    await Promise.all(
      workspaces.map(async (path) => {
        const source = resolve(path, "node_modules");
        const exists = await readdir(source).then(
          () => true,
          () => false,
        );
        if (exists) {
          const target = join(home, path, "node_modules");
          await links(source, target);
        }
      }),
    );
    if (privateEntries.size)
      await command("cp", [
        "-a",
        "--reflink=auto",
        ...privateEntries,
        join(home, "node_modules/.pnpm"),
      ]);
  } else {
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
  }
  if (preparedWeb) await cp(preparedWeb, join(home, "apps/web/dist"), { recursive: true });
  else if (options.buildWeb !== false)
    await command("pnpm", ["web:build"], { cwd: home, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (process.env.ABRACODE_TEST_METRICS === "1") {
    await mkdir(join(home, "packages/runtime/tests/operational"), { recursive: true });
    await cp(
      resolve("packages/runtime/tests/operational/metrics.ts"),
      join(home, "packages/runtime/tests/operational/metrics.ts"),
    );
    await cp(
      resolve("packages/runtime/tests/operational/faults.ts"),
      join(home, "packages/runtime/tests/operational/faults.ts"),
    );
    const processPath = join(home, "packages/runtime/src/process.ts");
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
    const path = join(home, "packages/runtime/src/opencode/application.ts");
    const source = await readFile(path, "utf8");
    const anchor = "  return {\n    controller,";
    const end = "  };\n}\nexport class Crew";
    if (!source.includes(anchor) || !source.includes(end))
      throw Error("Native metrics fixture seam changed");
    await writeFile(
      path,
      'import { measureApplication } from "../../tests/operational/metrics.ts";\n' +
        source
          .replace(anchor, "  const application = {\n    controller,")
          .replace(
            end,
            "  };\n  measureApplication(application, { runtime, records, messages, locks, renderer: reports.exports.renderer, attention });\n  return application;\n}\nexport class Crew",
          ),
    );
    const plugin = join(home, "packages/runtime/src/plugin/index.ts");
    const entry = await readFile(plugin, "utf8");
    const monitor = "monitor(ctx, c, application.scheduler)";
    if (!entry.includes(monitor)) throw Error("Native event fixture seam changed");
    await writeFile(
      plugin,
      'import { faultEvents } from "../../tests/operational/faults.ts";\n' +
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
    // Verify the native host's agent/model line, which cannot match bootstrap output.
    // AbraCode no longer provides a custom terminal footer.
    while (!/Abra\s*·[\s\S]{0,100}?OpenCode/.test(stripVTControlCharacters(output))) {
      if (child.exitCode !== null || Date.now() >= deadline)
        throw new Error(
          `Interactive Abra launch did not render the native conversation: ${output.slice(-3000)}`,
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
