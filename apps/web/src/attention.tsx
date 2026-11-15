import { useState } from "react";
import type { Form } from "@opencode/schema/form";
import type { AttentionForm, AttentionPermission } from "../../../src/web/contracts.ts";
import { api } from "./api.ts";

type Answer = Record<string, string | number | boolean | string[]>;
function active(field: Form.Field, values: Answer) {
  if (field.type === "external") return true;
  return (field.when ?? []).every((condition) => {
    const value = values[condition.key];
    if (value === undefined) return false;
    const equal = Array.isArray(value)
      ? value.includes(String(condition.value))
      : value === condition.value;
    return condition.op === "eq" ? equal : !equal;
  });
}
function initial(fields: readonly Form.Field[]): Answer {
  const values: Answer = {};
  for (const field of fields) {
    if (field.type === "external" || field.default === undefined) continue;
    values[field.key] = typeof field.default === "object" ? [...field.default] : field.default;
  }
  return values;
}

function externalURL(url: string) {
  try {
    const value = new URL(url);
    return ["https:", "http:"].includes(value.protocol) && !value.username && !value.password
      ? value.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function NativeForm({ item, refresh }: { item: AttentionForm; refresh: () => void }) {
  const { form } = item;
  const [values, setValues] = useState<Answer>(() => initial(form.fields));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: string, value: Answer[string]) => setValues((v) => ({ ...v, [key]: value }));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const answer: Answer = {};
      for (const f of form.fields) {
        if (!active(f, values)) continue;
        if (f.type === "external") {
          if (values[f.key] !== true)
            throw new Error(`Acknowledge ${f.title ?? "the external step"}`);
          answer[f.key] = true;
          continue;
        }
        const value = values[f.key];
        if (
          f.required &&
          (value === undefined || value === "" || (Array.isArray(value) && !value.length))
        )
          throw new Error(`${f.title ?? f.key} is required`);
        if (value !== undefined) {
          if (
            f.type === "multiselect" &&
            Array.isArray(value) &&
            (value.length < (f.minItems ?? 0) || value.length > (f.maxItems ?? Infinity))
          )
            throw new Error(`Check the number of selections for ${f.title ?? f.key}`);
          answer[f.key] = value;
        }
      }
      await api.replyForm({ id: form.id, binding: item.binding, answer });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Answer could not be confirmed");
    } finally {
      setPending(false);
    }
  }
  return (
    <form
      className="attention-card"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="eyebrow">
        {item.checkpoint
          ? `${item.checkpoint.kind} decision · ${item.checkpoint.issue_id}`
          : "Abra needs your input"}
      </div>
      <h3>{form.title}</h3>
      {item.checkpoint?.fingerprint ? (
        <code className="fingerprint">{String(item.checkpoint.fingerprint)}</code>
      ) : null}
      {!item.active && (
        <p role="status" className="warning">
          This checkpoint is no longer current. Ask Abra to reconcile it.
        </p>
      )}
      <fieldset disabled={pending || !item.active}>
        {form.fields.map((f) => {
          if (!active(f, values)) return null;
          if (f.type === "external") {
            const href = externalURL(f.url);
            return (
              <div key={f.key}>
                <p>{f.description}</p>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {f.title ?? "Continue in a new tab"} ↗
                  </a>
                ) : (
                  <p>Unsupported external link</p>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={values[f.key] === true}
                    onChange={(event) => set(f.key, event.target.checked)}
                  />
                  I have completed: {f.title ?? "External step"}
                </label>
              </div>
            );
          }
          if (f.hidden) return null;
          const title = f.title ?? f.key;
          return (
            <div className="field" key={f.key}>
              {f.type === "boolean" ? (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={values[f.key] === true}
                    onChange={(e) => set(f.key, e.target.checked)}
                  />
                  {title}
                  {f.required ? " *" : ""}
                </label>
              ) : (
                <label htmlFor={`${form.id}-${f.key}`}>
                  {title}
                  {f.required ? " *" : ""}
                </label>
              )}
              {f.description && <p className="muted">{f.description}</p>}
              {f.type === "string" &&
                (f.options && !f.custom ? (
                  <select
                    id={`${form.id}-${f.key}`}
                    required={f.required}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {f.options.map((o) => (
                      <option value={o.value} key={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      id={`${form.id}-${f.key}`}
                      type={
                        f.format === "email"
                          ? "email"
                          : f.format === "uri"
                            ? "url"
                            : f.format === "date"
                              ? "date"
                              : f.format === "date-time"
                                ? "datetime-local"
                                : "text"
                      }
                      required={f.required}
                      minLength={f.minLength}
                      maxLength={f.maxLength}
                      pattern={f.pattern}
                      placeholder={f.placeholder}
                      list={f.options ? `${form.id}-${f.key}-choices` : undefined}
                      value={String(values[f.key] ?? "")}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                    {f.options && (
                      <datalist id={`${form.id}-${f.key}-choices`}>
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </>
                ))}
              {(f.type === "number" || f.type === "integer") && (
                <input
                  id={`${form.id}-${f.key}`}
                  type="number"
                  step={f.type === "integer" ? 1 : "any"}
                  min={f.minimum}
                  max={f.maximum}
                  required={f.required}
                  value={values[f.key] === undefined ? "" : String(values[f.key])}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "")
                      setValues((v) => {
                        const next = { ...v };
                        delete next[f.key];
                        return next;
                      });
                    else set(f.key, Number(raw));
                  }}
                />
              )}
              {f.type === "multiselect" && (
                <div className="choices">
                  {f.options.map((o) => (
                    <label key={o.value} className="checkbox">
                      <input
                        type="checkbox"
                        checked={
                          Array.isArray(values[f.key]) &&
                          (values[f.key] as string[]).includes(o.value)
                        }
                        onChange={(e) => {
                          const prior = Array.isArray(values[f.key])
                            ? (values[f.key] as string[])
                            : [];
                          set(
                            f.key,
                            e.target.checked
                              ? [...prior, o.value]
                              : prior.filter((v) => v !== o.value),
                          );
                        }}
                      />
                      {o.label}
                      {o.description && <small>{o.description}</small>}
                    </label>
                  ))}
                  {f.custom && (
                    <label>
                      Additional choices, one per line
                      <textarea
                        value={(Array.isArray(values[f.key]) ? (values[f.key] as string[]) : [])
                          .filter((v) => !f.options.some((o) => o.value === v))
                          .join("\n")}
                        onChange={(e) => {
                          const selected = (
                            Array.isArray(values[f.key]) ? (values[f.key] as string[]) : []
                          ).filter((v) => f.options.some((o) => o.value === v));
                          set(f.key, [...selected, ...e.target.value.split("\n").filter(Boolean)]);
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <button type="submit" className="primary">
          {pending
            ? "Submitting…"
            : item.checkpoint?.kind === "plan" || item.checkpoint?.kind === "merge"
              ? "Submit checkpoint decision"
              : "Submit answer"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
export function NativePermission({
  item,
  refresh,
}: {
  item: AttentionPermission;
  refresh: () => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function reply(decision: "once" | "always" | "reject") {
    setPending(true);
    setError("");
    try {
      await api.replyPermission({ id: item.request.id, binding: item.binding, decision });
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Permission could not be confirmed");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="attention-card">
      <div className="eyebrow">Native permission</div>
      <h3>{item.request.action}</h3>
      <p>{item.request.message}</p>
      <ul>
        {item.request.resources.map((r) => (
          <li key={r}>
            <code>{r}</code>
          </li>
        ))}
      </ul>
      <div className="button-row">
        {(["once", "always", "reject"] as const).map((d) => (
          <button
            key={d}
            disabled={pending}
            onClick={() => {
              void reply(d);
            }}
          >
            {d === "once" ? "Allow once" : d === "always" ? "Always allow" : "Reject"}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
