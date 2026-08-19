import { cloneAndFreeze, freezeDeep } from "../model/immutable";
import type { SceneModel, SceneSnapshot } from "../model/scene-model";

export type SceneListener = (model: SceneSnapshot) => void;

export class SceneStore {
  readonly #listeners = new Set<SceneListener>();
  #model: SceneSnapshot;

  constructor(initialModel: SceneModel) {
    this.#model = cloneAndFreeze(initialModel);
  }

  getSnapshot(): SceneSnapshot {
    return this.#model;
  }

  update(recipe: (draft: SceneModel) => void): void {
    const nextModel = structuredClone(this.#model) as SceneModel;
    recipe(nextModel);
    this.#model = freezeDeep(nextModel);
    for (const listener of this.#listeners) listener(this.#model);
  }

  subscribe(listener: SceneListener): () => void {
    this.#listeners.add(listener);
    listener(this.#model);
    return () => this.#listeners.delete(listener);
  }
}
