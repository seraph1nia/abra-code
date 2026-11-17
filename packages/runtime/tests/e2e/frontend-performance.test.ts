import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { test } from "vite-plus/test";
import { workspaceBrowserFixture } from "../helpers/workspace-browser.ts";

test("complete initial script graph and long-conversation render locality", async (t) => {
  const f = await workspaceBrowserFixture();
  t.onTestFinished(f.close);
  const measurements = [];
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(
    major > 26 || (major === 26 && minor >= 4),
    "frontend acceptance requires supported Node 26.4+",
  );
  const budget = JSON.parse(
    await readFile(
      new URL("../../../../docs/verification/frontend-budget.json", import.meta.url),
      "utf8",
    ),
  ) as {
    fixtures: Record<string, { baselineGzip: number; ceilingGzip: number }>;
  };
  for (const count of [0, 1_000]) {
    f.source.value = {
      ...f.source.value,
      messages: Array.from({ length: count }, (_, index) => ({
        id: `msg_performance_${index}`,
        role: "assistant" as const,
        text: `Retained performance message ${index}`,
        at: "2026-11-15T10:00:00Z",
      })),
    };
    const page = await f.browser.newPage({ viewport: { width: 1440, height: 1000 } });
    // React's supported DevTools commit hook observes performed work in the actual
    // production tree. Count content-bearing boundaries, not DOM mutation guesses.
    await page.addInitScript(() => {
      const counts: Record<string, number> = {};
      let previous = new Set<unknown>();
      const hook = {
        supportsFiber: true,
        inject: () => 1,
        onCommitFiberUnmount: () => {},
        onCommitFiberRoot: (_id: number, root: { current: unknown }) => {
          const current = new Set<unknown>();
          function visit(value: unknown) {
            const fiber = value as {
              flags: number;
              memoizedProps?: { content?: string };
              child?: unknown;
              sibling?: unknown;
            } | null;
            if (!fiber) return;
            current.add(fiber);
            const content = fiber.memoizedProps?.content;
            if (
              !previous.has(fiber) &&
              fiber.flags & 1 &&
              content?.startsWith("Retained performance message ")
            )
              counts[content] = (counts[content] ?? 0) + 1;
            visit(fiber.child);
            visit(fiber.sibling);
          }
          visit(root.current);
          previous = current;
        },
      };
      Object.assign(window, { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook, __contentRenders: counts });
    });
    const scripts = new Map<string, Promise<Buffer>>();
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.endsWith(".js"))
        scripts.set(new URL(response.url()).pathname, response.body());
    });
    await page.goto(f.origin);
    const composer = page.getByRole("textbox", { name: "Message Abra" });
    await composer.waitFor();
    if (count)
      await page.getByText(`Retained performance message ${count - 1}`, { exact: true }).waitFor();
    // AG-UI keeps a fetch stream open, so networkidle is not a readiness signal.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const graph = await Promise.all(
      [...scripts].map(async ([path, bytes]) => {
        const body = await bytes;
        return { path, bytes: body.byteLength, gzip: gzipSync(body).byteLength };
      }),
    );
    const declared = await page
      .locator('script[src],link[rel="modulepreload"]')
      .evaluateAll((elements) =>
        elements
          .map(
            (element) =>
              new URL(element.getAttribute("src") ?? element.getAttribute("href")!, location.href)
                .pathname,
          )
          .filter((path) => path.endsWith(".js")),
      );
    for (const path of declared)
      assert.ok(
        graph.some((entry) => entry.path === path),
        `initial graph includes ${path}`,
      );
    const totalGzip = graph.reduce((sum, entry) => sum + entry.gzip, 0);
    if (!process.env.ABRACODE_FRONTEND_BASELINE) {
      const fixture = budget.fixtures[String(count)];
      assert.ok(
        fixture.ceilingGzip < fixture.baselineGzip,
        "ceiling must remain below matched baseline",
      );
      assert.ok(
        totalGzip <= fixture.ceilingGzip,
        `${count}-message startup: ${totalGzip} gzip bytes exceeds ${fixture.ceilingGzip}`,
      );
    }
    const renders = () =>
      page.evaluate(() => ({
        ...(window as unknown as { __contentRenders: Record<string, number> }).__contentRenders,
      }));
    const before = await renders();
    const start = performance.now();
    await composer.pressSequentially("x".repeat(100));
    const typingMs = performance.now() - start;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const afterTyping = await renders();
    let afterStreaming = afterTyping;
    let afterAppend = afterTyping;
    if (count) {
      f.source.value = {
        ...f.source.value,
        messages: f.source.value.messages.map((message, index) =>
          index === count - 1 ? { ...message, text: `${message.text} streamed` } : message,
        ),
      };
      await f.changed();
      await page
        .getByText(`Retained performance message ${count - 1} streamed`, { exact: true })
        .waitFor();
      afterStreaming = await renders();
      afterAppend = afterStreaming;
    }
    if (count) {
      assert.ok(
        Object.keys(before).length >= count,
        "commit probe must observe all message contents",
      );
      if (!process.env.ABRACODE_FRONTEND_BASELINE) {
        assert.deepEqual(afterTyping, before, "typing must not render historical contents");
        for (let index = 0; index < count - 1; index++) {
          const text = `Retained performance message ${index}`;
          assert.equal(afterStreaming[text], before[text], `unchanged message ${index}`);
        }
        f.source.value = {
          ...f.source.value,
          messages: [
            ...f.source.value.messages.slice(1),
            {
              id: `msg_performance_${count}`,
              role: "assistant",
              text: `Retained performance message ${count}`,
              at: f.source.value.at,
            },
          ],
        };
        await f.changed();
        await page.getByText(`Retained performance message ${count}`, { exact: true }).waitFor();
        afterAppend = await renders();
        for (const [text, renders] of Object.entries(afterStreaming))
          assert.equal(
            afterAppend[text],
            renders,
            `retained content across native window rollover: ${text}`,
          );
      }
      const found = await page.evaluate(() => {
        const browser = window as unknown as {
          find: (
            text: string,
            caseSensitive: boolean,
            backwards: boolean,
            wrap: boolean,
          ) => boolean;
        };
        // Focus is in the composer after the transcript; real browser find wraps.
        return browser.find("Retained performance message 13", false, false, true);
      });
      assert.equal(found, true, "browser find must reach retained offscreen text");
      await page.locator('[data-native-message-id="msg_performance_13"]').scrollIntoViewIfNeeded();
      assert.equal(
        await page.locator("[data-native-message-id]").count(),
        process.env.ABRACODE_FRONTEND_BASELINE ? count : count + 1,
      );
      assert.equal(
        await page
          .locator(".message")
          .first()
          .evaluate((element) => getComputedStyle(element).contentVisibility),
        "auto",
      );
    }
    measurements.push({
      count,
      graph,
      declared,
      totalGzip,
      before,
      afterTyping,
      afterStreaming,
      afterAppend,
      typingMs,
    });
    await page.close();
  }
  const directory = process.env.ABRACODE_TEST_EVIDENCE_DIR;
  if (directory) {
    await mkdir(directory, { recursive: true });
    const sourceHash = createHash("sha256");
    if (!process.env.ABRACODE_FRONTEND_SOURCE) {
      const paths = execFileSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        { encoding: "utf8" },
      )
        .split("\0")
        .filter((path) =>
          /^(?:apps\/(?:web|report)\/|packages\/(?:contracts|presentation)\/|(?:package\.json|pnpm-lock\.yaml|vite\.config\.ts)$)/.test(
            path,
          ),
        )
        .sort();
      for (const path of paths)
        sourceHash
          .update(path)
          .update("\0")
          .update(await readFile(path));
    }
    await writeFile(
      join(directory, "frontend-performance.json"),
      JSON.stringify(
        {
          node: process.version,
          pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
          source:
            process.env.ABRACODE_FRONTEND_SOURCE ??
            execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          frontendSourceSha256: process.env.ABRACODE_FRONTEND_SOURCE
            ? "git archive of the recorded source; measurement fixture copied separately"
            : sourceHash.digest("hex"),
          diff: process.env.ABRACODE_FRONTEND_SOURCE
            ? "disposable git archive; measurement fixture copied from working source"
            : execFileSync("git", ["diff", "--stat"], { encoding: "utf8" }),
          baseline: Boolean(process.env.ABRACODE_FRONTEND_BASELINE),
          compression: "node:zlib gzipSync defaults",
          measurements,
          cleanup:
            "fixture teardown registered before browser operations; only owned contexts and HTTP scope",
        },
        null,
        2,
      ),
    );
  }
  assert.equal(f.source.submissions, 0);
  assert.equal(f.source.stops, 0);
});
