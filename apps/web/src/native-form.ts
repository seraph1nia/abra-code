import { Schema } from "effect";
import { Form } from "@opencode/schema/form";

export type FormValues = Record<string, Form.Value>;
export function initialCustomChoices(fields: readonly Form.Field[]) {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.type === "multiselect" && field.custom
        ? [
            [
              field.key,
              (field.default ?? [])
                .filter((value) => !field.options.some((option) => option.value === value))
                .join("\n"),
            ],
          ]
        : [],
    ),
  );
}
export function editingValues(
  fields: readonly Form.Field[],
  values: FormValues,
  customText: Record<string, string>,
) {
  const result = { ...values };
  for (const field of fields) {
    if (field.type !== "multiselect" || !field.custom || customText[field.key] === undefined)
      continue;
    const selected = values[field.key];
    result[field.key] = [
      ...(Array.isArray(selected)
        ? selected.filter((value) => field.options.some((option) => option.value === value))
        : []),
      ...customText[field.key].split(/\r?\n/),
    ];
  }
  return result;
}

/** Offset defaults display the same instant locally; raw local edits stay local until submit. */
export function dateTimeDisplay(value: string) {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number: number, length = 2) => String(number).padStart(length, "0");
  const minute = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.getMilliseconds()
    ? `${minute}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    : date.getSeconds()
      ? `${minute}:${pad(date.getSeconds())}`
      : minute;
}

/** Refuse calendar overflow and DST gaps rather than Date's silent normalization. */
export function serializeLocalDateTime(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
    value,
  );
  if (!match) return;
  const [, year, month, day, hour, minute, second = "0", fraction = "0"] = match;
  const parts = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0")),
  ];
  const date = new Date(0);
  date.setFullYear(parts[0], parts[1], parts[2]);
  date.setHours(parts[3], parts[4], parts[5], parts[6]);
  const actual = [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  ];
  return actual.every((part, index) => part === parts[index]) ? date.toISOString() : undefined;
}
export function initialValues(fields: readonly Form.Field[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    if (field.type === "external") continue;
    if (field.default !== undefined)
      values[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
    else if (field.type === "boolean") values[field.key] = false;
  }
  return values;
}
export function activeFields(fields: readonly Form.Field[], values: FormValues) {
  const active = new Set<string>();
  const answers: FormValues = {};
  for (const field of fields) {
    const enabled =
      field.type === "external" ||
      (field.when ?? []).every((condition) => {
        const value = answers[condition.key];
        if (value === undefined) return false;
        const equal = Array.isArray(value)
          ? value.includes(String(condition.value))
          : value === condition.value;
        return condition.op === "eq" ? equal : !equal;
      });
    if (enabled) {
      active.add(field.key);
      if (values[field.key] !== undefined) answers[field.key] = values[field.key];
    }
  }
  return active;
}

/** Form.Answer validates value shapes; definition-specific constraints belong here. */
export function prepareAnswer(
  fields: readonly Form.Field[],
  values: FormValues,
  customText?: Record<string, string>,
): { answer: Form.Answer; errors: Record<string, string> } {
  values = customText ? editingValues(fields, values, customText) : { ...values };
  for (const field of fields) {
    if (field.type !== "multiselect" || !field.custom) continue;
    const selected = values[field.key];
    if (Array.isArray(selected) && selected.every((value) => typeof value === "string"))
      values[field.key] = [...new Set(selected.map((value) => value.trim()).filter(Boolean))];
  }
  const answer: FormValues = {};
  const errors: Record<string, string> = {};
  const enabled = activeFields(fields, values);
  for (const field of fields) {
    if (!enabled.has(field.key)) continue;
    let value = values[field.key];
    const fail = (message: string) => {
      errors[field.key] = message;
    };
    if (field.type === "external") {
      if (value !== true) fail(`Acknowledge ${field.title ?? "the external step"}`);
      else answer[field.key] = true;
      continue;
    }
    const missing =
      value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (missing && field.required) {
      fail(`${field.title ?? field.key} is required`);
      continue;
    }
    if (value === undefined || (missing && !field.required)) continue;
    switch (field.type) {
      case "string":
        if (typeof value !== "string") {
          fail("Enter text");
          break;
        }
        if (value.length < (field.minLength ?? 0) || value.length > (field.maxLength ?? Infinity))
          fail("Check the text length");
        if (
          field.options &&
          !field.custom &&
          !field.options.some((option) => option.value === value)
        )
          fail("Choose an available option");
        if (field.pattern) {
          try {
            if (!new RegExp(`^(?:${field.pattern})$`, "u").test(value))
              fail("Check the required format");
          } catch {
            fail("This field has an invalid format definition");
          }
        }
        if (field.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
          fail("Enter a valid email address");
        if (field.format === "uri") {
          try {
            new URL(value);
          } catch {
            fail("Enter a valid URL");
          }
        }
        if (
          (field.format === "date" || field.format === "date-time") &&
          !Number.isFinite(Date.parse(value))
        )
          fail("Enter a valid date");
        if (field.format === "date-time" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
          const serialized = serializeLocalDateTime(value);
          if (!serialized)
            fail("Enter a valid local date and time; this time may not exist in your timezone");
          else if (value !== field.default) value = serialized;
        }
        break;
      case "number":
      case "integer":
        if (typeof value !== "number" || !Number.isFinite(value)) fail("Enter a finite number");
        else if (field.type === "integer" && !Number.isInteger(value)) fail("Enter a whole number");
        else if (value < (field.minimum ?? -Infinity) || value > (field.maximum ?? Infinity))
          fail("Check the allowed number range");
        break;
      case "boolean":
        if (typeof value !== "boolean") fail("Choose a boolean answer");
        break;
      case "multiselect":
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
          fail("Choose available values");
          break;
        }
        if (value.length < (field.minItems ?? 0) || value.length > (field.maxItems ?? Infinity))
          fail("Check the number of selections");
        if (new Set(value).size !== value.length) fail("Choose each value once");
        if (
          !field.custom &&
          value.some((item) => !field.options.some((option) => option.value === item))
        )
          fail("Choose available options");
        break;
      default:
        field satisfies never;
    }
    if (!errors[field.key]) answer[field.key] = value;
  }
  return { answer: Schema.decodeSync(Form.Answer)(answer), errors };
}

export function externalURL(url: string) {
  try {
    const value = new URL(url);
    return ["https:", "http:"].includes(value.protocol) && !value.username && !value.password
      ? value.href
      : undefined;
  } catch {
    return undefined;
  }
}
