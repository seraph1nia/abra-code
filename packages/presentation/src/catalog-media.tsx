/* oxlint-disable jsx-a11y/media-has-caption -- A2UI v1 exposes the container’s native caption tracks and has no separate track URL property. */
export type MediaKind = "Image" | "Video" | "AudioPlayer";
const fits = {
  contain: "contain",
  cover: "cover",
  fill: "fill",
  none: "none",
  scaleDown: "scale-down",
} as const;

// Evaluate after data binding, including updates from editable fields.
export function mediaUrl(value: unknown, frozen: boolean) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  let start = 0,
    end = trimmed.length;
  while (start < end && trimmed.charCodeAt(start) <= 32) start++;
  while (end > start && trimmed.charCodeAt(end - 1) <= 32) end--;
  const url = trimmed.slice(start, end);
  if (/^data:/i.test(url)) return url;
  if (!url || frozen) return;
  // URL parsers remove these characters before interpreting the scheme or host.
  const normalized = url.replace(/[\t\n\r]/g, "");
  if (/^[\\/]{2}/.test(normalized)) return;
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(normalized);
  if (absolute && !/^https?:\/\/[^/\\?#\s]/i.test(url)) return;
  try {
    const parsed = new URL(normalized, "https://relative.invalid/");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return normalized;
  } catch {
    return;
  }
}

export function CatalogMedia({
  kind,
  props,
  frozen,
}: {
  kind: MediaKind;
  props: Record<string, unknown>;
  frozen: boolean;
}) {
  const src = mediaUrl(props.url, frozen);
  const description = typeof props.description === "string" ? props.description : "";
  if (!src)
    return frozen && props.url ? (
      <span>{description || kind} · Media unavailable offline</span>
    ) : null;
  if (kind === "Video")
    return (
      <video
        className="catalog-player"
        controls
        preload="metadata"
        src={src}
        poster={mediaUrl(props.posterUrl, frozen)}
      />
    );
  if (kind === "AudioPlayer")
    return (
      <div>
        {description && <span>{description}</span>}
        <audio
          className="catalog-player"
          aria-label={description || undefined}
          controls
          preload="metadata"
          src={src}
        />
      </div>
    );
  const fit = fits[props.fit as keyof typeof fits] ?? "cover";
  return (
    <img
      className="catalog-image"
      data-variant={typeof props.variant === "string" ? props.variant : "mediumFeature"}
      style={{ objectFit: fit }}
      src={src}
      alt={description}
    />
  );
}
