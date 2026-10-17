import * as Id from "../../src/identities.ts";
import { run } from "../effects.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ProcessRunner } from "../../src/process.ts";
test("native terminal sidebar renders, handles clicks and updates without stealing focus", async () => {
  // Reuse the pinned CLI's bundled Bun; Node 24 cannot run OpenTUI's native FFI.
  const result = await run(
    new ProcessRunner().run(
      Id.Executable.make(resolve("node_modules/.bin/opencode")),
      ["--conditions=browser", "run", resolve("tests/tui/sidebar.ts")],
      Id.AbsolutePath.make(process.cwd()),
      { BUN_BE_BUN: "1" },
    ),
  );
  assert.match(result, /Native sidebar checks passed/);
});
