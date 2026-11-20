import { useMemo, useState, type ComponentProps } from "react";
import { deferred } from "./deferred.tsx";
type Props = ComponentProps<typeof import("./presentation/recap.tsx").Recap>;
const History = deferred<Props>(
  () => import("./presentation/recap.tsx").then((m) => ({ default: m.Recap })),
  "Reading history",
);

/** A new session has no reading position until a developer inspects something. */
export function Recap(props: Props) {
  const [opened, setOpened] = useState(false);
  const covered = useMemo(() => {
    if (props.selected) return true;
    try {
      return !!localStorage.getItem("abra-recap-v1-" + props.session);
    } catch {
      return false;
    }
  }, [props.selected, props.session]);
  if (opened || covered) return <History {...props} initiallyOpen={opened} />;
  return (
    <details
      className="work-recap"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true);
      }}
    >
      <summary>Since your last inspection</summary>
    </details>
  );
}
