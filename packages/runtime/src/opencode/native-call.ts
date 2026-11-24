/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Single adapter boundary normalizing @opencode/plugin's unknown error channel to CrewError. */
import { Effect, Stream, type Scope } from "effect";
import type {
  EventSubscribeInput,
  EventSubscribeOutput,
  SelectedEvent,
} from "@opencode/client/effect/api";
import type { Context } from "@opencode/plugin/effect/plugin";
import type { RpcHandlers, RpcRegistration } from "@opencode/plugin/effect/rpc";
import type { Rpc } from "@opencode/schema/rpc";
import { CrewError } from "../domain.ts";

type EventType = NonNullable<EventSubscribeInput["types"]>[number];

type NormalizedDomain<T> = {
  readonly [K in keyof T]: T[K] extends (
    ...args: infer Args
  ) => Effect.Effect<infer A, unknown, infer R>
    ? (...args: Args) => Effect.Effect<A, CrewError, R>
    : T[K] extends (...args: infer Args) => Stream.Stream<infer A, unknown, infer R>
      ? (...args: Args) => Stream.Stream<A, CrewError, R>
      : T[K];
};

const wrapDomain = <T extends object>(domain: T): NormalizedDomain<T> =>
  new Proxy(domain, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (Effect.isEffect(result)) return result.pipe(Effect.mapError(CrewError.from));
        if (Stream.isStream(result)) return result.pipe(Stream.mapError(CrewError.from));
        return result;
      };
    },
  }) as NormalizedDomain<T>;

/** Typed adapter for @opencode/plugin session methods with CrewError error channel. */
export const nativeSession = (ctx: Context) => wrapDomain(ctx.session);

/** Typed adapter for @opencode/plugin worktree methods with CrewError error channel. */
export const nativeWorktree = (ctx: Context) => wrapDomain(ctx.worktree);

/** Typed adapter for @opencode/plugin event.subscribe preserving event-type narrowing. */
export const nativeEventSubscribe = <Type extends EventType = EventType>(
  ctx: Context,
  input?: { readonly types?: ReadonlyArray<Type> },
): Stream.Stream<SelectedEvent<EventSubscribeOutput, Type>, CrewError> =>
  ctx.event.subscribe(input).pipe(Stream.mapError(CrewError.from));

/** Typed adapter for @opencode/plugin rpc.register with normalized registration & event emit. */
export const nativeRpcRegister = <const D extends Rpc.Definition>(
  ctx: Context,
  definition: D,
  handlers: RpcHandlers<NoInfer<D>>,
): Effect.Effect<
  Omit<RpcRegistration<D>, "events"> & {
    readonly events: {
      readonly emit: (...args: Rpc.EventInput<D>) => Effect.Effect<void, CrewError>;
    };
  },
  CrewError,
  Scope.Scope
> =>
  ctx.rpc.register(definition, handlers).pipe(
    Effect.map((registration) => ({
      ...registration,
      events: {
        emit: (...args: Rpc.EventInput<D>) =>
          registration.events.emit(...args).pipe(Effect.mapError(CrewError.from)),
      },
    })),
    Effect.mapError(CrewError.from),
  );

/** Invoke a function returning an Effect<A, unknown, R> and normalize its error channel. */
export const nativeInvoke = <Args extends readonly unknown[], A, R>(
  fn: (...args: Args) => Effect.Effect<A, unknown, R>,
  ...args: Args
): Effect.Effect<A, CrewError, R> => fn(...args).pipe(Effect.mapError(CrewError.from));
