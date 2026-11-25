import assert from "node:assert/strict";
import { test, vi } from "vite-plus/test";
import { launchReportBrowser } from "@abracode/report-export/browser";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { DiagramPreparer } from "@abracode/report-export/preparation";

test(
  "batch preparation shares real compilation and preserves mixed diagnostic identities",
  { timeout: 60000 },
  async () => {
    const owner = new DiagramPreparer();
    const input = [{ id: "one", source: "flowchart LR\nA <--> B" }];
    const [a, b] = await Promise.all([
      owner.prepare(input),
      owner.prepare([{ ...input[0]!, id: "two" }]),
    ]);
    assert.equal(a.verified, true);
    assert.equal(b.verified, true);
    assert.equal(owner.metrics.compilations, 1);
    const warm = await owner.prepare(input);
    assert.equal(warm.verified, true);
    assert.equal(owner.metrics.compilations, 1);
    const mixed = await owner.prepare([
      ...input,
      { id: "broken", source: "flowchart LR\nA -->" },
      { id: "unsafe", source: "flowchart LR\nclick A alert" },
    ]);
    assert.equal(mixed.verified, false);
    assert.deepEqual(
      mixed.results.map((r) => [r.id, r.status]),
      [
        ["one", "verified"],
        ["broken", "syntax"],
        ["unsafe", "forbidden"],
      ],
    );
  },
);

test("preparation bounds its queue, releases timed-out work and keeps another waiter after cancellation", async () => {
  let closed = 0;
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const owner = new DiagramPreparer({
    compiler: "fixture",
    deadlineMs: 100,
    factory: async () => ({
      render: async () => {
        await wait;
        return '<svg id="fixture"/>';
      },
      close: async () => {
        closed++;
        release!();
      },
    }),
  });
  const abort = new AbortController();
  const first = owner.prepare([{ id: "one", source: "flowchart LR\nA --> B" }], abort.signal);
  const second = owner.prepare([{ id: "two", source: "flowchart LR\nA --> B" }]);
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  abort.abort();
  assert.equal((await first).verified, false);
  release!();
  assert.equal((await second).verified, true);
  assert.equal(owner.metrics.compilations, 1);
  assert.ok(closed >= 1);

  const slow = new DiagramPreparer({
    compiler: "slow",
    deadlineMs: 20,
    factory: async () => {
      let finish: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        render: async () => {
          await waiting;
          throw Error("TIMEOUT: renderer stopped");
        },
        close: async () => {
          finish!();
        },
      };
    },
  });
  const requests = Array.from({ length: 11 }, (_, i) =>
    slow.prepare([{ id: `d${i}`, source: `flowchart LR\nA --> B${i}` }]),
  );
  const results = await Promise.all(requests);
  assert.ok(results.some((r) => r.results[0]?.status === "busy"));
  assert.ok(results.some((r) => r.results[0]?.status === "timeout"));
  assert.equal(
    (await slow.prepare([{ id: "safe", source: "%%{init: {}}%%\nflowchart LR\nA --> B" }]))
      .results[0]?.status,
    "forbidden",
  );
});

test("two renderer cleanup failures release capacity for a queued batch", async () => {
  let signalClosing!: () => void;
  let release!: () => void;
  const bothClosing = new Promise<void>((resolve) => {
    signalClosing = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let launches = 0;
  let closing = 0;
  const owner = new DiagramPreparer({
    compiler: "fixture",
    deadlineMs: 1000,
    factory: async () => {
      const id = ++launches;
      return {
        render: async () => "<svg/>",
        close: async () => {
          if (id > 2) return;
          if (++closing === 2) signalClosing();
          await wait;
          throw new Error(`Renderer ${id} failed to close`);
        },
      };
    },
  });
  const prepare = (id: string) => owner.prepare([{ id, source: `flowchart LR\nA --> ${id}` }]);
  const failures = Promise.all([
    assert.rejects(prepare("one"), /Renderer 1 failed to close/),
    assert.rejects(prepare("two"), /Renderer 2 failed to close/),
  ]);
  await bothClosing;
  const third = prepare("three");
  release();
  await failures;
  assert.equal((await third).verified, true);
  assert.equal(launches, 3);
});

test("derived cache evicts bounded results and refuses aggregate prepared-output overflow", async () => {
  const source = (i: number) => [{ id: `d${i}`, source: `flowchart LR\nA --> B${i}` }];
  const owner = new DiagramPreparer({
    compiler: "bounded",
    factory: async () => ({
      render: async () => '<svg id="large">' + " ".repeat(4 * 1024 * 1024) + "</svg>",
      close: async () => {},
    }),
  });
  for (let i = 0; i < 9; i++) assert.equal((await owner.prepare(source(i))).verified, true);
  const before = owner.metrics.compilations;
  await owner.prepare(source(0));
  assert.equal(
    owner.metrics.compilations,
    before + 1,
    "Byte eviction must prevent unbounded retained cache growth",
  );
  const overflow = await owner.prepare([...source(10), ...source(11)]);
  assert.equal(overflow.verified, false);
  assert.equal(overflow.results[0]?.status, "limit");
});

test("prepared output budget includes diagnostic metadata as well as SVG assets", async () => {
  const owner = new DiagramPreparer({
    compiler: "fringe",
    factory: async () => ({
      render: async () => "<svg>" + " ".repeat(4 * 1024 * 1024 - 200) + "</svg>",
      close: async () => {},
    }),
  });
  const result = await owner.prepare([
    { id: "one", source: "flowchart LR\nA --> B" },
    { id: "two", source: "flowchart LR\nA --> C" },
  ]);
  assert.equal(result.verified, false);
  assert.equal(result.results[0]?.status, "limit");
  assert.deepEqual(result.assets, []);
});

test("diagram sanitizer retains geometry and confines allowed styles to the graphic", async (t) => {
  const browser = await launchReportBrowser();
  t.onTestFinished(() => browser.close());
  const page = await browser.newPage();
  const source = await readFile("packages/presentation/src/diagram-svg.ts", "utf8");
  await page.addScriptTag({
    type: "module",
    content: stripTypeScriptTypes(source) + "\nglobalThis.sanitize = sanitizeDiagramSVG;",
  });
  await page.waitForFunction(() => "sanitize" in globalThis);
  const markup =
    '<svg><style>body, rect { fill: red; background: blue }</style><script type="application/json">{}</script><foreignObject><p>extra</p></foreignObject><rect width="5" onclick="" data-extra="test" /></svg>';
  const result = await page.evaluate((input) => {
    const sanitize = (globalThis as unknown as { sanitize: (text: string) => SVGSVGElement })
      .sanitize;
    return sanitize(input).outerHTML;
  }, markup);
  assert.match(result, /<rect[^>]*width="5"/);
  assert.match(result, /fill: red/);
  assert.doesNotMatch(result, /<(?:script|style|foreignObject)|onclick|background|data-extra/);
});

test("canceling a queued diagram frees its place before launch and omits an invalid syntax line", async () => {
  function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const gates = [gate(), gate()];
  const busy = gate();
  let launches = 0;
  const service = new DiagramPreparer({
    compiler: "queue",
    factory: async () => {
      const index = launches++;
      if (launches === 2) busy.resolve();
      return {
        render: async () => {
          if (gates[index]) await gates[index].promise;
          throw new Error("SYNTAX: line 0");
        },
        close: async () => {},
      };
    },
  });
  const request = (index: number, signal?: AbortSignal) =>
    service.prepare([{ id: "d" + index, source: "flowchart LR\nA --> B" + index }], signal);
  const running = [request(0), request(1)];
  await busy.promise;
  const cancel = new AbortController();
  const canceled = request(2, cancel.signal);
  const queued = Array.from({ length: 7 }, (_, i) => request(i + 3));
  await Promise.resolve();
  cancel.abort();
  assert.equal((await canceled).results[0]?.status, "unavailable");
  const replacement = request(10);
  gates.forEach((gate) => gate.resolve());
  for (const result of await Promise.all([...running, ...queued, replacement])) {
    assert.equal(result.results[0]?.status, "syntax");
    assert.equal(result.results[0]?.line, undefined);
  }
  assert.equal(launches, 10);
});

test("a later caller can finish shared compilation after its owner times out", async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closed = 0;
  const service = new DiagramPreparer({
    compiler: "shared",
    deadlineMs: 100,
    factory: async () => ({
      render: async () => {
        started();
        await wait;
        return "<svg/>";
      },
      close: async () => {
        closed++;
      },
    }),
  });
  try {
    const input = [{ id: "single", source: "flowchart LR\nA --> B" }];
    const first = service.prepare(input);
    await ready;
    await vi.advanceTimersByTimeAsync(50);
    const second = service.prepare(input);
    await vi.advanceTimersByTimeAsync(50);
    assert.equal((await first).results[0]?.status, "timeout");
    assert.equal(closed, 0);
    finish();
    assert.equal((await second).verified, true);
    assert.equal(service.metrics.compilations, 1);
  } finally {
    finish();
    vi.useRealTimers();
  }
});
