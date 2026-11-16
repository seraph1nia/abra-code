import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import { Form } from "@opencode/schema/form";
import { activeFields, initialValues, prepareAnswer, externalURL } from "@abracode/web/native-form";
import { workspaceSearch } from "@abracode/web/navigation";

const fields = (value: unknown) => Schema.decodeUnknownSync(Form.Fields)(value);
test("native form answers preserve hidden defaults and false/zero while excluding inactive branches", () => {
  const definition = fields([
    { type: "boolean", key: "include", required: true, default: false },
    { type: "string", key: "hidden", hidden: true, required: true, default: "retained" },
    { type: "integer", key: "count", required: true, default: 0 },
    {
      type: "string",
      key: "details",
      required: true,
      default: "stale",
      when: [{ key: "include", op: "eq", value: true }],
    },
    {
      type: "string",
      key: "nested",
      required: true,
      when: [{ key: "details", op: "eq", value: "stale" }],
    },
  ]);
  const values = initialValues(definition);
  assert.deepEqual([...activeFields(definition, values)], ["include", "hidden", "count"]);
  assert.deepEqual(prepareAnswer(definition, values), {
    answer: { include: false, hidden: "retained", count: 0 },
    errors: {},
  });
  assert.equal(
    prepareAnswer(definition, { ...values, include: true }).errors.nested,
    "nested is required",
  );
});
test("native form validation covers numeric bounds, choices, patterns and external acknowledgment", () => {
  const definition = fields([
    { type: "number", key: "amount", minimum: 0, maximum: 5 },
    { type: "integer", key: "count", minimum: 0 },
    { type: "string", key: "label", required: true, pattern: "[a-z]+", minLength: 2, maxLength: 5 },
    { type: "string", key: "choice", options: [{ label: "Local", value: "local" }], custom: false },
    {
      type: "multiselect",
      key: "views",
      options: [{ label: "Board", value: "board" }],
      minItems: 1,
      maxItems: 2,
    },
    { type: "external", key: "docs", url: "https://example.com" },
  ]);
  const invalid = prepareAnswer(definition, {
    amount: Infinity,
    count: 1.5,
    label: "A",
    choice: "remote",
    views: ["forged"],
    docs: false,
  });
  assert.deepEqual(Object.keys(invalid.errors), [
    "amount",
    "count",
    "label",
    "choice",
    "views",
    "docs",
  ]);
  assert.deepEqual(
    prepareAnswer(definition, {
      amount: 0,
      count: 2,
      label: "valid",
      choice: "local",
      views: ["board"],
      docs: true,
    }).errors,
    {},
  );
  assert.match(
    prepareAnswer(definition, { amount: 6, count: 2, label: "valid", docs: true }).errors.amount,
    /range/,
  );
  assert.match(
    prepareAnswer(definition, { label: "valid", views: ["board", "board"], docs: true }).errors
      .views,
    /once/,
  );
  assert.equal(externalURL("javascript:alert(1)"), undefined);
  assert.equal(externalURL("https://user:password@example.com"), undefined);
});
test("custom multiselect accepts user values and initial arrays are independent", () => {
  const definition = fields([
    { type: "multiselect", key: "views", options: [], custom: true, default: ["one"] },
  ]);
  const first = initialValues(definition),
    second = initialValues(definition);
  assert.notEqual(first.views, second.views);
  assert.deepEqual(prepareAnswer(definition, { views: ["one", "custom"] }), {
    answer: { views: ["one", "custom"] },
    errors: {},
  });
});
test("workspace URLs accept known tabs and scopes, ignoring malformed navigation input", () => {
  assert.deepEqual(
    workspaceSearch({ issue: "abra-one", tab: "Diff", file: "a.ts", scope: "uncommitted" }),
    { issue: "abra-one", tab: "Diff", file: "a.ts", scope: "uncommitted" },
  );
  assert.deepEqual(workspaceSearch({ issue: {}, tab: "forged", file: [], scope: "forged" }), {});
});
