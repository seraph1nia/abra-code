/* oxlint-disable jsx-a11y/media-has-caption -- A2UI v1 exposes the container’s native caption tracks and has no separate track URL property. */
import { catalogHttpUrl } from "@abracode/contracts/web/catalog";
import { sanitizeMediaUrl } from "@a2ui/web_core/v1_0";

export type MediaKind = "Image" | "Video" | "AudioPlayer";
const fits = {
  contain: "contain",
  cover: "cover",
  fill: "fill",
  none: "none",
  scaleDown: "scale-down",
} as const;

const allowedDataUrl: Record<MediaKind, RegExp> = {
  Image: /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/i,
  AudioPlayer: /^data:audio\/(?:mpeg|ogg|wav|webm);base64,[A-Za-z0-9+/=\s]*$/i,
  Video: /^data:video\/(?:mp4|webm);base64,[A-Za-z0-9+/=\s]*$/i,
};

// Evaluate after data binding, including updates from editable fields.
export function mediaUrl(value: unknown, frozen: boolean, kind: MediaKind = "Image") {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  let start = 0,
    end = trimmed.length;
  while (start < end && trimmed.charCodeAt(start) <= 32) start++;
  while (end > start && trimmed.charCodeAt(end - 1) <= 32) end--;
  const url = trimmed.slice(start, end);
  if (!url) return;
  const sanitized = sanitizeMediaUrl(url);
  if (!sanitized) return;
  // URL parsers remove these characters before interpreting the scheme or host.
  const normalized = sanitized.replace(/[\t\n\r]/g, "");
  if (/^data:/i.test(normalized)) {
    return allowedDataUrl[kind].test(normalized) ? normalized : undefined;
  }
  if (!frozen && catalogHttpUrl(sanitized)) return sanitized;
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
  const src = mediaUrl(props.url, frozen, kind);
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
        poster={mediaUrl(props.posterUrl, frozen, "Image")}
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
