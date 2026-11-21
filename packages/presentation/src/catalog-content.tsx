import { createComponentImplementation } from "@a2ui/react";
import { Schema } from "effect";
import { catalog, contentProps, type ContentName } from "@abracode/contracts/web/catalog";

export function contentImplementation(name: ContentName) {
  const api = catalog.components.get(name)!;
  return createComponentImplementation(api, ({ props, buildChild }) => {
    switch (name) {
      case "Table": {
        const { caption, columns, rows } = Schema.decodeUnknownSync(contentProps.Table)(props);
        return <div className="catalog-table-scroll" role="region" aria-label={caption} tabIndex={0}>
          <table><caption>{caption}</caption><thead><tr>
            {columns.map((label, i) => <th key={i} scope="col">{label}</th>)}
          </tr></thead><tbody>
            {rows.map((cells, i) => <tr key={i}>{cells.map((value, j) => <td key={j}>{value}</td>)}</tr>)}
          </tbody></table>
        </div>;
      }
      case "Disclosure": {
        const { label, child } = Schema.decodeUnknownSync(contentProps.Disclosure)(props);
        return <details className="catalog-disclosure"><summary>{label}</summary>{buildChild(child)}</details>;
      }
      case "KeyValueList": {
        const { entries } = Schema.decodeUnknownSync(contentProps.KeyValueList)(props);
        return <dl className="catalog-facts">{entries.map(({ label, value }, i) =>
          <div key={i}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
      }
      case "CodeBlock": {
        const { code, language } = Schema.decodeUnknownSync(contentProps.CodeBlock)(props);
        return <figure className="catalog-code">{language && <figcaption>{language}</figcaption>}
          <pre tabIndex={0}><code>{code}</code></pre></figure>;
      }
    }
  });
}
