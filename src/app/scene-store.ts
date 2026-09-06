import { produce } from "immer";
import { cloneAndFreeze } from "../model/immutable";
import type { SceneModel, SceneSnapshot } from "../model/scene-model";

export interface SceneChange { history?: boolean; }
export type SceneListener = (model: SceneSnapshot, change: SceneChange) => void;

export class SceneStore {
  readonly #listeners = new Set<SceneListener>();
  #model: SceneSnapshot;

  constructor(initialModel: SceneModel) {
    this.#model = cloneAndFreeze(initialModel);
  }

  getSnapshot(): SceneSnapshot {
    return this.#model;
  }

  update(recipe: (draft: SceneModel) => void, change: SceneChange = {}): void {
    const nextModel = produce(this.#model as SceneModel, (draft) => { recipe(draft); });
    if (nextModel === this.#model) return;
    this.#model = nextModel;
    for (const listener of this.#listeners) listener(this.#model, change);
  }

  replace(model: SceneModel | SceneSnapshot, change: SceneChange = { history: false }): void {
    this.#model = cloneAndFreeze(model) as SceneSnapshot;
    for (const listener of this.#listeners) listener(this.#model, change);
  }

  subscribe(listener: SceneListener): () => void {
    this.#listeners.add(listener);
    listener(this.#model, { history: false });
    return () => this.#listeners.delete(listener);
  }
}
