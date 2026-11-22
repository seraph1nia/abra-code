import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { Search, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Button } from "./button.tsx";

export type SearchCommand = {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
  keepOpen?: boolean;
};

export function SearchDialog({
  origin,
  close,
  value,
  onValueChange,
  commands,
  filters,
  controls,
  reader,
  filter,
  onFilter,
  status,
}: {
  origin: HTMLElement;
  close: () => void;
  value: string;
  onValueChange: (value: string) => void;
  commands: SearchCommand[];
  filters?: readonly string[];
  controls?: ReactNode;
  reader?: ReactNode;
  filter?: string;
  onFilter?: (source: string) => void;
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
          data-workspace-search
          initialFocus={input}
          finalFocus={() => (chosen.current ? false : origin)}
          className="fixed inset-x-3 top-[12dvh] z-50 mx-auto flex max-h-[70dvh] max-w-lg flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl"
          onKeyDownCapture={(event) => {
            if (event.nativeEvent.isComposing && ["Escape", "Enter"].includes(event.key)) {
              event.stopPropagation();
              return;
            }
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <Dialog.Title className="sr-only">Search workspace</Dialog.Title>
          {filters && (
            <label className="px-3 pt-2 text-sm">
              Search in{" "}
              <select
                aria-label="Search in"
                value={filter ?? ""}
                onChange={(event) => {
                  onFilter?.(event.target.value);
                  input.current?.focus();
                }}
              >
                <option value="">All</option>
                {filters.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
          )}
          {controls}
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
            {reader ?? (
              <Autocomplete.List
                aria-label="Search results"
                className="min-h-0 overflow-y-auto p-1"
              >
                {(item: SearchCommand) => (
                  <Autocomplete.Item
                    key={item.id}
                    value={item}
                    className="flex cursor-pointer flex-col gap-0.5 rounded-md px-3 py-2 text-sm data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                    onClick={() => {
                      if (!item.keepOpen) {
                        chosen.current = true;
                        close();
                      }
                      item.run();
                    }}
                  >
                    <span>{item.label}</span>
                    {item.detail && <small className="text-muted-foreground">{item.detail}</small>}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            )}
          </Autocomplete.Root>
          {status && (
            <output className="border-t px-4 py-2 text-sm text-muted-foreground">{status}</output>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The caller's multiline editor owns focus and moves the active option with its arrow keys. */
export function ComposerSuggestions({
  items,
  highlight,
  choose,
}: {
  items: readonly { id: string; effect: string }[];
  highlight: number;
  choose: (id: string) => void;
}) {
  return (
    <Autocomplete.Root
      inline
      open
      items={items}
      filter={null}
      itemToStringValue={(item) => item.id}
    >
      <Autocomplete.List id="chat-commands" className="slash-commands" aria-label="Chat commands">
        {(item: { id: string; effect: string }, index: number) => (
          <Autocomplete.Item
            key={item.id}
            render={(props) => <div {...props} id={"slash-" + item.id} />}
            value={item}
            data-active={index === highlight || undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item.id)}
          >
            /{item.id} · {item.effect}
          </Autocomplete.Item>
        )}
      </Autocomplete.List>
    </Autocomplete.Root>
  );
}
