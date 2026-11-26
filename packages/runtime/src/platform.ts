import {
  NodeChildProcessSpawner,
  NodeFileSystem,
  NodePath,
  NodeServices,
} from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, ManagedRuntime, Option } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

export const platformLayer = Layer.merge(NodeServices.layer, FetchHttpClient.layer);

// Programmatic adapters also work outside the CLI or plugin. Their stateless Node
// drivers share a single lazy runtime; files and child processes belong to the caller's scope.
const standaloneLayer = Layer.merge(
  NodeChildProcessSpawner.layer.pipe(
    Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
  ),
  FetchHttpClient.layer,
);
type Drivers = Layer.Success<typeof standaloneLayer>;
let standalone: ManagedRuntime.ManagedRuntime<Drivers, never> | undefined;
function standaloneContext() {
  if (!standalone) {
    const runtime = ManagedRuntime.make(standaloneLayer);
    standalone = runtime;
    process.once("beforeExit", () => {
      standalone = undefined;
      void runtime.dispose();
    });
  }
  return standalone.contextEffect;
}
function driver<I extends Drivers, S>(key: Context.Key<I, S>) {
  return Effect.flatMap(Effect.serviceOption(key), (service) =>
    Option.isSome(service)
      ? Effect.succeed(service.value)
      : Effect.map(standaloneContext(), Context.get(key)),
  );
}

export const fileSystemDriver = driver(FileSystem.FileSystem);
export const processDriver = driver(ChildProcessSpawner.ChildProcessSpawner);
export const httpDriver = driver(HttpClient.HttpClient);

export const provideFileSystem = Effect.provideServiceEffect(
  FileSystem.FileSystem,
  fileSystemDriver,
);
export const provideProcess = Effect.provideServiceEffect(
  ChildProcessSpawner.ChildProcessSpawner,
  processDriver,
);
