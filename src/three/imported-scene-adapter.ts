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
import {
  MaterialRuntimeCache,
  type MaterialTextureUvOrigin,
} from "./material/material-runtime-cache";

interface ImportedAssetUvProfile {
  readonly meshes: readonly ImportedMesh[];
  readonly hasUsableTextureCoordinates: boolean;
  readonly hasMissingTextureCoordinates: boolean;
  readonly usableMeshes: WeakSet<ImportedMesh>;
}

interface ResolvedImportedMaterialRuntime {
  readonly texturedMaterial: THREE.MeshPhysicalMaterial;
  readonly fallbackMaterial: THREE.MeshPhysicalMaterial;
  readonly uvProfile: ImportedAssetUvProfile;
}

interface ImportedSceneEntry {
  readonly assetId: string;
  readonly asset: ImportedAssetRuntime;
  readonly rootSignature: string;
  readonly materialSignature: string;
  readonly materialRuntime?: ResolvedImportedMaterialRuntime;
}

export class ImportedSceneAdapter {
  readonly #scene: THREE.Scene;
  readonly #assets: ImportedAssetStore;
  readonly #materials: MaterialRuntimeCache;
  readonly #ownsMaterials: boolean;
  readonly #entries = new Map<string, ImportedSceneEntry>();
  readonly #uvProfiles = new WeakMap<
    ImportedAssetRuntime,
    ImportedAssetUvProfile
  >();

  constructor(
    scene: THREE.Scene,
    assets: ImportedAssetStore,
    materials?: MaterialRuntimeCache,
  ) {
    this.#scene = scene;
    this.#assets = assets;
    this.#materials = materials ?? new MaterialRuntimeCache();
    this.#ownsMaterials = materials === undefined;
  }

  applyModel(
    models: readonly ImportedSceneSnapshot[],
    materialDefinitions: readonly DeepReadonly<MaterialDefinitionModel>[],
  ): void {
    const resolvedAssets = this.#validateAndResolve(models, materialDefinitions);
    if (this.#ownsMaterials) this.#materials.reconcile(materialDefinitions);

    const activeAssetIds = new Set(models.map(({ assetId }) => assetId));
    const previousAssetIds = new Set(
      [...this.#entries.values()].map(({ assetId }) => assetId),
    );
    const nextEntries = new Map<string, ImportedSceneEntry>();

    for (const model of models) {
      const previous = this.#entries.get(model.id);
      const asset = resolvedAssets.get(model.id);
      if (!asset) {
        throw new Error(`Missing resolved imported asset for model: ${model.id}`);
      }
      if (asset.root.parent !== this.#scene) this.#scene.add(asset.root);
      const rootSignature = importedRootSignature(model);
      const materialRuntime = this.#resolveMaterialRuntime(asset, model);
      const materialSignature = importedMaterialSignature(
        model,
        materialDefinitions,
        Boolean(materialRuntime?.texturedMaterial.map),
      );
      this.#applyImportedScene(
        asset,
        model,
        previous,
        rootSignature,
        materialSignature,
        materialRuntime,
      );
      nextEntries.set(model.id, {
        assetId: model.assetId,
        asset,
        rootSignature,
        materialSignature,
        materialRuntime,
      });
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
    if (this.#ownsMaterials) this.#materials.dispose();
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

  #resolveMaterialRuntime(
    asset: ImportedAssetRuntime,
    model: ImportedSceneSnapshot,
  ): ResolvedImportedMaterialRuntime | undefined {
    if (model.materialMode !== "custom") return undefined;
    const materialId = model.customMaterialId;
    if (!materialId) {
      throw new Error(
        `Custom material mode requires a material id for imported scene: ${model.id}`,
      );
    }

    const uvProfile = this.#getUvProfile(asset);
    const defaultMaterial = this.#materials.requireMaterial(materialId);
    const fallbackMaterial =
      uvProfile.hasMissingTextureCoordinates && defaultMaterial.map
        ? this.#materials.requireUntexturedMaterial(materialId)
        : defaultMaterial;
    const texturedMaterial = uvProfile.hasUsableTextureCoordinates
      ? this.#materials.requireMaterial(
          materialId,
          textureUvOriginForFormat(model.format),
        )
      : defaultMaterial;
    return { texturedMaterial, fallbackMaterial, uvProfile };
  }

  #getUvProfile(asset: ImportedAssetRuntime): ImportedAssetUvProfile {
    const cached = this.#uvProfiles.get(asset);
    if (cached) return cached;

    const meshes: ImportedMesh[] = [];
    const usableMeshes = new WeakSet<ImportedMesh>();
    let hasUsableMeshes = false;
    let hasMissingMeshes = false;
    asset.forEachMesh((mesh) => {
      meshes.push(mesh);
      if (hasUsableTextureCoordinates(mesh.geometry)) {
        usableMeshes.add(mesh);
        hasUsableMeshes = true;
      } else {
        hasMissingMeshes = true;
      }
    });
    const profile = {
      hasUsableTextureCoordinates: hasUsableMeshes,
      meshes,
      hasMissingTextureCoordinates: hasMissingMeshes,
      usableMeshes,
    };
    this.#uvProfiles.set(asset, profile);
    return profile;
  }

  #applyImportedScene(
    asset: ImportedAssetRuntime,
    model: ImportedSceneSnapshot,
    previous: ImportedSceneEntry | undefined,
    rootSignature: string,
    materialSignature: string,
    materialRuntime: ResolvedImportedMaterialRuntime | undefined,
  ): void {
    const prior = previous?.asset === asset ? previous : undefined;
    const { root } = asset;

    if (!prior) {
      root.userData.sceneModelId = model.id;
      asset.forEachMesh((mesh) => {
        mesh.userData.sceneModelId = model.id;
      });
    }

    if (!prior || prior.rootSignature !== rootSignature) {
      root.name = model.name;
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
    }

    const resolvedMaterialChanged =
      prior?.materialRuntime?.texturedMaterial !==
        materialRuntime?.texturedMaterial ||
      prior?.materialRuntime?.fallbackMaterial !==
        materialRuntime?.fallbackMaterial;
    if (
      !prior ||
      prior.materialSignature !== materialSignature ||
      resolvedMaterialChanged
    ) {
      if (model.materialMode === "imported") {
        asset.restoreOriginalMaterials();
      } else {
        if (!materialRuntime) {
          throw new Error(
            `Missing custom material runtime for imported scene: ${model.id}`,
          );
        }
        for (const mesh of materialRuntime.uvProfile.meshes) {
          mesh.material = materialRuntime.uvProfile.usableMeshes.has(mesh)
            ? materialRuntime.texturedMaterial
            : materialRuntime.fallbackMaterial;
        }
      }
    }
  }
}

function importedRootSignature(model: ImportedSceneSnapshot): string {
  const { position, rotationDegrees, scale } = model.transform;
  return JSON.stringify([
    model.name,
    model.visible,
    position.x,
    position.y,
    position.z,
    rotationDegrees.x,
    rotationDegrees.y,
    rotationDegrees.z,
    scale.x,
    scale.y,
    scale.z,
  ]);
}

function importedMaterialSignature(
  model: ImportedSceneSnapshot,
  materialDefinitions: readonly DeepReadonly<MaterialDefinitionModel>[],
  runtimeHasColorMap: boolean,
): string {
  const customMaterial = model.customMaterialId
    ? materialDefinitions.find(({ id }) => id === model.customMaterialId)
    : undefined;
  return JSON.stringify([
    model.materialMode,
    model.customMaterialId,
    customMaterial?.colorMap?.assetId ?? null,
    runtimeHasColorMap,
    textureUvOriginForFormat(model.format),
  ]);
}

function textureUvOriginForFormat(format: string): MaterialTextureUvOrigin {
  return format === "glTF" ? "top-left" : "bottom-left";
}

function hasUsableTextureCoordinates(
  geometry: THREE.BufferGeometry,
): boolean {
  const positions = geometry.getAttribute("position");
  const uvs = geometry.getAttribute("uv");
  return Boolean(
    positions &&
      uvs &&
      uvs.itemSize >= 2 &&
      uvs.count >= positions.count,
  );
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
