import type { CSSProperties } from "react";

export type MediaKind = "Image" | "Video" | "AudioPlayer";
const fits = { contain: "contain", cover: "cover", fill: "fill", none: "none", scaleDown: "scale-down" } as const;

// Evaluate after data binding, including updates from editable fields.
export function mediaUrl(value: unknown, frozen: boolean) {
  if (typeof value !== "string") return;
  const url = value.trim();
  if (/^data:/i.test(url)) return url;
  if (!url || frozen) return;
  // Reject ambiguous authorities and schemes before the browser normalizes them.
  if (/[\t\n\r]/.test(url) || /^[\\/]{2}/.test(url)) return;
  if (/^[a-z][a-z\d+.\-]*:/i.test(url) && !/^https?:\/\/[^/\\?#\s]/i.test(url)) return;
  try {
    const parsed = new URL(url, "https://relative.invalid/");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch {
    return;
  }
}

export function CatalogMedia({ kind, props, frozen }: {
  kind: MediaKind; props: Record<string, unknown>; frozen: boolean;
}) {
  const src = mediaUrl(props.url, frozen);
  const description = typeof props.description === "string" ? props.description : "";
  if (!src) return frozen && props.url ? <span>{description || kind} · Media unavailable offline</span> : null;
  if (kind === "Video") return <video className="catalog-player" controls preload="metadata" src={src} poster={mediaUrl(props.posterUrl, frozen)} />;
  if (kind === "AudioPlayer") return <div>{description && <span>{description}</span>}<audio className="catalog-player" aria-label={description || undefined} controls preload="metadata" src={src} /></div>;
  const fit = fits[props.fit as keyof typeof fits] ?? "cover";
  return <img className="catalog-image" data-variant={typeof props.variant === "string" ? props.variant : "mediumFeature"} style={{ objectFit: fit } satisfies CSSProperties} src={src} alt={description} />;
}
