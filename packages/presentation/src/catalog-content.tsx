import { catalogComponent } from "./catalog-component.tsx";
import { lazy, Suspense, useMemo, type ComponentType } from "react";
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

const decodeTable = Schema.decodeUnknownSync(contentProps.Table);
const decodeDisclosure = Schema.decodeUnknownSync(contentProps.Disclosure);
const decodeKeyValueList = Schema.decodeUnknownSync(contentProps.KeyValueList);
const decodeCodeBlock = Schema.decodeUnknownSync(contentProps.CodeBlock);

export function contentImplementation(name: ContentName) {
  const api = catalog.components.get(name)!;
  switch (name) {
    case "Table":
      return catalogComponent(api, ({ props }) => {
        const { caption, columns, rows } = useMemo(() => decodeTable(props), [props]);
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
      });
    case "Disclosure":
      return catalogComponent(api, ({ props, buildChild }) => {
        const { label, child } = useMemo(() => decodeDisclosure(props), [props]);
        return (
          <details className="catalog-disclosure">
            <summary>{label}</summary>
            {buildChild(child)}
          </details>
        );
      });
    case "KeyValueList":
      return catalogComponent(api, ({ props }) => {
        const { entries } = useMemo(() => decodeKeyValueList(props), [props]);
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
      });
    case "CodeBlock":
      return catalogComponent(api, ({ props }) => {
        const { code, language } = useMemo(() => decodeCodeBlock(props), [props]);
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
      });
  }
}
