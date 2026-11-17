/* oxlint-disable effecttsgo/unstable-api-usage -- Native form replies use independent typed Effect mutation atoms. */
import { useRef, useState } from "react";
import { ArrowUpRight } from "@abracode/presentation/icons";
import { useAtom } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { Form } from "@opencode/schema/form";
import type { AttentionForm, AttentionPermission } from "@abracode/contracts/web/contracts";
import { formReply, permissionReply } from "./data.ts";
import {
  activeFields,
  initialValues,
  initialCustomChoices,
  dateTimeDisplay,
  editingValues,
  prepareAnswer,
  externalURL,
  type FormValues,
} from "./native-form.ts";
import { requestError } from "./request-state.tsx";
import { Alert, AlertDescription } from "@abracode/presentation/ui/alert";
import { Button } from "@abracode/presentation/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@abracode/presentation/ui/card";
import { Checkbox } from "@abracode/presentation/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@abracode/presentation/ui/field";
import { Input } from "@abracode/presentation/ui/input";
import { NativeSelect } from "@abracode/presentation/ui/native-select";
import { Textarea } from "@abracode/presentation/ui/textarea";

export function NativeForm(props: { item: AttentionForm; refresh: () => void }) {
  return <FormContent key={`${props.item.form.id}:${props.item.binding}`} {...props} />;
}
function FormContent({ item, refresh }: { item: AttentionForm; refresh: () => void }) {
  const { form } = item;
  const [values, setValues] = useState(() => initialValues(form.fields));
  const [customText, setCustomText] = useState(() => initialCustomChoices(form.fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, reply] = useAtom(formReply(`${form.id}:${item.binding}`), { mode: "promiseExit" });
  const submitting = useRef(false);
  const enabled = activeFields(form.fields, editingValues(form.fields, values, customText));
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
    const prepared = prepareAnswer(form.fields, values, customText);
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
                  customText={customText[field.key] ?? ""}
                  setCustomText={(text) => {
                    setCustomText((previous) => ({ ...previous, [field.key]: text }));
                    setErrors((previous) => {
                      const next = { ...previous };
                      delete next[field.key];
                      return next;
                    });
                  }}
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
  customText,
  setCustomText,
}: {
  field: Form.Field;
  id: string;
  values: FormValues;
  set: (key: string, value: Form.Value | undefined) => void;
  error?: string;
  customText: string;
  setCustomText: (value: string) => void;
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
              {title} <ArrowUpRight aria-hidden="true" />
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
              step={field.format === "date-time" ? "any" : undefined}
              value={
                typeof value === "string"
                  ? field.format === "date-time"
                    ? dateTimeDisplay(value)
                    : value
                  : ""
              }
              onChange={(event) => set(field.key, event.target.value)}
            />
            {field.format === "date-time" && (
              <p className="muted">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            )}
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
        <fieldset
          id={id}
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
            <div className="mt-3">
              <FieldLabel htmlFor={`${id}-custom`}>Additional choices, one per line</FieldLabel>
              <Textarea
                id={`${id}-custom`}
                aria-invalid={Boolean(error)}
                aria-describedby={control["aria-describedby"]}
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
              />
            </div>
          )}
        </fieldset>
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
