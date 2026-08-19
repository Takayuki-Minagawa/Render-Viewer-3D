export type TransformMode = "translate" | "rotate" | "scale";

export interface EditorState {
  readonly selectedObjectId: string | null;
  readonly transformMode: TransformMode;
}

export type EditorListener = (state: EditorState) => void;

export class EditorStore {
  readonly #listeners = new Set<EditorListener>();
  #state: EditorState;

  constructor(initialState: EditorState) {
    this.#state = Object.freeze({ ...initialState });
  }

  getSnapshot(): EditorState {
    return this.#state;
  }

  setSelectedObjectId(selectedObjectId: string | null): void {
    this.#publish({ ...this.#state, selectedObjectId });
  }

  setTransformMode(transformMode: TransformMode): void {
    this.#publish({ ...this.#state, transformMode });
  }

  subscribe(listener: EditorListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #publish(nextState: EditorState): void {
    if (
      nextState.selectedObjectId === this.#state.selectedObjectId &&
      nextState.transformMode === this.#state.transformMode
    ) {
      return;
    }

    this.#state = Object.freeze(nextState);
    for (const listener of this.#listeners) listener(this.#state);
  }
}
