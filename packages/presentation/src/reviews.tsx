import { Schema } from "effect";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
} from "@a2ui/react";
import { basicCatalog, MessageProcessor } from "@a2ui/web_core/v1_0";
import {
  implementedReviewCatalog,
  reviewCatalog,
  reviewComponentSchemas,
  reviewSurface,
} from "@abracode/contracts/web/review-catalog";
import {
  ReviewDefinitionSchema,
  type ReviewAnswers,
  type ReviewDefinition,
  type ReviewField,
} from "@abracode/contracts/web/reviews";
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
const ReviewContext = createContext<(Props & { prefix: string }) | undefined>(undefined);
function useReview() {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("Review controls require their host context");
  return value;
}
function ReviewHeading() {
  const { review } = useReview();
  return (
    <header>
      <div className="eyebrow">Your feedback</div>
      <h3>{review.title}</h3>
      {review.description && <p>{review.description}</p>}
    </header>
  );
}
function ReviewFieldView({ id }: { id: string }) {
  const context = useReview();
  const field = context.review.fields.find((f) => f.id === id);
  if (!field) return <p role="alert">Review field unavailable.</p>;
  return <FieldControl field={field} />;
}
function FieldControl({ field }: { field: ReviewField }) {
  const { prefix, answers, errors, disabled, change, image } = useReview();
  const [enlarged, setEnlarged] = useState<{ id: string; label: string }>();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (enlarged && !element.open) element.showModal();
    else if (!enlarged && element.open) element.close();
  }, [enlarged]);
  const id = `${prefix}-${field.id}`,
    error = errors[field.id],
    value = answers[field.id];
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
          onChange={(e) => change(field.id, e.target.value)}
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
                      onClick={() => change(field.id, option.value)}
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
                        change(
                          field.id,
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
                      onChange={() => change(field.id, option.value)}
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
  ...Object.keys(reviewComponentSchemas).map((name) =>
    createComponentImplementation(reviewCatalog.components.get(name)!, ({ context }) =>
      name === "ReviewForm" ? (
        <ReviewHeading />
      ) : (
        <ReviewFieldView id={context.componentModel.id} />
      ),
    ),
  ),
]);

/** Pure A2UI presentation. Only the host supplies state, assets and submission. */
export function ReviewControls(props: Props) {
  const prefix = useId();
  const definition = JSON.stringify(props.review);
  const rendered = useMemo(() => {
    const processor = new MessageProcessor<ReactCatalogComponent>([reactReviewCatalog], undefined, {
      version: "1.0",
    });
    try {
      const review = Schema.decodeUnknownSync(ReviewDefinitionSchema)(JSON.parse(definition));
      processor.processMessages(reviewSurface(review));
      const surface = processor.model.getSurface(review.review_id);
      if (!surface) throw new Error("Review surface unavailable");
      return { processor, surface };
    } catch (error) {
      processor.dispose();
      throw error;
    }
  }, [definition]);
  useEffect(() => () => rendered.processor.dispose(), [rendered]);
  return (
    <ReviewContext.Provider value={{ ...props, prefix }}>
      <div data-a2ui-review="true">
        <A2uiSurface surface={rendered.surface} />
      </div>
    </ReviewContext.Provider>
  );
}
