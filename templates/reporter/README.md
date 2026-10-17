# Report template

Edit **`src/report.tsx`** to write a report. It is ordinary Solid + TypeScript: replace the example content, compose semantic HTML and add local interactions as needed. `src/styles.css` supplies plain responsive CSS. There is no report schema, UI kit or `@opencode/ui` dependency.

From the repository root, after the normal `pnpm install --frozen-lockfile --prod=false`:

```sh
pnpm report:browser:install        # one-time Chromium setup for diagram tooling
pnpm report:dev                    # authoring + HMR, foreground
pnpm report:check                  # browser TS/TSX types
pnpm report:validate               # parse + render every src/**/*.mmd file
pnpm report:validate path/to.mmd   # validate files relative to your current directory
pnpm report:build                  # type check + prepared SVGs + portable build
pnpm report:preview                # serve the completed build, foreground
pnpm report:preview --port 4180    # explicit alternate port (also works for dev)
```

Dev defaults to `127.0.0.1:5173`; preview defaults to `127.0.0.1:4173`. Both fail if the requested port is occupied. Preview requires a build. Use the actual URL printed after successful startup; Ctrl+C stops the process. Neither building nor opening the file starts a server.

## Mermaid diagrams

Keep diagram sources in `.mmd` files under `src/`. Import them directly and pass the prepared diagram to the reusable Solid component:

```tsx
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import lifecycle from "./diagrams/report-state.mmd";

<MermaidDiagram
  title="The report lifecycle"
  caption="Validate before sharing; return to the draft when revising."
  diagram={lifecycle}
/>;
```

The example includes flowchart, sequence and state diagrams. A Vite plugin compiles each `.mmd` import to `{ svg, source }` during the build. The component displays the prepared SVG with an accessible title, optional caption, keyboard-focusable scrolling and source disclosure. **Mermaid is a development dependency and is not included in the report HTML.** The example is approximately **95 KB uncompressed** (22 KB gzip).

During `pnpm report:dev`, the same plugin renders diagrams on the authoring machine. Editing a `.mmd` file recompiles it through Vite's normal hot updates. Invalid diagrams show filename/line diagnostics in the development overlay or fail the build. The finished report only displays the prepared SVGs; editing Mermaid text requires rebuilding. Import `.mmd` directly: `?raw` returns uncompiled text, and inline TSX strings are not compiled diagrams. To switch views locally in the finished report, import multiple prepared diagrams and choose between them with Solid signals.

`pnpm report:validate` checks **all `.mmd` files under `src/`**, including files the report does not import. The build plugin checks the same sources and reuses the prepared results for imported files, without running a separate validation command. Both use the same pinned Mermaid engine, report colors, system fonts and `securityLevel: "strict"`, calling `parse` and `render` in headless Chromium. Failures identify the file and include Mermaid's diagnostic; the validator continues checking files and exits unsuccessfully if any diagram fails. With explicit paths, it checks only those files, resolved from the current directory (from the root when using the root command). A template with no `.mmd` files has nothing to validate and succeeds.

Install Chromium once with `pnpm report:browser:install` for authoring, builds, validation and report tests. Linux CI may additionally need Playwright's OS dependencies (`pnpm --filter @abracode/report-template exec playwright install --with-deps chromium`). Alternatively set `REPORT_CHROMIUM_PATH` to a compatible existing Chromium executable. Diagram tooling owns a temporary loopback engine server and browser; the build/validator closes them on success or failure, and development closes them with the dev server. No generated source files are written to the repository. The finished HTML needs neither Mermaid, Chromium installation nor a server. Validation does not prove that labels are readable or the diagram tells the right story; inspect the result at desktop and narrow widths.

Diagram types requiring external icons, images or other remote resources are outside the offline recipe. Repeat the offline checks when using new features.

## Choosing a visual explanation

Inspired by [HumanLayer's show-me skill](https://github.com/humanlayer/skills/blob/main/plugins/show-me/skills/show-me/SKILL.md), choose the smallest view that answers the reader's question:

- **Flowchart:** branches, dependencies or a short path through a process.
- **Sequence diagram:** who calls whom, exchange order and response paths.
- **State diagram:** lifecycle transitions, retries and terminal states.
- **Call or component tree:** a `<pre><code>` sketch showing ownership and nesting.
- **File tree:** a shallow sketch with one responsibility per entry.
- **Pseudocode or signatures:** the algorithm or interface being discussed.
- **Diff:** the changed shape with enough surrounding context to understand it.
- **Inline SVG or ordinary TSX:** a custom comparison or visual explanation.

Put the explanation beside the visual it supports. Use actual names and include only the relevant calls, states and boundaries. Give every diagram a title explaining its point; split dense diagrams instead of shrinking text. The shipped diagrams describe this presentation workflow, not controller authorization. Existing semantic HTML, `<details>`, tables and local Solid signals remain available without adopting a report schema.

## Hand off in chat

1. Edit `templates/reporter/src/report.tsx` (and CSS if needed).
2. Run `pnpm report:build`.
3. Return a Markdown link using the **actual absolute path**, for example:

   ```markdown
   [Open report](/absolute/installation/templates/reporter/dist/index.html)
   ```

4. For an HTTP page link, explicitly run `pnpm report:preview`, wait for successful startup and return the URL it prints alongside the file link.

OpenCode 2.0.28's graphical client resolves file links into its existing HTML preview beside the conversation, or its native desktop browser pane. HTML is not embedded inside the message. Other clients can open the same file in a browser; no TUI HTML rendering is promised. See [native verification and limitations](../../docs/supported-apis.md#report-html-preview).

The HTTP URL works only while the foreground preview process runs, and only on the serving machine. A remote browser's `127.0.0.1` refers to that browser's machine. Use the native file preview when connected remotely; this template does not provide hosting or a durable public URL. The built file remains usable after preview stops.

## Portable output and assets

The build produces **`dist/index.html`**, with Solid, application JS and CSS inlined. Copy or rename that file to retain a report before replacing the example. No sibling application bundles or network access are needed by the example. Evidence hyperlinks are navigation destinations, not rendering dependencies.

- Write inline SVG in TSX for diagrams, or import raster assets as URLs through Vite (`import figure from "./figure.png"`, then `<img src={figure} alt="…" />`). Imported raster files are bundled as data URLs by the single-file plugin.
- Imported CSS is inlined; use system fonts or bundled supported assets. Keep report data in TS/TSX.
- `public/` copying is disabled. Raw absolute/relative asset paths, remote fonts/CDNs, runtime `fetch`, workers, remote scripts, dynamic chunks and externally referenced SVG files are outside this template's portable recipe. SVG can be written inline or explicitly imported with `?raw` and handled appropriately; do not assume every Vite asset type is inlined.
- The native HTML preview allows scripts but withholds same-origin privileges. Avoid cookies, local storage, service workers and host session dependencies. Local controls should update presentation only.
- After adding assets or libraries, repeat the moved-file/offline and sandbox checks in [testing](../../docs/testing.md#report-template). Build success alone does not prove that new dependencies work offline. Vite preview is a local development server, not production hosting.

## Permissions

Use this template only where you already have permission to edit files and run builds. It grants no additional shell or authoring permission to Supervisor or read-only research sessions. Retained research reports still use AbraCode's immutable Markdown submission/receipt path. This page does not submit agent prompts, approve work, change issue status or publish research evidence.

Project and bundled report-runtime license notices are embedded in `dist/index.html` under `abracode-license-notices`. Preserve them in exported reports. Added dependencies or assets need their own license review and attribution; the project's MIT license does not replace their terms.
