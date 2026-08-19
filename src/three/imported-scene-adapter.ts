import * as THREE from "three";
import type {
  ImportedSceneSnapshot,
} from "../model/imported-scene-model";
import type {
  DeepReadonly,
  MaterialDefinitionModel,
} from "../model/scene-model";
import {
  ImportedAssetStore,
  type ImportedAssetRuntime,
  type ImportedMesh,
} from "./imported-asset-store";
import { MaterialRuntimeCache } from "./material/material-runtime-cache";

interface ImportedSceneEntry {
  readonly assetId: string;
  readonly asset: ImportedAssetRuntime;
}

export class ImportedSceneAdapter {
  readonly #scene: THREE.Scene;
  readonly #assets: ImportedAssetStore;
  readonly #materials = new MaterialRuntimeCache();
  readonly #entries = new Map<string, ImportedSceneEntry>();

  constructor(scene: THREE.Scene, assets: ImportedAssetStore) {
    this.#scene = scene;
    this.#assets = assets;
  }

  applyModel(
    models: readonly ImportedSceneSnapshot[],
    materialDefinitions: readonly DeepReadonly<MaterialDefinitionModel>[],
  ): void {
    const resolvedAssets = this.#validateAndResolve(models, materialDefinitions);
    this.#materials.reconcile(materialDefinitions);

    const activeAssetIds = new Set(models.map(({ assetId }) => assetId));
    const previousAssetIds = new Set(
      [...this.#entries.values()].map(({ assetId }) => assetId),
    );
    const nextEntries = new Map<string, ImportedSceneEntry>();

    for (const model of models) {
      const asset = resolvedAssets.get(model.id);
      if (!asset) {
        throw new Error(`Missing resolved imported asset for model: ${model.id}`);
      }
      if (asset.root.parent !== this.#scene) this.#scene.add(asset.root);
      this.#applyImportedScene(asset, model);
      nextEntries.set(model.id, { assetId: model.assetId, asset });
    }

    for (const assetId of previousAssetIds) {
      if (activeAssetIds.has(assetId)) continue;
      const previous = [...this.#entries.values()].find(
        (entry) => entry.assetId === assetId,
      );
      if (previous) this.#scene.remove(previous.asset.root);
      this.#assets.delete(assetId);
    }

    this.#entries.clear();
    for (const [modelId, entry] of nextEntries) {
      this.#entries.set(modelId, entry);
    }
  }

  getObjectById(importedSceneId: string): THREE.Object3D | undefined {
    return this.#entries.get(importedSceneId)?.asset.root;
  }

  getPickableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const { asset } of this.#entries.values()) {
      if (!asset.root.visible) continue;
      asset.forEachMesh((mesh) => {
        if (isEffectivelyVisible(mesh, asset.root)) objects.push(mesh);
      });
    }
    return objects;
  }

  dispose(): void {
    const activeAssetIds = new Set(
      [...this.#entries.values()].map(({ assetId }) => assetId),
    );
    for (const assetId of activeAssetIds) this.#assets.delete(assetId);
    this.#entries.clear();
    this.#materials.dispose();
  }

  #validateAndResolve(
    models: readonly ImportedSceneSnapshot[],
    materialDefinitions: readonly DeepReadonly<MaterialDefinitionModel>[],
  ): Map<string, ImportedAssetRuntime> {
    const modelIds = new Set<string>();
    const assetIds = new Set<string>();
    const materialIds = new Set(materialDefinitions.map(({ id }) => id));
    const resolved = new Map<string, ImportedAssetRuntime>();

    for (const model of models) {
      if (modelIds.has(model.id)) {
        throw new Error(`Duplicate imported scene id: ${model.id}`);
      }
      modelIds.add(model.id);
      if (assetIds.has(model.assetId)) {
        throw new Error(`Duplicate imported asset id: ${model.assetId}`);
      }
      assetIds.add(model.assetId);

      const asset = this.#assets.get(model.assetId);
      if (!asset) {
        throw new Error(
          `Missing imported runtime asset for model ${model.id}: ${model.assetId}`,
        );
      }
      resolved.set(model.id, asset);

      if (model.materialMode === "custom") {
        if (!model.customMaterialId) {
          throw new Error(
            `Custom material mode requires a material id for imported scene: ${model.id}`,
          );
        }
        if (!materialIds.has(model.customMaterialId)) {
          throw new Error(
            `Missing material id for imported scene ${model.id}: ${model.customMaterialId}`,
          );
        }
      }
    }
    return resolved;
  }

  #applyImportedScene(
    asset: ImportedAssetRuntime,
    model: ImportedSceneSnapshot,
  ): void {
    const { root } = asset;
    root.name = model.name;
    root.userData.sceneModelId = model.id;
    root.visible = model.visible;
    root.position.set(
      model.transform.position.x,
      model.transform.position.y,
      model.transform.position.z,
    );
    root.rotation.set(
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.x),
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.y),
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.z),
    );
    root.scale.set(
      model.transform.scale.x,
      model.transform.scale.y,
      model.transform.scale.z,
    );

    if (model.materialMode === "imported") {
      asset.restoreOriginalMaterials();
    } else {
      const materialId = model.customMaterialId;
      if (!materialId) {
        throw new Error(
          `Custom material mode requires a material id for imported scene: ${model.id}`,
        );
      }
      const material = this.#materials.requireMaterial(materialId);
      asset.forEachMesh((mesh) => {
        mesh.material = material;
      });
    }

    asset.forEachMesh((mesh) => {
      mesh.userData.sceneModelId = model.id;
    });
  }
}

function isEffectivelyVisible(mesh: ImportedMesh, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = mesh;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}
