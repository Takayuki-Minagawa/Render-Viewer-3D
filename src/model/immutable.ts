import type { DeepReadonly } from "./scene-model";

export function cloneAndFreeze<T>(value: T): DeepReadonly<T> {
  return freezeDeep(structuredClone(value));
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
