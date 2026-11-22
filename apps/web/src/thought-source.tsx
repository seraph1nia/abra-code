import type { ComponentProps } from "react";
import { deferred } from "./deferred.tsx";

export const ThoughtSource = deferred<
  ComponentProps<typeof import("./thought-source-card.tsx").ThoughtSource>
>(
  () => import("./thought-source-card.tsx").then((module) => ({ default: module.ThoughtSource })),
  "Notebook source",
);
