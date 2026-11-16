import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Disposable native probe; resolves only the frozen runtime's declared SDKs. */
export async function installNativeProbe(root: string, home: string, seedReceipts = false) {
  if (seedReceipts) {
    const plugin = join(home, "packages/runtime/src/plugin/index.ts");
    const source = await readFile(plugin, "utf8");
    await writeFile(
      plugin,
      'import { registerReceiptHistoryProbe } from "../../tests/helpers/native-receipts.ts";\n' +
        source.replace(
          "return Effect.gen(function* () {",
          "return Effect.gen(function* () {\n      yield* registerReceiptHistoryProbe(ctx);",
        ),
    );
  }
  // Configured local plugin entries require a directory, not a TS filename.
  const harnessDir = join(root, "probe");
  await mkdir(harnessDir);
  await writeFile(
    join(harnessDir, "package.json"),
    JSON.stringify({ name: "abracode-test", type: "module", exports: "./index.ts" }),
  );
  await writeFile(
    join(harnessDir, "index.ts"),
    await readFile(resolve("packages/runtime/tests/e2e/harness.ts"), "utf8"),
  );
  await symlink(join(home, "packages/runtime/node_modules"), join(harnessDir, "node_modules"));
  return harnessDir;
}
