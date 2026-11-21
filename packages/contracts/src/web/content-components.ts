import { Schema } from "effect";

const label = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256));
const text = Schema.String.check(Schema.isMaxLength(4096));
const headers = Schema.Array(label).check(Schema.isMinLength(1), Schema.isMaxLength(32));
const cells = Schema.Array(text).check(Schema.isMinLength(1), Schema.isMaxLength(32));

export const contentProps = {
  Table: Schema.Struct({
    caption: label,
    columns: headers,
    rows: Schema.Array(cells).check(Schema.isMaxLength(100)),
  }),
  Disclosure: Schema.Struct({ label, child: Schema.String }),
  KeyValueList: Schema.Struct({
    entries: Schema.Array(Schema.Struct({ label, value: text })).check(Schema.isMaxLength(100)),
  }),
  CodeBlock: Schema.Struct({
    code: Schema.String.check(Schema.isMaxLength(32768)),
    language: Schema.optionalKey(label),
  }),
};
export type ContentName = keyof typeof contentProps;
export const contentNames = Object.keys(contentProps) as ContentName[];

const descriptions: Record<ContentName, string> = {
  Table:
    "A read-only table with a caption, column headers and one literal text cell per column in each row.",
  Disclosure: "Expandable labeled section containing one child component.",
  KeyValueList: "Labeled facts about one item, in display order.",
  CodeBlock: "Literal code or output with its original whitespace and optional language label.",
};

export const contentDefinitions = Object.fromEntries(
  contentNames.map((name) => {
    const document = Schema.toJsonSchemaDocument(
      Schema.Struct({
        component: Schema.Literal(name),
        ...contentProps[name].fields,
      }),
      { onExcessProperty: "error" },
    );
    // A catalog Child reference drives both graph validation and Express nesting.
    if (name === "Disclosure") {
      document.schema.properties = {
        ...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
          document.schema.properties,
        ),
        child: { $ref: "common_types.json#/$defs/Child" },
      };
    }
    return [name, { ...document.schema, description: descriptions[name] }];
  }),
);
