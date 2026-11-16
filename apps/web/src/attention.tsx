/* oxlint-disable effecttsgo/unstable-api-usage -- Native form replies use independent typed Effect mutation atoms. */
import { useRef, useState } from "react";
import { useAtom } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { Form } from "@opencode/schema/form";
import type { AttentionForm, AttentionPermission } from "../../../src/web/contracts.ts";
import { formReply, permissionReply } from "./data.ts";
import {
  activeFields,
  initialValues,
  prepareAnswer,
  externalURL,
  type FormValues,
} from "./native-form.ts";
import { requestError } from "./request-state.tsx";
import { Alert, AlertDescription } from "./components/ui/alert.tsx";
import { Button } from "./components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.tsx";
import { Checkbox } from "./components/ui/checkbox.tsx";
import { Field, FieldDescription, FieldError, FieldLabel } from "./components/ui/field.tsx";
import { Input } from "./components/ui/input.tsx";
import { NativeSelect } from "./components/ui/native-select.tsx";
import { Textarea } from "./components/ui/textarea.tsx";

export function NativeForm(props: { item: AttentionForm; refresh: () => void }) {
  return <FormContent key={`${props.item.form.id}:${props.item.binding}`} {...props} />;
}
function FormContent({ item, refresh }: { item: AttentionForm; refresh: () => void }) {
  const { form } = item;
  const [values, setValues] = useState(() => initialValues(form.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, reply] = useAtom(formReply(`${form.id}:${item.binding}`), { mode: "promiseExit" });
  const submitting = useRef(false);
  const enabled = activeFields(form.fields, values);
  function set(key: string, value: Form.Value | undefined) {
    setValues((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !item.active) return;
    const prepared = prepareAnswer(form.fields, values);
    setErrors(prepared.errors);
    const first = Object.keys(prepared.errors)[0];
    if (first) {
      requestAnimationFrame(() => document.getElementById(`${form.id}-${first}`)?.focus());
      return;
    }
    submitting.current = true;
    try {
      const response = await reply({ id: form.id, binding: item.binding, answer: prepared.answer });
      if (Exit.isSuccess(response)) refresh();
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Card className="attention-card" data-native-form-id={form.id} tabIndex={-1}>
      <CardHeader>
        <div className="eyebrow">
          {item.checkpoint
            ? `${item.checkpoint.kind} decision · ${item.checkpoint.issue_id}`
            : "Abra needs your input"}
        </div>
        <CardTitle>
          <h3>{form.title}</h3>
        </CardTitle>
        {item.checkpoint?.fingerprint && (
          <code className="fingerprint">{item.checkpoint.fingerprint}</code>
        )}
      </CardHeader>
      <CardContent>
        {!item.active && (
          <Alert>
            <AlertDescription>
              This checkpoint is no longer current. Ask Abra to reconcile it.
            </AlertDescription>
          </Alert>
        )}
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <fieldset disabled={result.waiting || !item.active} className="space-y-5">
            {form.fields
              .filter(
                (field) => enabled.has(field.key) && (field.type === "external" || !field.hidden),
              )
              .map((field) => (
                <NativeField
                  key={field.key}
                  field={field}
                  id={`${form.id}-${field.key}`}
                  values={values}
                  set={set}
                  error={errors[field.key]}
                />
              ))}
            <Button type="submit">
              {result.waiting
                ? "Submitting…"
                : item.checkpoint?.kind === "plan" || item.checkpoint?.kind === "merge"
                  ? "Submit checkpoint decision"
                  : "Submit answer"}
            </Button>
          </fieldset>
          {Object.keys(errors).length > 0 && (
            <p className="text-destructive mt-3" role="alert">
              Check the highlighted fields before submitting.
            </p>
          )}
          {AsyncResult.isFailure(result) && (
            <Alert variant="destructive" role="alert" className="mt-3">
              <AlertDescription>{requestError(result.cause)}</AlertDescription>
            </Alert>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
function NativeField({
  field,
  id,
  values,
  set,
  error,
}: {
  field: Form.Field;
  id: string;
  values: FormValues;
  set: (key: string, value: Form.Value | undefined) => void;
  error?: string;
}) {
  const value = values[field.key];
  const title = field.title ?? field.key;
  const control = {
    id,
    "aria-invalid": Boolean(error),
    "aria-describedby": `${id}-description${error ? ` ${id}-error` : ""}`,
  };
  let content: React.ReactNode;
  switch (field.type) {
    case "external": {
      const href = externalURL(field.url);
      content = (
        <>
          {href ? (
            <a className="underline" href={href} target="_blank" rel="noopener noreferrer">
              {title} ↗
            </a>
          ) : (
            <p>Unsupported external link</p>
          )}
          <FieldLabel className="flex items-center gap-3">
            <Checkbox
              {...control}
              checked={value === true}
              onCheckedChange={(checked) => set(field.key, checked)}
            />
            I have completed: {field.title ?? "External step"}
          </FieldLabel>
        </>
      );
      break;
    }
    case "boolean":
      content = (
        <FieldLabel className="flex items-center gap-3">
          <Checkbox
            {...control}
            checked={value === true}
            onCheckedChange={(checked) => set(field.key, checked)}
          />
          {title}
          {field.required ? " *" : ""}
        </FieldLabel>
      );
      break;
    case "string":
      content =
        field.options && !field.custom ? (
          <NativeSelect
            {...control}
            required={field.required}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => set(field.key, event.target.value)}
          >
            <option value="">Choose…</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <>
            <Input
              {...control}
              type={
                field.format === "uri"
                  ? "url"
                  : field.format === "date-time"
                    ? "datetime-local"
                    : (field.format ?? "text")
              }
              required={field.required}
              minLength={field.minLength}
              maxLength={field.maxLength}
              pattern={field.pattern}
              placeholder={field.placeholder}
              list={field.options ? `${id}-choices` : undefined}
              value={typeof value === "string" ? value : ""}
              onChange={(event) => set(field.key, event.target.value)}
            />
            {field.options && (
              <datalist id={`${id}-choices`}>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            )}
          </>
        );
      break;
    case "number":
    case "integer":
      content = (
        <Input
          {...control}
          type="number"
          step={field.type === "integer" ? 1 : "any"}
          required={field.required}
          min={field.minimum}
          max={field.maximum}
          value={typeof value === "number" && Number.isFinite(value) ? value : ""}
          onChange={(event) =>
            set(field.key, event.target.value === "" ? undefined : event.target.valueAsNumber)
          }
        />
      );
      break;
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      content = (
        <div
          id={id}
          role="group"
          aria-labelledby={`${id}-label`}
          aria-describedby={control["aria-describedby"]}
          tabIndex={-1}
        >
          <div className="space-y-3">
            {field.options.map((option) => (
              <FieldLabel key={option.value} className="flex items-start gap-3">
                <Checkbox
                  checked={selected.includes(option.value)}
                  onCheckedChange={(checked) =>
                    set(
                      field.key,
                      checked
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                />
                <span>
                  {option.label}
                  {option.description && (
                    <small className="block text-muted-foreground">{option.description}</small>
                  )}
                </span>
              </FieldLabel>
            ))}
          </div>
          {field.custom && (
            <FieldLabel className="mt-3 block">
              Additional choices, one per line
              <Textarea
                value={selected
                  .filter((item) => !field.options.some((option) => option.value === item))
                  .join("\n")}
                onChange={(event) =>
                  set(field.key, [
                    ...new Set([
                      ...selected.filter((item) =>
                        field.options.some((option) => option.value === item),
                      ),
                      ...event.target.value.split("\n").filter(Boolean),
                    ]),
                  ])
                }
              />
            </FieldLabel>
          )}
        </div>
      );
      break;
    }
    default:
      field satisfies never;
  }
  return (
    <Field data-invalid={Boolean(error)}>
      {field.type !== "boolean" && field.type !== "external" && (
        <FieldLabel id={`${id}-label`} htmlFor={id}>
          {title}
          {field.required ? " *" : ""}
        </FieldLabel>
      )}
      {content}
      {field.description && (
        <FieldDescription id={`${id}-description`}>{field.description}</FieldDescription>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

export function NativePermission(props: { item: AttentionPermission; refresh: () => void }) {
  return <PermissionContent key={`${props.item.request.id}:${props.item.binding}`} {...props} />;
}
function PermissionContent({ item, refresh }: { item: AttentionPermission; refresh: () => void }) {
  const [result, reply] = useAtom(permissionReply(`${item.request.id}:${item.binding}`), {
    mode: "promiseExit",
  });
  const submitting = useRef(false);
  async function answer(decision: "once" | "always" | "reject") {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const response = await reply({ id: item.request.id, binding: item.binding, decision });
      if (Exit.isSuccess(response)) refresh();
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Card className="attention-card">
      <CardHeader>
        <div className="eyebrow">Native permission</div>
        <CardTitle>
          <h3>{item.request.action}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>{item.request.message}</p>
        <ul>
          {item.request.resources.map((resource) => (
            <li key={resource}>
              <code>{resource}</code>
            </li>
          ))}
        </ul>
        <div className="button-row">
          {(["once", "always", "reject"] as const).map((decision) => (
            <Button
              key={decision}
              variant={decision === "reject" ? "outline" : "default"}
              disabled={result.waiting}
              onClick={() => {
                void answer(decision);
              }}
            >
              {decision === "once"
                ? "Allow once"
                : decision === "always"
                  ? "Always allow"
                  : "Reject"}
            </Button>
          ))}
        </div>
        {AsyncResult.isFailure(result) && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{requestError(result.cause)}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
