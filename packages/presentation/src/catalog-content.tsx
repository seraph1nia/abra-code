import { createComponentImplementation } from "@a2ui/react";
import { lazy, Suspense, type ComponentType } from "react";
import type { HighlightedCodeProps } from "./highlighted-code.tsx";
import { Schema } from "effect";
import { catalog, contentProps, type ContentName } from "@abracode/contracts/web/catalog";

const HighlightedCode = lazy<ComponentType<HighlightedCodeProps>>(() =>
  import("./highlighted-code.tsx").catch(() => ({
    // Older browsers and stricter embedding policies can disable WebAssembly.
    default: ({ code }) => code,
  })),
);

// Logs and terminal output retain all original characters, including ANSI escapes.
const plainLanguages = new Set(["ansi", "log", "plain", "plaintext", "text", "txt"]);

export function contentImplementation(name: ContentName) {
  const api = catalog.components.get(name)!;
  return createComponentImplementation(api, ({ props, buildChild }) => {
    switch (name) {
      case "Table": {
        const { caption, columns, rows } = Schema.decodeUnknownSync(contentProps.Table)(props);
        return (
          <section className="catalog-table-scroll" aria-label={caption} tabIndex={0}>
            <table>
              <caption>{caption}</caption>
              <thead>
                <tr>
                  {columns.map((label, i) => (
                    <th key={i} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((cells, i) => (
                  <tr key={i}>
                    {cells.map((value, j) => (
                      <td key={j}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      }
      case "Disclosure": {
        const { label, child } = Schema.decodeUnknownSync(contentProps.Disclosure)(props);
        return (
          <details className="catalog-disclosure">
            <summary>{label}</summary>
            {buildChild(child)}
          </details>
        );
      }
      case "KeyValueList": {
        const { entries } = Schema.decodeUnknownSync(contentProps.KeyValueList)(props);
        return (
          <dl className="catalog-facts">
            {entries.map(({ label, value }, i) => (
              <div key={i}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        );
      }
      case "CodeBlock": {
        const { code, language } = Schema.decodeUnknownSync(contentProps.CodeBlock)(props);
        const lang = language?.trim().toLowerCase();
        return (
          <figure className="catalog-code">
            {language && <figcaption>{language}</figcaption>}
            <pre tabIndex={0}>
              <code>
                {code && lang && !plainLanguages.has(lang) ? (
                  <Suspense fallback={code}>
                    <HighlightedCode code={code} language={lang} />
                  </Suspense>
                ) : (
                  code
                )}
              </code>
            </pre>
          </figure>
        );
      }
    }
  });
}
