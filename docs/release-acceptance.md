# AbraCode source-release acceptance

Validated on 2026-10-17 for `prepare-abracode-open-source-release`. This records local working-tree acceptance for the Linux source-clone distribution. It does not publish a package, binary or release.

## Dependency refresh acceptance — 2026-11-15

The dependency refresh uses OpenCode 2.3.0, OpenSpec 2.0.0, Node 26.13.0 and
pnpm 12.21.0. `pnpm check`, `pnpm test` (487 tests in 75 files),
`pnpm test:e2e` (3 tests in 2 files), `pnpm build`, `pnpm config:schema`,
`pnpm licenses:check`, `pnpm format:check`, peer checks and diff checks passed.
The direct workspace dependency audit reports no outdated versions. Commands
ran with the mise toolchain. The earlier release evidence below remains dated
and version-specific.

Full native evidence is retained outside the removed fixtures at
`/tmp/abra-dependency-update-20261115-verified`; its native JSON records a pass,
completed cleanup and 24 observations. The upgrade preserves controller-owned
approvals and delivery behavior in the disposable suite. It adds no optional
OpenCode integration. Historical native-database migration, paired graphical
click-through, live-provider/forge behavior and remote CI remain unverified.
See the [adoption report](opencode-update-2026-11-15.md) and
[updated API evidence](supported-apis.md#dependency-update-on-2026-11-15).

## OpenSpec 2 instruction migration acceptance — 2026-11-15

The six shared workflows now match the OpenSpec 2.0.0 CLI output. Twelve retired
OpenCode command/skill copies are removed; project-owned controller skills and
role profiles are preserved. Real CLI coverage forces regeneration of all six
stale workflows, checks their expected content and custom-file preservation,
then requires a second refresh to be byte-for-byte idempotent.

`pnpm check`, `pnpm test` (492 tests in 76 files), `pnpm test:e2e` (3 tests in
2 files), build, schema and license checks passed. After strengthening the
regeneration assertion, all 7 migration-specific tests passed again. The final
CLI dry run reports no changes. License evidence covers 761 locked components
and 12 distributed source files after removal of the duplicates.

Final native evidence is retained at `/tmp/abra-openspec2-final-verified`.
Both the main and reply-recovery JSON record a pass and completed cleanup;
the fixture directories are removed. Full E2E completed in 371.15 seconds.
The deterministic lead responder now selects current lead requests, parses the
exact decision key and leaves its lead-routing question to the lead; the native
assertion verifies the lead's exact answer. Production decision logic is unchanged.
The checkout also contained concurrent web-client work, exercised by this full
suite. These are local working-tree results; the earlier verification limits
remain. See [instruction ownership](openspec.md).

## Environment and checks

Linux x86-64/glibc; Node 24.21.0; pnpm 11.28.5; Git 2.56.0; util-linux/flock 2.42.4; pinned OpenCode 2.0.28 and OpenSpec 1.13.2. The test pool uses one worker to bound native-process and installation memory. Full source installs use disk-backed temporary roots and copied supplier packages.

| Check                                                                       | Result                                                                                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GOMAXPROCS=4 pnpm check`                                                   | Passed formatting, lint, TypeScript, strict Effect diagnostics and reporter type checks; no warnings                  |
| `pnpm test`                                                                 | 53 files, 320 unit/integration tests passed                                                                           |
| `pnpm test:e2e`                                                             | Both source-install/native workflow tests passed                                                                      |
| `pnpm build`                                                                | AbraCode plugin/TUI ESM builds passed; dependencies remain external                                                   |
| `pnpm config:schema`                                                        | Effect-derived schema matches the tracked schema                                                                      |
| `pnpm licenses:check`                                                       | Two negative/mixed-license fixtures passed; 759 locked components and 19 adapted source files match retained evidence |
| `pnpm exec openspec validate prepare-abracode-open-source-release --strict` | Passed                                                                                                                |
| `git diff --check`                                                          | Passed                                                                                                                |

The installation fixture runs a frozen offline pnpm install from the supplier cache populated by the initial install. It validates alternate personal configuration without creating runtime state; boots/reuses the service and Abra; exercises the native auth command route; launches and relaunches the normal entry point in a disposable util-linux terminal; observes AbraCode branding; explicitly applies configuration; and preserves legacy files. Selecting a different YAML refuses the running service without rewriting generated host settings. Canonical path tests also reject symlinked legacy runtime paths before discovery or generation.

The native workflow fixture runs the installed application against a deterministic loopback provider and temporary local bare remotes. It verifies owned worker prompts, direct foreground/queued prompt refusal before provider calls, worker management refusal, Abra-only questions/forms, configuration reconciliation, repository omission/restoration, retained approval identity, captured models across restart, changed selections for new work, correction/Review/delivery gates and retained history. The fake forge refuses writes outside its recorded disposable local bare repository. No test pushes to a user remote or requires personal provider/GitHub credentials.

Native terminal tests verify read-only worker inspection, no discovery-created worker tabs, preserved focus/status/pending synchronization, narrow layout, keyboard/dialog behavior, branding slots and disposal. Reporter integration builds and moves the actual standalone HTML, verifies embedded notices and offline interactions, and checks that diagram authoring engines are excluded from the runtime artifact.

## License and artifact disposition

Project-owned material is MIT licensed. Root/plugin/reporter metadata agree with the root license. [Third-party notices](../THIRD_PARTY_NOTICES.md), [inventory](../licenses/inventory.json), 288 retained license texts and the upstream [OpenSpec notice](../licenses/openspec.txt) preserve separate supplier rights and provenance. The inventory records actual installed evidence where available and distinguishes optional platform metadata from installed components; missing supplier notices with declared SPDX grants are explicitly identified rather than inventing copyright text.

Application runtime, contributor build, report authoring and report artifact reachability are recorded independently of supplier executable installation. MPL/EPL diagram/build engines and Creative Commons data have explicit reviewed dispositions; they are not relabeled MIT. The report build embeds project and conservative runtime-dependency notices for Solid, Seroval, Seroval plugins and csstype. Mermaid, ELK and Lightning CSS authoring engines are excluded from the standalone runtime bundle.

The shipped source excludes installed dependencies, downloaded executables, personal settings and runtime state. Operators install native tools from their suppliers. Bundling or redistributing those binaries, modified upstream components or additional report assets needs a review of that actual distribution. This evidence supports the recorded source distribution and does not grant rights to external providers, trademarks or managed repositories.

## Verification limits

Browser workflows were exercised against disposable local pages with an explicitly provisioned Chrome installation; diagnostics do not install a browser. Real paid-provider authentication and live GitHub delivery permissions remain operator prerequisites, with deterministic local substitutes used for acceptance. The optional external no-mistakes integration uses recording fixtures; a user's live external daemon/account was not exercised. Graphical OpenCode client branding and actual paired graphical report click-through were not verified; terminal integration and portable HTML behavior are the supported evidence here.

The Linux CI workflow includes schema/license checks, project checks, frozen-install acceptance and build, with read-only GitHub permissions. Remote CI has not run for these uncommitted changes. macOS/Windows, npm publication, standalone binary redistribution and OpenCrew migration are outside this release contract. Legacy data and services are not imported or automatically removed.
