import type { SceneModel } from "../model/scene-model";

export type SceneListener = (model: Readonly<SceneModel>) => void;

export class SceneStore {
  readonly #listeners = new Set<SceneListener>();
  #model: SceneModel;

  constructor(initialModel: SceneModel) {
    this.#model = initialModel;
  }

  getSnapshot(): Readonly<SceneModel> {
    return this.#model;
  }

  update(recipe: (draft: SceneModel) => void): void {
    const nextModel = structuredClone(this.#model);
    recipe(nextModel);
    this.#model = nextModel;
    for (const listener of this.#listeners) listener(this.#model);
  }

  subscribe(listener: SceneListener): () => void {
    this.#listeners.add(listener);
    listener(this.#model);
    return () => this.#listeners.delete(listener);
  }
}
