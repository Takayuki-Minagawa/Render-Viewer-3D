import {
  attachMaterialColorMap,
  removeMaterialColorMap,
  updateMaterialColorMap,
} from "../model/material/material-color-map";
import type {
  MaterialColorMapField,
  MaterialColorMapModel,
} from "../model/material/material-model";
import { MaterialImageAssetStore } from "../three/material/image-asset-store";
import type { SceneStore } from "./scene-store";

export type MaterialTextureControllerErrorCode =
  | "material-missing"
  | "disposed";

export class MaterialTextureControllerError extends Error {
  constructor(
    readonly code: MaterialTextureControllerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MaterialTextureControllerError";
  }
}

export class MaterialTextureController {
  readonly #sceneStore: SceneStore;
  readonly #assets: MaterialImageAssetStore;
  readonly #onAssetsReleased: (() => void) | undefined;
  readonly #generations = new Map<string, number>();
  #disposed = false;
  #activeImports = 0;
  #releaseRequested = false;
  #assetsReleased = false;

  constructor(
    sceneStore: SceneStore,
    assets: MaterialImageAssetStore,
    onAssetsReleased?: () => void,
  ) {
    this.#sceneStore = sceneStore;
    this.#assets = assets;
    this.#onAssetsReleased = onAssetsReleased;
  }

  async attach(
    materialId: string,
    file: File,
  ): Promise<MaterialColorMapModel | undefined> {
    this.#assertActive();
    this.#requireMaterial(materialId);
    const generation = this.#nextGeneration(materialId);
    this.#activeImports += 1;
    let colorMap: MaterialColorMapModel | undefined;

    try {
      colorMap = await this.#assets.importFile(file);
      if (
        this.#disposed ||
        this.#generations.get(materialId) !== generation ||
        !this.#hasMaterial(materialId)
      ) {
        this.#deleteAsset(colorMap.assetId);
        if (this.#disposed) this.#assertActive();
        if (!this.#hasMaterial(materialId)) {
          throw new MaterialTextureControllerError(
            "material-missing",
            "The target material no longer exists.",
          );
        }
        return undefined;
      }

      let attached = false;
      let publishedColorMap: MaterialColorMapModel | undefined;
      this.#sceneStore.update((draft) => {
        const material = draft.materials.find(({ id }) => id === materialId);
        const nextColorMap = material?.colorMap
          ? inheritMaterialColorMapMapping(material.colorMap, colorMap!)
          : colorMap!;
        attached = attachMaterialColorMap(draft, materialId, nextColorMap);
        if (attached) publishedColorMap = nextColorMap;
      });
      if (!attached) {
        throw new MaterialTextureControllerError(
          "material-missing",
          "The target material no longer exists.",
        );
      }
      this.releaseUnused();
      return publishedColorMap;
    } catch (error) {
      if (colorMap && !this.#isAssetReferenced(colorMap.assetId)) {
        this.#deleteAsset(colorMap.assetId);
      }
      throw error;
    } finally {
      this.#activeImports -= 1;
      if (this.#activeImports === 0) {
        if (this.#releaseRequested) {
          this.#releaseRequested = false;
          this.releaseUnused();
        } else {
          this.#notifyAssetsReleased();
        }
      }
    }
  }

  update(
    materialId: string,
    field: MaterialColorMapField,
    value: unknown,
  ): boolean {
    this.#assertActive();
    let updated = false;
    this.#sceneStore.update((draft) => {
      updated = updateMaterialColorMap(draft, materialId, field, value);
    });
    return updated;
  }

  remove(materialId: string): boolean {
    this.#assertActive();
    this.#nextGeneration(materialId);
    let removed = false;
    this.#sceneStore.update((draft) => {
      removed = removeMaterialColorMap(draft, materialId);
    });
    this.releaseUnused();
    return removed;
  }

  cancelPending(materialId: string): void {
    if (this.#disposed) return;
    this.#nextGeneration(materialId);
  }

  releaseUnused(): void {
    if (this.#activeImports > 0) {
      this.#releaseRequested = true;
      return;
    }
    this.#releaseRequested = false;
    const activeIds = new Set(
      this.#sceneStore
        .getSnapshot()
        .materials.flatMap(({ colorMap, maps }) =>
          [...(colorMap ? [colorMap.assetId] : []), ...Object.values(maps ?? {}).flatMap((map) => map ? [map.assetId] : [])],
        ),
    );
    for (const assetId of this.#assets.ids()) {
      if (!activeIds.has(assetId)) this.#deleteAsset(assetId);
    }
    this.#notifyAssetsReleased();
  }

  dispose(): void {
    this.#disposed = true;
    this.#generations.clear();
  }

  #deleteAsset(assetId: string): boolean {
    const released = this.#assets.delete(assetId);
    if (released) this.#assetsReleased = true;
    return released;
  }

  #notifyAssetsReleased(): void {
    if (!this.#assetsReleased) return;
    this.#assetsReleased = false;
    if (this.#disposed) return;
    try {
      this.#onAssetsReleased?.();
    } catch {
      // Asset cleanup and SceneModel publication are already committed. A
      // best-effort rendering retry must not turn them into a failed edit.
    }
  }

  #nextGeneration(materialId: string): number {
    const next = (this.#generations.get(materialId) ?? 0) + 1;
    this.#generations.set(materialId, next);
    return next;
  }

  #hasMaterial(materialId: string): boolean {
    return this.#sceneStore
      .getSnapshot()
      .materials.some(({ id }) => id === materialId);
  }

  #isAssetReferenced(assetId: string): boolean {
    return this.#sceneStore
      .getSnapshot()
      .materials.some(({ colorMap, maps }) => colorMap?.assetId === assetId || Object.values(maps ?? {}).some((map) => map?.assetId === assetId));
  }

  #requireMaterial(materialId: string): void {
    if (!this.#hasMaterial(materialId)) {
      throw new MaterialTextureControllerError(
        "material-missing",
        "The target material does not exist.",
      );
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new MaterialTextureControllerError(
        "disposed",
        "Material texture controller has already been disposed.",
      );
    }
  }
}

function inheritMaterialColorMapMapping(
  previous: MaterialColorMapModel,
  replacement: MaterialColorMapModel,
): MaterialColorMapModel {
  return {
    ...replacement,
    repeatX: previous.repeatX,
    repeatY: previous.repeatY,
    offsetX: previous.offsetX,
    offsetY: previous.offsetY,
    rotationDegrees: previous.rotationDegrees,
    wrapMode: previous.wrapMode,
  };
}
