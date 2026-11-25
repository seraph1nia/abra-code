import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { ChildProcessSpawner } from "effect/process";

export const platformLayer: Layer.Layer<
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Layer.suspend(() => NodeServices.layer);

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
        : effect.pipe(Effect.provide(platformLayer)),
    ),
  );
