import { createComponentImplementation } from "@a2ui/react";

/** Carry A2UI's common layout and accessibility properties onto the host element. */
export function catalogComponent(
  ...[api, Render]: Parameters<typeof createComponentImplementation>
) {
  return createComponentImplementation(api, function CatalogComponent(input) {
    const { accessibility, weight } = input.props;
    const content = <Render {...input} />;
    if (accessibility === undefined && weight === undefined) return content;
    return (
      <div
        aria-label={accessibility?.label}
        aria-description={accessibility?.description}
        aria-hidden={accessibility?.hidden}
        aria-live={accessibility?.live}
        style={typeof weight === "number" ? { flexGrow: weight } : undefined}
      >
        {content}
      </div>
    );
  });
}
