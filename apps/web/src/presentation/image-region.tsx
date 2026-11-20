import { Input } from "@abracode/presentation/ui/input";
import { useRef, useState } from "react";
import { withinImage, type RegionSelection } from "@abracode/contracts/web/resources";
import type { EvidenceDataSchema } from "@abracode/contracts/web/worker-evidence";
import { AskAbra } from "./ask-abra.tsx";
import { RequestState } from "../request-state.tsx";
import { queries } from "../work-data.ts";

type Asset = typeof EvidenceDataSchema.Type;
function ImageOverlay({
  asset,
  region,
  onSelect,
}: {
  asset: Asset;
  region?: RegionSelection;
  onSelect?: (region: RegionSelection) => void;
}) {
  const anchor = useRef<{ x: number; y: number; pointer: number } | undefined>(undefined);
  const { receipt, data } = asset;
  if (receipt.kind !== "screenshot") return <output>Image unavailable.</output>;
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          receipt.width - 1,
          Math.floor(((event.clientX - rect.left) * receipt.width) / rect.width),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          receipt.height - 1,
          Math.floor(((event.clientY - rect.top) * receipt.height) / rect.height),
        ),
      ),
    };
  };
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = anchor.current;
    if (!start || start.pointer !== event.pointerId || !region || !onSelect) return;
    const end = point(event);
    onSelect({
      ...region,
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(start.x - end.x) + 1,
      height: Math.abs(start.y - end.y) + 1,
    });
  };
  return (
    <div
      className="image-region"
      style={onSelect ? { touchAction: "none", cursor: "crosshair" } : undefined}
      onPointerDown={(event) => {
        if (!onSelect || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        anchor.current = { ...point(event), pointer: event.pointerId };
        update(event);
      }}
      onPointerMove={update}
      onPointerUp={(event) => {
        update(event);
        anchor.current = undefined;
      }}
      onLostPointerCapture={() => {
        anchor.current = undefined;
      }}
    >
      <img
        draggable={false}
        src={"data:image/png;base64," + data}
        alt={receipt.description}
        width={receipt.width}
        height={receipt.height}
      />
      {region && withinImage(region, receipt.width, receipt.height) && (
        <span
          aria-label="Selected image region"
          style={{
            left: (100 * region.x) / receipt.width + "%",
            top: (100 * region.y) / receipt.height + "%",
            width: (100 * region.width) / receipt.width + "%",
            height: (100 * region.height) / receipt.height + "%",
          }}
        />
      )}
    </div>
  );
}
export function CapturedRegion({ region }: { region: RegionSelection }) {
  return (
    <RequestState query={queries.evidence(region)}>
      {(asset) => <ImageOverlay asset={asset} region={region} />}
    </RequestState>
  );
}
export function ImageRegion({ asset }: { asset: Asset }) {
  const { receipt } = asset;
  if (receipt.kind !== "screenshot") return <output>Image unavailable.</output>;
  return <RegionEditor asset={asset} receipt={receipt} />;
}
function RegionEditor({
  asset,
  receipt,
}: {
  asset: Asset;
  receipt: Extract<Asset["receipt"], { kind: "screenshot" }>;
}) {
  const { issue_id, request_id, hash, width, height } = receipt;
  const [region, setRegion] = useState<RegionSelection>({
    kind: "region",
    issue_id,
    request_id,
    hash,
    x: 0,
    y: 0,
    width,
    height,
  });
  const [selecting, setSelecting] = useState(false);
  return (
    <>
      <ImageOverlay
        asset={asset}
        region={selecting ? region : undefined}
        onSelect={selecting ? setRegion : undefined}
      />
      <details onToggle={(event) => setSelecting(event.currentTarget.open)}>
        <summary>Select a region</summary>
        <p>
          Coordinates in original pixels · {width} × {height}
        </p>
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key}>
            Region {key}{" "}
            <Input
              type="number"
              min={key === "x" || key === "y" ? 0 : 1}
              max={key === "x" || key === "width" ? width : height}
              value={Number.isNaN(region[key]) ? "" : region[key]}
              onChange={(e) => setRegion({ ...region, [key]: e.target.valueAsNumber })}
            />
          </label>
        ))}
        <AskAbra
          selection={region}
          excerpt={receipt.description}
          disabled={!withinImage(region, width, height)}
        />
      </details>
    </>
  );
}
