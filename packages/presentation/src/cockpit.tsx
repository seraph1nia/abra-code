import {
  phaseMetadata,
  phaseLabel,
  type Section,
} from "@abracode/contracts/presentation/work-state";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "#utils";

export type StatusTone = "neutral" | "running" | "success" | "attention" | "danger";

const sectionTone = {
  attention: "attention",
  working: "running",
  blocked: "danger",
  queued: "running",
  done: "success",
  other: "neutral",
} satisfies Record<Section, StatusTone>;
const tones = new Map<string, StatusTone>();
for (const phase of Object.keys(phaseMetadata) as (keyof typeof phaseMetadata)[]) {
  const tone = sectionTone[phaseMetadata[phase].section];
  tones.set(phase, tone);
  tones.set(phaseLabel(phase).toLowerCase(), tone);
}
const statuses = {
  neutral: [
    "open",
    "idle",
    "disabled",
    "retained",
    "retained work",
    "draft",
    "superseded",
    "inactive",
  ],
  running: [
    "running",
    "in progress",
    "in_progress",
    "working",
    "streaming",
    "active",
    "admitted",
    "queued",
    "loading",
    "submitting",
  ],
  success: [
    "closed",
    "approved",
    "ready",
    "succeeded",
    "success",
    "passed",
    "completed",
    "done",
    "published",
    "merged",
    "accepted",
    "delivered",
    "answered",
    "confirmed",
    "available",
    "cleared",
    "handled",
  ],
  attention: [
    "waiting",
    "pending",
    "needs approval",
    "awaiting approval",
    "review",
    "unanswered",
    "attention",
    "action required",
    "uncertain",
    "stopping",
    "user_needed",
  ],
  danger: [
    "blocked",
    "failed",
    "error",
    "refused",
    "rejected",
    "denied",
    "stale",
    "conflict",
    "cancelled",
    "unavailable",
    "expired",
    "overdue",
    "cleanup blocked",
    "observation unavailable",
  ],
} satisfies Record<StatusTone, readonly string[]>;
for (const tone of Object.keys(statuses) as StatusTone[])
  for (const status of statuses[tone]) tones.set(status, tone);

export function statusTone(value?: string | null): StatusTone {
  return tones.get(value?.trim().toLowerCase() ?? "") ?? "neutral";
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
          {title && (
            <h3 className="section-card-title">
              {icon}
              {title}
            </h3>
          )}
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
  const [expanded, setExpanded] = useState(() => defaultOpen ?? false);
  return (
    <details
      {...rest}
      className={cn("evidence-disclosure", className)}
      open={open ?? expanded}
      onToggle={(event) => {
        const value = event.currentTarget.open;
        if (open === undefined) setExpanded(value);
        onToggle?.(value);
      }}
    >
      <summary>{summary}</summary>
      <div className="evidence-disclosure-body">{children}</div>
    </details>
  );
}
