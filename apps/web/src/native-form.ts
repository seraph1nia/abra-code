import { Schema } from "effect";
import { Form } from "@opencode/schema/form";

export type FormValues = Record<string, Form.Value>;
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
): { answer: Form.Answer; errors: Record<string, string> } {
  const answer: FormValues = {};
  const errors: Record<string, string> = {};
  const enabled = activeFields(fields, values);
  for (const field of fields) {
    if (!enabled.has(field.key)) continue;
    const value = values[field.key];
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
