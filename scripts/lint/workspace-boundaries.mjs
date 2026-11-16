import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";

const configurations = new Map();
function configuration(root) {
  if (configurations.has(root)) return configurations.get(root);
  const locations = [root];
  for (const group of ["apps", "packages"]) {
    const directory = join(root, group);
    if (existsSync(directory))
      for (const name of readdirSync(directory)) locations.push(join(directory, name));
  }
  const owners = locations
    .filter((directory) => existsSync(join(directory, "package.json")))
    .map((directory) => ({
      directory,
      ...JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
    }))
    .sort((a, b) => b.directory.length - a.directory.length);
  const value = { owners, byName: new Map(owners.map((owner) => [owner.name, owner])) };
  configurations.set(root, value);
  return value;
}
function inside(file, directory) {
  const path = relative(directory, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

/** An Oxlint AST rule: applies equally to value, type, re-export and literal dynamic imports. */
export default {
  meta: { name: "abracode" },
  rules: {
    boundaries: {
      meta: {
        type: "problem",
        schema: [],
        messages: { boundary: "{{reason}}: {{specifier}}" },
      },
      create(context) {
        const root = context.cwd;
        const file = resolve(context.filename);
        const { owners, byName } = configuration(root);
        const owner = owners.find((candidate) => inside(file, candidate.directory));
        if (!owner) return {};
        const source = inside(file, join(owner.directory, "src"));
        const browser =
          source &&
          [
            "@abracode/web",
            "@abracode/report-export",
            "@abracode/contracts",
            "@abracode/presentation",
          ].includes(owner.name);
        const offline =
          source && ["@abracode/report-export", "@abracode/presentation"].includes(owner.name);
        const dependencies = {
          ...owner.dependencies,
          ...owner.peerDependencies,
          ...owner.optionalDependencies,
          ...(!source ? owner.devDependencies : {}),
        };
        function check(node) {
          const specifier = node?.value;
          if (typeof specifier !== "string") return;
          const fail = (reason) =>
            context.report({ node, messageId: "boundary", data: { reason, specifier } });
          if (specifier.startsWith(".") || isAbsolute(specifier) || specifier.startsWith("@/")) {
            const target = specifier.startsWith("@/")
              ? resolve(owner.directory, "src", specifier.slice(2))
              : resolve(dirname(file), specifier);
            const targetOwner = owners.find((candidate) => inside(target, candidate.directory));
            if (targetOwner !== owner)
              fail("Use a declared workspace public export instead of crossing source directories");
            return;
          }
          if (isBuiltin(specifier)) {
            if (browser)
              fail(
                "Browser and frozen presentation source cannot import host capabilities, including types",
              );
            return;
          }
          // A closed local build alias, declared in this app's tsconfig and export configuration.
          if (owner.name === "@abracode/report-export" && specifier === "@report/prepared-diagrams")
            return;
          const name = specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0];
          if (!Object.hasOwn(dependencies, name) && name !== owner.name) {
            fail("Import must be declared in the owning workspace's direct dependencies");
            return;
          }
          const shared = byName.get(name);
          if (shared) {
            if (name !== owner.name && dependencies[name] !== "workspace:*")
              fail("Local workspace dependencies must use workspace:*");
            const subpath = specifier === name ? "." : `.${specifier.slice(name.length)}`;
            if (!Object.hasOwn(shared.exports ?? {}, subpath))
              fail("Import must use an explicit public package export");
          }
          if (
            browser &&
            /^(?:@abracode\/runtime|@opencode\/(?:client|plugin|cli|util)|@effect\/platform-node|@copilotkit\/runtime)$/.test(
              name,
            )
          )
            fail("Browser source cannot import controller or native-registration capabilities");
          if (
            offline &&
            /^(?:@abracode\/web|@ag-ui\/client|@copilotkit\/|@tanstack\/react-router|@effect\/atom-react)/.test(
              name,
            )
          )
            fail("Frozen rendering cannot import live application capabilities");
        }
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          TSImportType: (node) => check(node.source),
          TSExternalModuleReference: (node) => check(node.expression),
          CallExpression: (node) => {
            if (node.callee.type === "Identifier" && node.callee.name === "require")
              check(node.arguments[0]);
          },
        };
      },
    },
  },
};
