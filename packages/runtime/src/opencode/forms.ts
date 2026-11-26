import { sha256 } from "../digest.ts";
import { nativeDomain, nativeError } from "./native-call.ts";
import { Effect } from "effect";
import type { OpenCodeClient } from "@opencode/client/effect";
import type {
  Commit,
  Fingerprint,
  FormId,
  QuestionIdentity,
  SessionId,
} from "@abracode/contracts/identities";
import { CrewError } from "../domain.ts";
import { decode } from "../decode.ts";
import { canonicalJSON } from "../presentation/identity.ts";
import {
  FinishingAnswerSchema,
  validFinishingAnswer,
  type FinishingAnswer,
  type FinishingTarget,
} from "../workflow/finishing/contracts.ts";

export type QuestionAnswer =
  | { status: "pending" | "cancelled"; answer?: never }
  | { status: "answered"; answer: string };

export type DispositionAnswer =
  | { status: "pending" | "cancelled" }
  | { status: "answered"; answer: FinishingAnswer };

const targetFingerprint = (target: FinishingTarget) => sha256(canonicalJSON(target));

type NativeFormInput = Parameters<OpenCodeClient["session"]["form"]["create"]>[0];

function ensureForm(
  client: OpenCodeClient,
  input: NativeFormInput & { id: FormId },
  conflict: CrewError,
) {
  return Effect.gen(function* () {
    const forms = client.session.form;
    const existing = yield* forms.get({ sessionID: input.sessionID, formID: input.id }).pipe(
      Effect.catchTag("FormNotFoundError", () => Effect.undefined),
      Effect.mapError(nativeError),
    );
    if (!existing) return (yield* nativeDomain(forms).create(input)).id;
    if (
      !Object.entries(input.metadata ?? {}).every(
        ([key, value]) => existing.metadata?.[key] === value,
      )
    )
      return yield* conflict;
    return existing.id;
  });
}

export const requestDisposition = (
  client: OpenCodeClient,
  sessionID: SessionId,
  id: FormId,
  question: string,
  identity: QuestionIdentity,
  target: FinishingTarget,
) => {
  const residue = target.kind === "residue" ? target : undefined;
  const planning = target.kind === "planning_baseline_adoption";
  return ensureForm(
    client,
    {
      sessionID,
      id,
      title: question.slice(0, 512),
      metadata: {
        source: "abracode",
        decision_identity: identity,
        finishing_target: targetFingerprint(target),
      },
      fields: [
        {
          key: "action",
          type: "string",
          required: true,
          custom: false,
          default: "defer",
          title: "Choose how to handle this work",
          description: planning
            ? "Adopt this exact current Git-defined source as a NEW baseline, not historical reconstruction. This grants no implementation, publication, merge or cleanup authority. Fresh plan approval, checks and independent Review remain required. Exact offer: " +
              JSON.stringify(target)
            : residue
              ? "Generated directories: authorize disposal of generated contents in the selected exact directories after delivery is preserved. Include: send selected files through scope assessment, checks and Review. Preserve: move selected items elsewhere, then automatic inspection must confirm absence. Defer: keep everything and wait."
              : "Authorize assessment of this exact retained content only; this grants no repair, merge or arbitrary deletion permission.",
          options: [
            ...(residue
              ? [
                  ...(residue.directories.length
                    ? [{ value: "generated", label: "Authorize generated-directory cleanup" }]
                    : []),
                  ...(residue.files.length
                    ? [{ value: "include", label: "Include files in delivery" }]
                    : []),
                  { value: "preserve", label: "I will preserve selected items elsewhere" },
                ]
              : [
                  {
                    value: "authorize",
                    label: planning
                      ? "Adopt this exact new planning baseline"
                      : "Authorize this exact assessment",
                  },
                  ...(planning ? [{ value: "reject", label: "Reject this baseline" }] : []),
                ]),
            { value: "defer", label: "Defer and preserve everything" },
          ],
        },
        ...(residue
          ? (["generated", "include", "preserve"] as const).flatMap((action) => {
              const paths =
                action === "generated"
                  ? residue.directories.map((d) => d.path)
                  : action === "include"
                    ? residue.files.map((f) => f.path)
                    : residue.paths.map((p) => p.path);
              return paths.length
                ? [
                    {
                      key: `${action}_paths`,
                      type: "multiselect" as const,
                      required: true,
                      custom: false,
                      title: "Exact paths",
                      minItems: 1,
                      maxItems: 64,
                      when: [{ key: "action", op: "eq" as const, value: action }],
                      options: paths.map((path) => ({
                        value: path,
                        label: JSON.stringify(path),
                      })),
                    },
                  ]
                : [];
            })
          : []),
      ],
    },
    new CrewError("DECISION_FORM", "Finishing form belongs to another exact target"),
  );
};

export const readDisposition = (
  client: OpenCodeClient,
  sessionID: SessionId,
  formID: FormId,
  identity: QuestionIdentity,
  target: FinishingTarget,
): Effect.Effect<DispositionAnswer, CrewError> =>
  Effect.gen(function* () {
    const form = yield* nativeDomain(client.session.form).get({ sessionID, formID });
    const fingerprint = targetFingerprint(target);
    if (
      form.metadata?.decision_identity !== identity ||
      form.metadata?.finishing_target !== fingerprint
    )
      return yield* new CrewError("DECISION_FORM", "Finishing answer belongs to another target");
    if (form.state.status !== "answered") return { status: form.state.status };
    const action = yield* decode(
      FinishingAnswerSchema.fields.action,
      form.state.answer.action,
      "Native finishing action",
    );
    const answer = yield* decode(
      FinishingAnswerSchema,
      {
        action,
        paths: form.state.answer[`${action}_paths`] ?? [],
      },
      "Native finishing answer",
    );
    if (!validFinishingAnswer(target, answer))
      return yield* new CrewError(
        "DECISION_ANSWER",
        "Disposition is outside the exact retained target",
      );
    return { status: "answered" as const, answer };
  });

export const requestQuestion = (
  client: OpenCodeClient,
  session: SessionId,
  id: FormId,
  question: string,
  identity: QuestionIdentity,
) =>
  ensureForm(
    client,
    {
      sessionID: session,
      id,
      title: question.slice(0, 512),
      metadata: { source: "abracode", decision_identity: identity },
      fields: [
        {
          key: "answer",
          type: "string",
          required: true,
          minLength: 1,
          maxLength: 8192,
          title: "Answer this question",
        },
      ],
    },
    new CrewError("DECISION_FORM", "Form belongs to another question"),
  );

export const readQuestionAnswer = (
  client: OpenCodeClient,
  session: SessionId,
  id: FormId,
): Effect.Effect<QuestionAnswer, CrewError> =>
  Effect.gen(function* () {
    const form = yield* nativeDomain(client.session.form).get({
      sessionID: session,
      formID: id,
    });
    if (form.state.status === "cancelled") return { status: "cancelled" as const };
    if (form.state.status !== "answered") return { status: "pending" as const };
    const answer = form.state.answer.answer;
    if (typeof answer !== "string" || !(answer.length > 0) || !(answer.length <= 8192))
      return yield* new CrewError("DECISION_ANSWER", "Invalid native question answer");
    return { status: "answered" as const, answer };
  });

export const requestApproval = (
  client: OpenCodeClient,
  sessionID: SessionId,
  id: FormId,
  title: string,
  fingerprint: Fingerprint | Commit,
) =>
  ensureForm(
    client,
    {
      sessionID,
      id,
      title,
      metadata: { source: "abracode", fingerprint },
      fields: [
        {
          key: "authorize",
          type: "boolean",
          required: true,
          title: "Authorize this exact checkpoint",
          default: false,
        },
      ],
    },
    new CrewError("APPROVAL_FORM", "Existing native form belongs to another checkpoint"),
  );

export const readApproval = (
  client: OpenCodeClient,
  sessionID: SessionId,
  formID: FormId,
): Effect.Effect<"pending" | "approved" | "rejected", CrewError> =>
  Effect.gen(function* () {
    const f = yield* nativeDomain(client.session.form).get({
      sessionID,
      formID,
    });
    return f.state.status === "answered"
      ? f.state.answer.authorize === true
        ? "approved"
        : "rejected"
      : f.state.status === "cancelled"
        ? "rejected"
        : "pending";
  });
