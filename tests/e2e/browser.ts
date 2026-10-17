import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import * as Id from "../../src/identities.ts";
import { ProcessRunner } from "../../src/process.ts";
import { run } from "../effects.ts";

const string = (value: unknown) => (typeof value === "string" ? value : "");

export const browserPage = `<!doctype html><title>Browser fixture</title>
<button id="increment" onclick="localStorage.count=String(Number(localStorage.count||0)+1);document.querySelector('#count').textContent=localStorage.count">Increment</button>
<output id="count">0</output><a href="/browser/other">Other page</a>
<script>document.querySelector('#count').textContent=localStorage.count||'0'</script>`;

/** Model-scripted calls still traverse the real session/tool executor and native permissions. */
export function browserCalls(
  user: string,
  role: string,
  url: string,
  messages: { role: string; content?: unknown }[],
) {
  if (!user.includes("browser-acceptance")) return [];
  const name = /Browser session: ([^. ]+)\./.exec(user)![1];
  const directory = /Screenshot directory: ([^\n]+)\/\./.exec(user)![1];
  const cli = `agent-browser --session ${name}`;
  const screenshot = /\/[^"\\\s]+\/screenshot-\d+\.png/.exec(
    JSON.stringify(messages.filter((m) => m.role === "tool")),
  )?.[0];
  return [
    { name: "skill", args: { id: "abra-browser" } },
    ...[
      `${cli} --version`,
      `${cli} skills get core`,
      `${cli} open ${url}/browser/${role}`,
      `${cli} snapshot -i`,
      `${cli} click @e1`,
      `${cli} get text '#count'`,
      `${cli} screenshot --screenshot-dir '${directory}'`,
    ].map((command) => ({ name: "shell", args: { command } })),
    ...(screenshot ? [{ name: "read", args: { path: screenshot } }] : []),
    { name: "read", args: { path: join(dirname(directory), "other-session/sentinel.txt") } },
    ...(role === "research"
      ? [
          { name: "shell", args: { command: `${cli} open http://127.0.0.1:1` } },
          {
            name: "abra_worker_progress",
            args: {
              generation: Number(/Control generation: (\d+)/.exec(user)![1]),
              summary:
                "Browser fixture checked; the unavailable URL http://127.0.0.1:1 requires an operator-provided running app. Screenshot paths are scratch evidence.",
            },
          },
        ]
      : []),
    { name: "shell", args: { command: `${cli} close` } },
    ...(role === "apply"
      ? []
      : [
          { name: "shell", args: { command: "touch forbidden-browser-shell" } },
          { name: "shell", args: { command: `${cli} --version && touch forbidden-browser-chain` } },
        ]),
  ];
}

export async function assertBrowserWorker(
  client: ReturnType<typeof OpenCode.make>,
  home: string,
  sessionID: Id.SessionId,
) {
  const messages = await client.session.context({ sessionID });
  const calls = messages.flatMap((m) =>
    m.type === "assistant" ? m.content.filter((p) => p.type === "tool") : [],
  );
  const browser = calls.filter(
    (p) =>
      p.type === "tool" &&
      (p.name === "skill" ||
        (p.state.status !== "streaming" &&
          (string(p.state.input.command ?? "").includes("agent-browser") ||
            string(p.state.input.path ?? "").includes("/screenshot-")))),
  );
  assert.ok(browser.length >= 10, JSON.stringify(calls));
  for (const call of browser) {
    if (call.type !== "tool" || call.state.status === "streaming") continue;
    const denied = string(call.state.input.command ?? "").includes("forbidden-browser-chain");
    assert.equal(call.state.status, denied ? "error" : "completed", JSON.stringify(call));
    if (call.state.status === "completed") {
      const text = JSON.stringify(call.state.content);
      if (call.name === "shell") {
        const unreachable = string(call.state.input.command).endsWith("open http://127.0.0.1:1");
        assert.equal(call.state.metadata?.exit, unreachable ? 1 : 0, text);
        if (unreachable) assert.match(text, /ERR_UNSAFE_PORT|failed|error/i);
      }
      const command = string(call.state.input.command ?? "");
      if (command.endsWith("--version")) assert.match(text, /agent-browser 0\.39\.1/);
      if (command.endsWith("snapshot -i")) assert.match(text, /Increment/);
      if (command.includes("get text"))
        assert.equal(
          call.state.content
            .flatMap((p) => (p.type === "text" ? [p.text] : []))
            .join("")
            .trim(),
          "1",
        );
      if (call.name === "read") assert.match(text, /image\/png/);
    }
  }
  const image = browser.find((call) => call.type === "tool" && call.name === "read");
  assert.ok(image?.type === "tool" && image.state.status === "completed");
  const imagePath = string(image.state.input.path);
  assert.ok(imagePath.startsWith(join(home, ".abracode/browser", sessionID) + "/"));
  const png = await readFile(imagePath);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const sibling = calls.find(
    (call) =>
      call.type === "tool" &&
      call.name === "read" &&
      call.state.status !== "streaming" &&
      string(call.state.input.path).includes("other-session"),
  );
  assert.ok(sibling?.type === "tool" && sibling.state.status === "error", JSON.stringify(sibling));
  assert.equal(sibling.state.error.type, "permission.rejected");
  const session = await client.session.get({ sessionID });
  for (const file of ["forbidden-browser-shell", "forbidden-browser-chain"])
    await assert.rejects(access(join(session.location.directory, file)));
}

/** Concurrent real browsers use two actual worker identities; the test owns and closes both. */
export async function browserIsolation(
  home: string,
  sessions: [Id.SessionId, Id.SessionId],
  url: string,
) {
  const runner = new ProcessRunner();
  const cli = Id.Executable.make(resolve("node_modules/.bin/agent-browser"));
  const command = (session: Id.SessionId, ...args: string[]) =>
    run(
      runner.run(
        cli,
        ["--session", `abracode-${session}`, ...args],
        Id.AbsolutePath.make(home),
        undefined,
        { deadline_ms: 20000, max_output_bytes: 16384 },
      ),
    );
  const [one, two] = sessions;
  try {
    await Promise.all(
      sessions.map((id, i) => command(id, "open", `${url}/browser/isolation-${i}`)),
    );
    await command(one, "click", "#increment");
    assert.equal(await command(one, "get", "text", "#count"), "1");
    assert.equal(await command(two, "get", "text", "#count"), "0");
    assert.match(await command(one, "get", "url"), /isolation-0/);
    assert.match(await command(two, "get", "url"), /isolation-1/);
    await command(one, "open", `${url}/browser/other`);
    assert.equal(await command(one, "get", "text", "#count"), "1");
    assert.match(await command(two, "get", "url"), /isolation-1/);
    await command(one, "close");
    assert.equal(await command(two, "get", "text", "#count"), "0");
    await command(two, "click", "#increment");
    assert.equal(await command(two, "get", "text", "#count"), "1");
  } finally {
    await Promise.allSettled(sessions.map((id) => command(id, "close")));
  }
}
