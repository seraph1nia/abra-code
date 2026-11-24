import { Schema } from "effect";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  A2uiSurface,
  createComponentImplementation,
  MarkdownComponentContext,
  useSignalValue,
  type ReactCatalogComponent,
} from "@a2ui/react";
import {
  basicCatalog,
  MessageProcessor,
  type DataModel,
  type SurfaceModel,
} from "@a2ui/web_core/v1_0";
import {
  implementedReviewCatalog,
  reviewCatalog,
  ReviewFormSchema,
  reviewSurface,
  reviewValidation,
} from "@abracode/contracts/web/review-catalog";
import {
  CommentFieldSchema,
  DesignChoiceSchema,
  MultiSelectSchema,
  ReviewDefinitionSchema,
  SingleSelectSchema,
  type ReviewAnswers,
  type ReviewDefinition,
  type ReviewField,
} from "@abracode/contracts/web/reviews";
import { A2uiMarkdown } from "./surfaces.tsx";
import { SurfaceOwner } from "./surface-owner.ts";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

type Props = {
  review: ReviewDefinition;
  answers: ReviewAnswers;
  errors: Readonly<Record<string, string>>;
  disabled: boolean;
  change: (id: string, value: string | readonly string[]) => void;
  image: (id: string, label: string) => ReactNode;
};

/** Host-only capabilities that cannot live in A2UI data (DOM ID prefix, change callback, asset loader). */
type ReviewHost = {
  prefix: string;
  change: (id: string, value: string | readonly string[]) => void;
  image: (id: string, label: string) => ReactNode;
};

const ReviewHostContext = createContext<ReviewHost | undefined>(undefined);
function useReviewHost() {
  const value = useContext(ReviewHostContext);
  if (!value) throw new Error("Review controls require their host context");
  return value;
}

const decodeReviewForm = Schema.decodeUnknownSync(ReviewFormSchema);
const decodeSingleSelect = Schema.decodeUnknownSync(SingleSelectSchema);
const decodeMultiSelect = Schema.decodeUnknownSync(MultiSelectSchema);
const decodeDesignChoice = Schema.decodeUnknownSync(DesignChoiceSchema);
const decodeCommentField = Schema.decodeUnknownSync(CommentFieldSchema);

function sameAnswer(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => v === b[i]);
  return false;
}

function sameReviewDefinition(a: ReviewDefinition, b: ReviewDefinition): boolean {
  return a === b || (a.review_id === b.review_id && JSON.stringify(a) === JSON.stringify(b));
}

function ReviewHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <div className="eyebrow">Your feedback</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </header>
  );
}

function FieldControl({ field, dataModel }: { field: ReviewField; dataModel: DataModel }) {
  const { prefix, change, image } = useReviewHost();
  const answerSignal = useMemo(
    () => dataModel.getSignal<string | readonly string[]>(`/answers/${field.id}`),
    [dataModel, field.id],
  );
  const errorSignal = useMemo(
    () => dataModel.getSignal<string>(`/errors/${field.id}`),
    [dataModel, field.id],
  );
  const disabledSignal = useMemo(() => dataModel.getSignal<boolean>("/disabled"), [dataModel]);

  const value = useSignalValue(answerSignal);
  const error = useSignalValue(errorSignal);
  const disabled = useSignalValue(disabledSignal) ?? false;

  const [enlarged, setEnlarged] = useState<{ id: string; label: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (enlarged && !element.open) element.showModal();
    else if (!enlarged && element.open) element.close();
  }, [enlarged]);

  const updateValue = (next: string | readonly string[]) => {
    dataModel.set(`/answers/${field.id}`, next);
    change(field.id, next);
  };

  const id = `${prefix}-${field.id}`;
  return (
    <fieldset
      className="review-field"
      disabled={disabled}
      aria-describedby={`${id}-description ${id}-error`}
    >
      <legend id={`${id}-label`}>
        {field.label}
        {field.required && <span aria-label="required"> *</span>}
      </legend>
      {field.description && (
        <p id={`${id}-description`} className="muted">
          {field.description}
        </p>
      )}
      {field.component === "CommentField" ? (
        <Textarea
          aria-labelledby={`${id}-label`}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={!!error}
          value={typeof value === "string" ? value : ""}
          maxLength={4096}
          rows={3}
          onChange={(e) => updateValue(e.target.value)}
        />
      ) : (
        <div
          className={field.component === "DesignChoiceGroup" ? "review-designs" : "review-options"}
        >
          {field.options.map((option) => {
            const checked = Array.isArray(value)
              ? value.includes(option.value)
              : value === option.value;
            const controlId = `${id}-${option.value}`;
            return (
              <div
                className={`review-option ${checked ? "review-option-selected" : ""}`}
                key={option.value}
              >
                {"preview" in option && (
                  <div className="review-design-preview">
                    <button
                      type="button"
                      className="review-select-preview"
                      aria-label={`Select ${option.label}`}
                      aria-pressed={checked}
                      onClick={() => updateValue(option.value)}
                    >
                      {image(option.preview, option.label)}
                    </button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setEnlarged({ id: option.preview, label: option.label })}
                    >
                      Enlarge {option.label}
                    </Button>
                  </div>
                )}
                <label htmlFor={controlId} className="review-option-label">
                  {field.component === "MultiSelect" ? (
                    <input
                      type="checkbox"
                      id={controlId}
                      checked={checked}
                      onChange={(event) =>
                        updateValue(
                          event.currentTarget.checked
                            ? [...(Array.isArray(value) ? value : []), option.value]
                            : (Array.isArray(value) ? value : []).filter((v) => v !== option.value),
                        )
                      }
                    />
                  ) : (
                    <input
                      id={controlId}
                      type="radio"
                      name={id}
                      value={option.value}
                      checked={checked}
                      onChange={() => updateValue(option.value)}
                    />
                  )}
                  <span>
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
      <span id={`${id}-error`} className="error" role={error ? "alert" : undefined}>
        {error}
      </span>
      <dialog
        ref={dialog}
        className="review-enlarged"
        aria-labelledby={`${id}-preview-title`}
        onCancel={(event) => {
          event.preventDefault();
          setEnlarged(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <div className="review-preview-header">
          <h4 id={`${id}-preview-title`}>{enlarged?.label}</h4>
          <Button type="button" variant="outline" onClick={() => setEnlarged(undefined)}>
            Close preview
          </Button>
        </div>
        <p className="muted">Design preview. Close to return to your choices.</p>
        {enlarged && image(enlarged.id, enlarged.label)}
      </dialog>
    </fieldset>
  );
}

const reactReviewCatalog = implementedReviewCatalog<ReactCatalogComponent>([
  ...["Column", "Row", "Text"].map((name) => basicCatalog.components.get(name)!),
  createComponentImplementation(reviewCatalog.components.get("ReviewForm")!, ({ props }) => {
    const form = useMemo(() => decodeReviewForm({ ...props, component: "ReviewForm" }), [props]);
    return <ReviewHeading title={form.title} description={form.description} />;
  }),
  createComponentImplementation(
    reviewCatalog.components.get("SingleSelect")!,
    ({ props, context }) => {
      const fieldId = context.componentModel.id;
      const field = useMemo(
        () => decodeSingleSelect({ ...props, id: fieldId, component: "SingleSelect" }),
        [props, fieldId],
      );
      return <FieldControl field={field} dataModel={context.dataContext.dataModel} />;
    },
  ),
  createComponentImplementation(
    reviewCatalog.components.get("MultiSelect")!,
    ({ props, context }) => {
      const fieldId = context.componentModel.id;
      const field = useMemo(
        () => decodeMultiSelect({ ...props, id: fieldId, component: "MultiSelect" }),
        [props, fieldId],
      );
      return <FieldControl field={field} dataModel={context.dataContext.dataModel} />;
    },
  ),
  createComponentImplementation(
    reviewCatalog.components.get("DesignChoiceGroup")!,
    ({ props, context }) => {
      const fieldId = context.componentModel.id;
      const field = useMemo(
        () => decodeDesignChoice({ ...props, id: fieldId, component: "DesignChoiceGroup" }),
        [props, fieldId],
      );
      return <FieldControl field={field} dataModel={context.dataContext.dataModel} />;
    },
  ),
  createComponentImplementation(
    reviewCatalog.components.get("CommentField")!,
    ({ props, context }) => {
      const fieldId = context.componentModel.id;
      const field = useMemo(
        () => decodeCommentField({ ...props, id: fieldId, component: "CommentField" }),
        [props, fieldId],
      );
      return <FieldControl field={field} dataModel={context.dataContext.dataModel} />;
    },
  ),
]);

type RenderedReview = {
  processor: MessageProcessor<ReactCatalogComponent>;
  surface: SurfaceModel<ReactCatalogComponent>;
  review: ReviewDefinition;
};

function prepareReviewSurface(input: ReviewDefinition): RenderedReview {
  const processor = new MessageProcessor<ReactCatalogComponent>([reactReviewCatalog], undefined, {
    version: "1.0",
    validationConfig: reviewValidation,
  });
  try {
    const review = Schema.decodeSync(ReviewDefinitionSchema)(input, {
      onExcessProperty: "error",
    });
    processor.processMessages(reviewSurface(review));
    const surface = processor.model.getSurface(review.review_id);
    if (!surface) throw new Error("Review surface unavailable");
    return { processor, surface, review };
  } catch (error) {
    processor.dispose();
    throw error;
  }
}

function syncReviewDataModel(
  surface: SurfaceModel<ReactCatalogComponent>,
  review: ReviewDefinition,
  answers: ReviewAnswers,
  errors: Readonly<Record<string, string>>,
  disabled: boolean,
) {
  const { dataModel } = surface;
  if (dataModel.get("/disabled") !== disabled) dataModel.set("/disabled", disabled);
  for (const field of review.fields) {
    const answerPath = `/answers/${field.id}`;
    const nextAnswer = answers[field.id];
    if (!sameAnswer(dataModel.get(answerPath), nextAnswer)) {
      dataModel.set(answerPath, nextAnswer);
    }
    const errorPath = `/errors/${field.id}`;
    const nextError = errors[field.id];
    if (dataModel.get(errorPath) !== nextError) {
      dataModel.set(errorPath, nextError);
    }
  }
}

/** Pure A2UI presentation. State flows through SurfaceModel.dataModel; host owns assets & submission. */
export function ReviewControls({ review, answers, errors, disabled, change, image }: Props) {
  const prefix = useId();
  const [owner] = useState(
    () =>
      new SurfaceOwner(
        review,
        prepareReviewSurface,
        (rendered) => rendered.processor.dispose(),
        sameReviewDefinition,
      ),
  );
  const view = useSyncExternalStore(owner.subscribe, owner.read, owner.read);
  useEffect(() => owner.replace(review), [owner, review]);
  useEffect(() => owner.committed(view), [owner, view]);

  const { rendered, error } = view;
  // Sync host-managed answers, validation errors and disabled state into the A2UI DataModel
  // without recreating the MessageProcessor.
  useEffect(() => {
    if (!rendered) return;
    syncReviewDataModel(rendered.surface, rendered.review, answers, errors, disabled);
  }, [rendered, answers, errors, disabled]);

  const host = useMemo<ReviewHost>(() => ({ prefix, change, image }), [prefix, change, image]);

  return (
    <ReviewHostContext.Provider value={host}>
      <div data-a2ui-review="true">
        {error && (
          <output role="alert" className="error">
            Review form unavailable: its definition is invalid.
          </output>
        )}
        {rendered && (
          <MarkdownComponentContext.Provider value={A2uiMarkdown}>
            <A2uiSurface key={rendered.review.review_id} surface={rendered.surface} />
          </MarkdownComponentContext.Provider>
        )}
      </div>
    </ReviewHostContext.Provider>
  );
}
