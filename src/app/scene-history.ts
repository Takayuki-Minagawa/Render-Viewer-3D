import type { SceneSnapshot } from "../model/scene-model";
import type { ImportedAssetStore } from "../three/imported-asset-store";
import type { MaterialImageAssetStore } from "../three/material/image-asset-store";
import { imageAssetIds, type ProjectAssets } from "./project-assets";
import type { SceneStore } from "./scene-store";

export const HISTORY_LIMIT = 50;
export const HISTORY_BYTE_LIMIT = 256 * 1024 * 1024;

/** Scene snapshots share immutable subtrees; history pins only referenced assets. */
export class SceneHistory {
  #undos: SceneSnapshot[] = [];
  #redos: SceneSnapshot[] = [];
  #previous: SceneSnapshot;
  #transaction: SceneSnapshot | undefined;
  #applying = false;
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<() => void>();

  constructor(readonly store: SceneStore, readonly assets: ImportedAssetStore,
    readonly images: MaterialImageAssetStore, readonly sources: ProjectAssets,
    readonly byteLimit = HISTORY_BYTE_LIMIT) {
    if (!Number.isFinite(byteLimit) || byteLimit <= 0) throw new RangeError("History byte limit must be positive.");
    this.#previous = store.getSnapshot();
    this.#unsubscribe = store.subscribe((model, change) => {
      if (!this.#applying && change.history !== false && model !== this.#previous) {
        if (!this.#transaction) { this.#undos.push(this.#previous); this.#redos = []; }
      }
      this.#previous = model;
      this.#retain();
      this.#emit();
    });
  }

  get canUndo(): boolean { return this.#undos.length > 0 || !!this.#transaction; }
  get canRedo(): boolean { return this.#redos.length > 0; }
  get editing(): boolean { return !!this.#transaction; }
  begin(): void { this.#transaction ??= this.store.getSnapshot(); }
  end(): void {
    if (!this.#transaction) return;
    if (this.#transaction !== this.store.getSnapshot()) { this.#undos.push(this.#transaction); this.#redos = []; }
    this.#transaction = undefined;
    this.#retain(); this.#emit();
  }
  cancel(): void {
    const model = this.#transaction;
    if (!model) return;
    this.#transaction = undefined;
    this.#apply(model);
  }
  undo(): void {
    this.end();
    const model = this.#undos.pop();
    if (!model) return;
    this.#redos.push(this.store.getSnapshot());
    this.#apply(model);
  }
  redo(): void {
    this.end();
    const model = this.#redos.pop();
    if (!model) return;
    this.#undos.push(this.store.getSnapshot());
    this.#apply(model);
  }
  clear(): void {
    this.#undos = []; this.#redos = []; this.#transaction = undefined;
    this.#retain(); this.#emit();
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener); listener();
    return () => this.#listeners.delete(listener);
  }
  dispose(): void { this.#unsubscribe(); this.clear(); this.#listeners.clear(); }

  #apply(model: SceneSnapshot): void {
    this.#applying = true;
    try {
      // Navigation is not an edit: undoing geometry must not unexpectedly move the camera.
      this.store.replace({ ...model, camera: this.store.getSnapshot().camera } as SceneSnapshot);
    } finally { this.#applying = false; }
  }
  #emit(): void { for (const listener of this.#listeners) listener(); }
  #retain(): void {
    while (this.#undos.length > HISTORY_LIMIT) this.#undos.shift();
    const collect = () => {
      const current = this.store.getSnapshot();
      const historical = [...this.#undos, ...this.#redos];
      if (this.#transaction) historical.push(this.#transaction);
      const models = [...historical, current];
      const currentImports = new Set(current.imports.map(({ assetId }) => assetId));
      const currentImages = imageAssetIds(current);
      const currentEnvironments = new Set(current.environment ? [current.environment.assetId] : []);
      const imports = new Set(models.flatMap((m) => m.imports.map((a) => a.assetId)));
      const images = new Set(models.flatMap((m) => [...imageAssetIds(m)]));
      const environments = new Set(models.flatMap(m => m.environment ? [m.environment.assetId] : []));
      // The active scene is needed regardless of Undo. Charge only resources kept
      // additionally by history; otherwise a large active model disables even Rename Undo.
      const bytes = [...imports].filter(id => !currentImports.has(id)).reduce((n, id) => n + this.assets.estimatedBytes(id) +
        (this.sources.imports.get(id)?.files.reduce((s, f) => s + f.size, 0) ?? 0), 0) +
        [...images].filter(id => !currentImages.has(id)).reduce((n, id) => n + this.images.estimatedBytes(id), 0) +
        [...environments].filter(id => !currentEnvironments.has(id)).reduce((n, id) => n + (this.sources.environments.get(id)?.size ?? 0), 0) +
        estimateHistorySnapshotBytes(current, historical);
      return { imports, images, environments, bytes };
    };
    let refs = collect();
    while (refs.bytes > this.byteLimit && (this.#undos.length || this.#redos.length)) {
      if (this.#undos.length) this.#undos.shift(); else this.#redos.shift();
      refs = collect();
    }
    this.assets.setRetainedIds(refs.imports);
    this.images.setRetainedIds(refs.images);
    this.sources.retain(refs.imports, refs.environments);
  }
}

/** Conservative object/string overhead estimate, not a JavaScript heap measurement.
 * Pointer-equal subtrees at the same path cost nothing. Shared historical objects
 * count once; changed paths are visited without serializing entire scene snapshots.
 * Reordered subtrees can be overestimated, which only makes retention more conservative.
 */
export function estimateHistorySnapshotBytes(current: SceneSnapshot, history: readonly SceneSnapshot[]): number {
  const seen = new WeakSet<object>();
  const visit = (previous: unknown, active: unknown): number => {
    if (previous === active || previous === undefined || previous === null) return 0;
    if (typeof previous === "string") return previous.length * 2;
    if (typeof previous !== "object") return 8;
    if (seen.has(previous)) return 0;
    seen.add(previous);
    const entries = Object.entries(previous);
    const activeRecord = active && typeof active === "object" ? active as Record<string, unknown> : undefined;
    let bytes = 32 + entries.length * 16;
    for (const [key, value] of entries) bytes += visit(value, activeRecord?.[key]);
    return bytes;
  };
  return history.reduce((bytes, snapshot) => bytes + visit(snapshot, current), 0);
}
