import { test } from "vite-plus/test";
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
