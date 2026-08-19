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
  readonly #generations = new Map<string, number>();
  #disposed = false;
  #activeImports = 0;
  #releaseRequested = false;

  constructor(sceneStore: SceneStore, assets: MaterialImageAssetStore) {
    this.#sceneStore = sceneStore;
    this.#assets = assets;
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
        this.#assets.delete(colorMap.assetId);
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
      this.#sceneStore.update((draft) => {
        attached = attachMaterialColorMap(draft, materialId, colorMap!);
      });
      if (!attached) {
        throw new MaterialTextureControllerError(
          "material-missing",
          "The target material no longer exists.",
        );
      }
      this.releaseUnused();
      return colorMap;
    } catch (error) {
      if (colorMap && !this.#isAssetReferenced(colorMap.assetId)) {
        this.#assets.delete(colorMap.assetId);
      }
      throw error;
    } finally {
      this.#activeImports -= 1;
      if (this.#activeImports === 0 && this.#releaseRequested) {
        this.#releaseRequested = false;
        this.releaseUnused();
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
        .materials.flatMap(({ colorMap }) =>
          colorMap ? [colorMap.assetId] : [],
        ),
    );
    for (const assetId of this.#assets.ids()) {
      if (!activeIds.has(assetId)) this.#assets.delete(assetId);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#generations.clear();
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
      .materials.some(({ colorMap }) => colorMap?.assetId === assetId);
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
