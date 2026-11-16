/* oxlint-disable effecttsgo/unstable-api-usage -- Pinned Effect 4.0.1 process services. */
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, Option, FileSystem } from "effect";
import { ChildProcessSpawner } from "effect/process";

const base = Layer.merge(NodeFileSystem.layer, NodePath.layer);
export const platformLayer = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(base));
/** Application callbacks inherit captured services; standalone adapters retain a live default. */
export const provideProcess = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
) =>
  Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner).pipe(
    Effect.flatMap((service) =>
      Option.isSome(service)
        ? effect.pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, service.value))
        : effect.pipe(Effect.provide(platformLayer)),
    ),
  );

export const provideFileSystem = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.serviceOption(FileSystem.FileSystem).pipe(
    Effect.flatMap((service) =>
      Option.isSome(service)
        ? effect.pipe(Effect.provideService(FileSystem.FileSystem, service.value))
        : effect.pipe(Effect.provide(NodeFileSystem.layer)),
    ),
  );
