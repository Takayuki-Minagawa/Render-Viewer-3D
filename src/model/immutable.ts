import { current, isDraft, type Draft } from "immer";
import type { DeepReadonly } from "./scene-model";

/** Clone the latest model value, including edits made in an active Immer recipe. */
export function cloneModelValue<T>(value: T): T {
  return structuredClone(isDraft(value) ? current<T>(value as Draft<T>) : value);
}

export function cloneAndFreeze<T>(value: T): DeepReadonly<T> {
  return freezeDeep(cloneModelValue(value));
}

export function freezeDeep<T>(value: T): DeepReadonly<T> {
  freezeValue(value, new WeakSet());
  return value as DeepReadonly<T>;
}

function freezeValue(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || visited.has(value)) return;

  visited.add(value);
  for (const child of Object.values(value)) freezeValue(child, visited);
  Object.freeze(value);
}
