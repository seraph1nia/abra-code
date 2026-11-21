import { test } from "vite-plus/test";
import { compileWorkView } from "../../src/web/express.ts";
import assert from "node:assert/strict";
import { catalogId, validateSurface } from "../../src/web/surfaces.ts";

const work = new Set(["abra-1"]);
const surface = () => ({
  version: "1.0",
  createSurface: {
    surfaceId: "board",
    catalogId,
    components: [
      { id: "root", component: "Column", children: ["work"] },
      { id: "work", component: "Kanban", issueIds: ["abra-1"], mode: "live" },
    ],
  },
});
test("A2UI v1 inline createSurface uses the shared bounded catalog", () => {
  assert.equal(validateSurface(surface(), work).version, "1.0");
  assert.throws(() => validateSurface({ ...surface(), version: "0.9" }, work));
  assert.throws(() => validateSurface({ ...surface(), updateComponents: {} }, work));
});
test("generated views reject executable content, unknown work, cycles and unbounded trees", () => {
  const bad: unknown[] = [
    { ...surface(), html: "<script>fetch('/api/abra/stop')</script>" },
    {
      ...surface(),
      createSurface: { ...surface().createSurface, catalogId: "https://attacker.test/catalog" },
    },
    {
      version: "1.0",
      createSurface: {
        surfaceId: "x",
        catalogId,
        components: [{ id: "root", component: "Approval", issueId: "abra-1" }],
      },
    },
    {
      version: "1.0",
      createSurface: {
        surfaceId: "x",
        catalogId,
        components: [{ id: "root", component: "Text", text: "x".repeat(65537) }],
      },
    },
    {
      version: "1.0",
      createSurface: {
        surfaceId: "x",
        catalogId,
        components: [{ id: "root", component: "Column", children: ["root"] }],
      },
    },
    {
      version: "1.0",
      createSurface: {
        surfaceId: "x",
        catalogId,
        components: [{ id: "root", component: "WorkTable", issueIds: ["other"] }],
      },
    },
    {
      version: "1.0",
      createSurface: {
        surfaceId: "x",
        catalogId,
        components: [{ id: "root", component: "Text", text: "Label", onClick: "eval()" }],
      },
    },
  ];
  for (const value of bad) assert.throws(() => validateSurface(value, work));
});

test("Express compiles nested views and typed resource links into one stable revision", () => {
  const source = `root = Column([
    Row([Text("Selected work"), WorkTable(issueIds=["abra-1"], mode="snapshot")]),
    ResourceLink("Inspect", {action:"open_task", issue_id:"abra-1"})
  ])`;
  const result = compileWorkView("work-board", source);
  assert.deepEqual(compileWorkView("work-board", source), result);
  assert.equal(result.createSurface.surfaceId, "work-board");
  assert.deepEqual(
    result.createSurface.components.map((c) => c.component),
    ["Column", "Row", "Text", "WorkTable", "ResourceLink"],
  );
  assert.deepEqual(result.createSurface.components[3].issueIds, ["abra-1"]);
  assert.deepEqual(result.createSurface.components[4].target, {
    action: "open_task",
    issue_id: "abra-1",
  });
});

test("Express rejects invalid syntax, unsupported output, and oversized source or surface", () => {
  const compile = (source: string) => compileWorkView("board", source);
  for (const src of [
    "root = Text(",
    "root = WorkTable(unknown=true)",
    "root = Text($/title)",
    '<a2ui>root = Text("wrapped")</a2ui>',
    'explanation <a2ui>root = Text("wrapped")</a2ui>',
    'root = Text("valid")\n</a2ui> ignored trailing text',
    'surface("other")\nroot = Text("x")',
    'deleteSurface("board")',
    'surface("board", update=true)\nroot = Text("x")',
    'surface("board")\nroot = Text("x")\nsurface("other")\nroot = Text("y")',
    'surface("board", catalogId="other")\nroot = Text("x")',
  ])
    assert.throws(() => compile(src), Error, src);
  assert.equal(
    compile('root = Text("<a2ui>example</a2ui>")').createSurface.components[0].text,
    "<a2ui>example</a2ui>",
  );
  assert.throws(() => compile("界".repeat(132000)), /Express source.*384 KiB/);
  const label = 'Text("' + "a".repeat(4096) + '")';
  const nearLimit = "root = Column([" + Array(95).fill(label).join(",") + "])";
  assert.throws(() => compile(nearLimit), /Surface exceeds the 384 KiB limit/);
});
