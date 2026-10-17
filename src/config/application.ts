import { Effect } from "effect";
import { type Config } from "../domain.ts";
import { type Records } from "../storage/store.ts";
import { type Onboarding } from "./onboard.ts";
import { loadConfig } from "./load.ts";
import {
  declarationDigest,
  declarationOutcome,
  saveDeclarationOutcome,
  type DeclarationOutcome,
} from "./declarations.ts";

/** YAML is intent; native registrations and per-declaration outcomes remain observed evidence. */
export class ConfigApplication {
  constructor(
    private config: Config,
    private records: Records,
    private onboarding: Onboarding,
  ) {}
  status = () =>
    Effect.gen({ self: this }, function* () {
      const fresh = yield* loadConfig(this.config.home);
      const registered = yield* this.records.projects();
      const outcomes: DeclarationOutcome[] = [];
      for (const declaration of fresh.repositories) {
        const saved = yield* declarationOutcome(this.records, declaration.id);
        const digest = declarationDigest(declaration);
        const project = registered.find((p) => p.id === declaration.id);
        outcomes.push(
          saved?.digest === digest && saved.status === "apply-failed"
            ? saved
            : project?.declaration_digest === digest
              ? {
                  id: declaration.id,
                  digest,
                  status:
                    project.openspec && project.verification.length
                      ? "registered/ready"
                      : "registered/setup-blocked",
                }
              : saved?.digest === digest
                ? saved
                : { id: declaration.id, digest, status: "declared/pending" },
        );
      }
      for (const project of registered.filter(
        (p) => !fresh.repositories.some((d) => d.id === p.id),
      ))
        outcomes.push({
          id: project.id,
          digest: project.declaration_digest ?? "",
          status: "retained/undeclared",
        });
      return outcomes;
    });
  apply = () =>
    Effect.gen({ self: this }, function* () {
      const fresh = yield* loadConfig(this.config.home);
      // Process-wide model/host settings require restart; repository application is explicit.
      this.config.repositories = fresh.repositories;
      this.config.config_digest = fresh.config_digest;
      for (const declaration of fresh.repositories) {
        yield* this.onboarding.register(declaration, false).pipe(
          Effect.catch((error) =>
            saveDeclarationOutcome(this.records, {
              id: declaration.id,
              digest: declarationDigest(declaration),
              status: "apply-failed",
              error: error.message.slice(0, 1024),
            }),
          ),
        );
      }
      return yield* this.status();
    });
}
