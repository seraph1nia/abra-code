import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { Search, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "./button.tsx";

export type SearchCommand = {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
};

export function SearchDialog({
  origin,
  close,
  value,
  onValueChange,
  commands,
  status,
}: {
  origin: HTMLElement;
  close: () => void;
  value: string;
  onValueChange: (value: string) => void;
  commands: SearchCommand[];
  status?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const chosen = useRef(false);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Popup
          initialFocus={input}
          finalFocus={() => (chosen.current ? false : origin)}
          className="fixed inset-x-3 top-[12dvh] z-50 mx-auto flex max-h-[70dvh] max-w-lg flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
          onKeyDownCapture={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <Dialog.Title className="sr-only">Search workspace</Dialog.Title>
          <Autocomplete.Root
            inline
            open
            autoHighlight="always"
            items={commands}
            filter={null}
            value={value}
            onValueChange={onValueChange}
            itemToStringValue={(item) => item.label}
          >
            <div className="flex items-center gap-3 border-b px-3 py-2">
              <Search aria-hidden="true" className="size-4 text-muted-foreground" />
              <Autocomplete.Input
                ref={input}
                aria-label="Search work and commands"
                className="min-w-0 flex-1 bg-transparent py-2 outline-none"
                maxLength={256}
                placeholder="Search work and commands…"
              />
              <Dialog.Close
                render={<Button variant="ghost" size="icon-sm" aria-label="Close search" />}
              >
                <X aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Autocomplete.List aria-label="Search results" className="min-h-0 overflow-y-auto p-1">
              {(item: SearchCommand) => (
                <Autocomplete.Item
                  key={item.id}
                  value={item}
                  className="flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  onClick={() => {
                    chosen.current = true;
                    close();
                    item.run();
                  }}
                >
                  <span>{item.label}</span>
                  {item.detail && <small className="text-muted-foreground">{item.detail}</small>}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Root>
          {status && (
            <output className="border-t px-4 py-2 text-sm text-muted-foreground">{status}</output>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
