import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CrewError, type Config } from "../domain.ts";

export const memoryVersion = "1.0.0";
const unavailable = () =>
  new CrewError(
    "MEMORY_UNAVAILABLE",
    "Check the local Basic Memory 1.0.0 executable and installation directory, then retry.",
  );
export const memoryError = (cause: unknown) => (cause instanceof CrewError ? cause : unavailable());
const exec = promisify(execFile);
const contains = (parent: string, child: string) =>
  parent === child || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path) throw cause;
    return join(await physicalPath(dirname(path)), basename(path));
  }
}

export async function memoryDirectory(config: Config, projects: readonly string[]) {
  const settings = config.memory;
  if (!settings?.enabled)
    throw new CrewError("MEMORY_DISABLED", "Enable memory in personal settings.");
  const root = await physicalPath(resolve(settings.directory));
  for (const path of [
    config.home,
    config.repository_root,
    config.worktree_root,
    ...projects,
    ...config.repositories.flatMap((r) => (r.path ? [r.path] : [])),
  ]) {
    const other = await physicalPath(path);
    if (contains(root, other) || contains(other, root))
      throw new CrewError(
        "MEMORY_LOCATION",
        "Choose a dedicated memory directory outside all managed checkouts and worktrees.",
      );
  }
  for (const folder of [
    root,
    ...["home", "config", "vault", "receipts"].map((name) => join(root, name)),
  ]) {
    if ((await physicalPath(folder)) !== folder)
      throw new CrewError(
        "MEMORY_LOCATION",
        "Memory directories must stay inside the configured installation.",
      );
    await mkdir(folder, { recursive: true, mode: 0o700 });
  }
  return root;
}
function environment(root: string) {
  return {
    HOME: join(root, "home"),
    BASIC_MEMORY_CONFIG_DIR: join(root, "config"),
    BASIC_MEMORY_PROJECT_ROOT: join(root, "vault"),
    BASIC_MEMORY_FORCE_LOCAL: "true",
    BASIC_MEMORY_DATABASE_BACKEND: "sqlite",
    BASIC_MEMORY_SEMANTIC_EMBEDDING_PROVIDER: "fastembed",
    BASIC_MEMORY_SEMANTIC_EMBEDDING_MODEL: "bge-small-en-v1.5",
    BASIC_MEMORY_LOGFIRE_SEND_TO_LOGFIRE: "false",
    BASIC_MEMORY_LOGFIRE_ENABLED: "false",
    BASIC_MEMORY_RERANKER_ENABLED: "false",
    BASIC_MEMORY_WATCH_PROJECT_RELOAD_INTERVAL: "2",
    HF_HUB_OFFLINE: "1",
    HF_HOME: join(root, "home", ".cache", "huggingface"),
    FASTEMBED_CACHE_PATH: join(root, "config", "fastembed_cache"),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
  };
}
export async function checkMemoryVersion(executable: string, root: string, signal?: AbortSignal) {
  const result = await exec(executable, ["--version"], {
    env: environment(root),
    cwd: root,
    timeout: 8000,
    maxBuffer: 8192,
    signal,
  });
  if (result.stdout.trim() !== "Basic Memory version: " + memoryVersion) throw unavailable();
}

/** One lazily connected stdio client per runtime scope. A dead child is discarded on close. */
export class MemoryProvider {
  private opening?: Promise<Client>;
  private stopped = false;
  private lifecycle = new AbortController();
  constructor(private executable: string) {}
  private connect(root: string) {
    if (this.stopped) throw unavailable();
    if (this.opening) return this.opening;
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(20_000)]);
    const opening = (async () => {
      await checkMemoryVersion(this.executable, root, signal);
      signal.throwIfAborted();
      const transport = new StdioClientTransport({
        command: this.executable,
        args: ["mcp", "--transport", "stdio"],
        env: environment(root),
        cwd: root,
        stderr: "ignore",
      });
      const client = new Client({ name: "abracode-memory", version: "1" });
      client.onclose = () => {
        if (this.opening === opening) this.opening = undefined;
      };
      try {
        await client.connect(transport, { signal, timeout: 15_000 });
        const { tools } = await client.listTools(undefined, { signal, timeout: 5000 });
        if (
          !["bm_project", "bm_read", "bm_search", "bm_write"].every((name) =>
            tools.some((t) => t.name === name),
          )
        )
          throw unavailable();
        return client;
      } catch (cause) {
        await transport.close();
        throw cause;
      }
    })();
    this.opening = opening;
    void opening.catch(() => {
      if (this.opening === opening) this.opening = undefined;
    });
    return opening;
  }
  async call(root: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    signal.throwIfAborted();
    const client = await this.connect(root);
    signal.throwIfAborted();
    const result = await client.callTool(
      { name, arguments: { ...args, output_format: "json" } },
      undefined,
      { signal, timeout: 15_000 },
    );
    if (result.isError) {
      const block = Array.isArray(result.content) ? result.content[0] : undefined;
      let code: unknown;
      try {
        code = JSON.parse(block?.text).error;
      } catch {
        /* A model-load failure has plain text. */
      }
      if (code === "ALREADY_EXISTS" || code === "REVISION_CONFLICT")
        throw new CrewError(
          "MEMORY_CONFLICT",
          "The destination has changed. Select the current note.",
        );
      if (code === "NOT_FOUND")
        throw new CrewError("MEMORY_MISSING", "The selected note is unavailable.");
      throw unavailable();
    }
    const value = result.structuredContent;
    if (!value) throw unavailable();
    return typeof value === "object" && "result" in value ? value.result : value;
  }
  async close() {
    this.stopped = true;
    this.lifecycle.abort();
    await (await this.opening?.catch(() => undefined))?.close();
  }
}
