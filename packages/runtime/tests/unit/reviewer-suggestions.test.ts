import { fixture, delivered } from "../fixtures.ts";
import { run } from "../effects.ts";
import { Effect } from "effect";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgeFixture } from "../forge.ts";
import { Forge } from "../../src/git/forge.ts";
import { GitHubReviewers } from "../../src/git/reviewers.ts";
import * as Id from "../../src/identities.ts";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { ownersFor } from "../../src/git/reviewers.ts";

test("CODEOWNERS suggestions honor rule precedence and disclose unsupported syntax", () => {
  const owners = ownersFor(
    "* @general\n/src/** @acme/api @alice\n/src/public/** @public\n/docs/[ab].md @unsupported\n/vendor/** @foreign/team",
    ["src/index.ts", "src/public/http.ts", "README.md", "vendor/code.ts"],
    "acme",
  );
  assert.deepEqual(owners.selected.get("user:alice"), ["CODEOWNERS: src/index.ts"]);
  assert.deepEqual(owners.selected.get("team:api"), ["CODEOWNERS: src/index.ts"]);
  assert.deepEqual(owners.selected.get("user:public"), ["CODEOWNERS: src/public/http.ts"]);
  assert.deepEqual(owners.selected.get("user:general"), ["CODEOWNERS: README.md"]);
  assert.equal(owners.selected.has("team:team"), false);
  assert.match(owners.notes.join("\n"), /Unsupported CODEOWNERS|different organization/);
});

test("suggestions read pinned ownership and recent authorship without a request mutation", async (t) => {
  const f = await run(fixture);
  t.onTestFinished(() => run(f.close()));
  const p = (await run(f.records.project(Id.RepositoryId.make("api"))))!;
  await writeFile(join(p.path, "CODEOWNERS"), "* @bob\nsource.txt @alice\n");
  await run(f.git.run(p.path, ["add", "CODEOWNERS"]));
  await run(f.git.run(p.path, ["commit", "-m", "Fixture ownership"]));
  await run(f.git.run(p.path, ["push", "origin", "main"]));
  const e = await run(delivered(f));
  const forge = forgeFixture(p, () => f.delivery.pr);
  const calls: string[][] = [];
  const runner = {
    run: (file: Id.Executable, args: string[], cwd: Id.AbsolutePath) => {
      calls.push(args);
      if (args[1].includes("/commits?"))
        return Effect.succeed(JSON.stringify([{ sha: e.base_commit, author: { login: "alice" } }]));
      if (args[1].includes("/collaborators/"))
        return Effect.succeed(
          JSON.stringify({ permission: args[1].includes("/alice/") ? "write" : "read" }),
        );
      return forge.runner.run(file, args, cwd);
    },
  };
  const suggestions = await run(
    new GitHubReviewers(f.git, new Forge(runner, Id.Executable.make("fake-forge"))).suggest(p, e),
  );
  assert.equal(suggestions.head, e.delivered_commit);
  assert.ok(
    suggestions.suggestions.some(
      (s) =>
        s.name === "alice" && s.eligible && s.evidence.some((x) => x.includes("Recent commit")),
    ),
  );
  assert.ok(suggestions.suggestions.some((s) => s.name === "bob" && !s.eligible));
  assert.equal(
    calls.some((args) => args.includes("POST") || args.includes("requested_reviewers")),
    false,
  );
});
