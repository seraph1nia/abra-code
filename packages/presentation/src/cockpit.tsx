import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "#utils";

export type StatusTone = "neutral" | "running" | "success" | "attention" | "danger";

export function statusTone(value?: string | null): StatusTone {
  if (!value) return "neutral";
  const normalized = value.toLowerCase();
  if (
    /block|fail|error|refus|reject|danger|denied|stale|conflict|cancel|unavail|expired|overdue/.test(
      normalized,
    )
  )
    return "danger";
  if (
    /wait|pending|approval|attention|open decision|unanswered|warn|action|review/.test(normalized)
  )
    return "attention";
  if (
    /running|progress|working|stream|active|implement|explor|research|admit|queue/.test(normalized)
  )
    return "running";
  if (/pass|approv|deliver|complete|done|publish|ready|merged|accept|clean|open/.test(normalized))
    return "success";
  return "neutral";
}

export function StatusBadge({
  tone = "neutral",
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: StatusTone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("status-badge", `tone-${tone}`, className)} data-tone={tone}>
      {dot && <span className={cn("status-badge-dot", pulse && "is-pulsing")} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function SectionCard({
  title,
  icon,
  actions,
  accent,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  accent?: "attention" | "danger" | "success";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn("section-card", accent && `section-card-${accent}`, className)}
    >
      {(title || actions) && (
        <header className="section-card-head">
          <div className="section-card-title">
            {icon}
            {typeof title === "string" ? <h3>{title}</h3> : title}
          </div>
          {actions && <div className="section-card-actions">{actions}</div>}
        </header>
      )}
      <div className="section-card-body">{children}</div>
    </section>
  );
}

export function EvidenceDisclosure({
  summary,
  defaultOpen,
  open,
  onToggle,
  className,
  children,
  ...rest
}: Omit<ComponentPropsWithoutRef<"details">, "onToggle"> & {
  summary: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      {...rest}
      className={cn("evidence-disclosure", className)}
      open={open ?? defaultOpen}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
    >
      <summary>{summary}</summary>
      <div className="evidence-disclosure-body">{children}</div>
    </details>
  );
}
