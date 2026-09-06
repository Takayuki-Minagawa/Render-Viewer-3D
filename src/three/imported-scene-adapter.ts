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
  type ImportedRenderable,
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

interface ImportedNodeRuntime {
  readonly object: THREE.Object3D;
  readonly originalVisible: boolean;
}

interface ImportedSceneEntry {
  readonly assetId: string;
  readonly asset: ImportedAssetRuntime;
  readonly rootSignature: string;
  readonly materialSignature: string;
  readonly nodeVisibilitySignature: string;
  readonly materialRuntime?: ResolvedImportedMaterialRuntime;
}

export class ImportedSceneAdapter {
  readonly #scene: THREE.Scene;
  readonly #assets: ImportedAssetStore;
  readonly #materials: MaterialRuntimeCache;
  readonly #ownsMaterials: boolean;
  readonly #entries = new Map<string, ImportedSceneEntry>();
  readonly #nodeProfiles = new WeakMap<ImportedAssetRuntime, Map<string, ImportedNodeRuntime>>();
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
      const nodeMaterials = this.#resolveNodeMaterials(asset, model);
      const materialSignature = importedMaterialSignature(
        model,
        materialDefinitions,
        Boolean(materialRuntime && hasMaterialMaps(materialRuntime.texturedMaterial)),
      ) + JSON.stringify([...nodeMaterials].map(([id, runtime]) => [id, runtime.texturedMaterial.uuid, runtime.fallbackMaterial.uuid]));
      const nodeVisibilitySignature = JSON.stringify([model.isolatedNodeId, Object.entries(model.nodeOverrides ?? {}).map(([id, override]) => [id, override.visible])]);
      this.#applyImportedScene(
        asset,
        model,
        previous,
        rootSignature,
        materialSignature,
        materialRuntime,
        nodeMaterials,
        nodeVisibilitySignature,
      );
      nextEntries.set(model.id, {
        assetId: model.assetId,
        asset,
        rootSignature,
        materialSignature,
        nodeVisibilitySignature,
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
      asset.forEachRenderable((object) => {
        if (isEffectivelyVisible(object, asset.root)) objects.push(object);
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

      for (const [nodeId, override] of Object.entries(model.nodeOverrides ?? {})) {
        if (!this.#getNodeProfile(asset).has(nodeId)) throw new Error(`Missing imported node: ${nodeId}`);
        if (override.materialId && !materialIds.has(override.materialId)) throw new Error(`Missing material id for imported node ${nodeId}: ${override.materialId}`);
      }
      if (model.isolatedNodeId && !this.#getNodeProfile(asset).has(model.isolatedNodeId)) throw new Error(`Missing isolated imported node: ${model.isolatedNodeId}`);

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
      uvProfile.hasMissingTextureCoordinates && hasMaterialMaps(defaultMaterial)
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
    nodeMaterials: ReadonlyMap<string, ResolvedImportedMaterialRuntime>,
    nodeVisibilitySignature: string,
  ): void {
    const prior = previous?.asset === asset ? previous : undefined;
    const { root } = asset;

    if (!prior) {
      root.userData.sceneModelId = model.id;
      asset.forEachRenderable((object) => {
        object.userData.sceneModelId = model.id;
      });
      for (const [nodeId, { object }] of this.#getNodeProfile(asset)) {
        object.userData.sceneModelId = model.id;
        object.userData.importedNodeId = nodeId;
      }
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

    if (!prior || prior.nodeVisibilitySignature !== nodeVisibilitySignature) {
      for (const [id, node] of this.#getNodeProfile(asset)) {
        const isolate = model.isolatedNodeId;
        const related = !isolate || id === isolate || id.startsWith(`${isolate}-`) || isolate.startsWith(`${id}-`);
        node.object.visible = related && (model.nodeOverrides?.[id]?.visible ?? node.originalVisible);
      }
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
      // Parent overrides apply first; a more specific child override wins.
      for (const [nodeId, runtime] of [...nodeMaterials].sort(([a], [b]) => a.split("-").length - b.split("-").length)) {
        const node = this.#getNodeProfile(asset).get(nodeId)!;
        node.object.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.material = runtime.uvProfile.usableMeshes.has(object)
            ? runtime.texturedMaterial : runtime.fallbackMaterial;
        });
      }
    }
  }

  #getNodeProfile(asset: ImportedAssetRuntime): Map<string, ImportedNodeRuntime> {
    const cached = this.#nodeProfiles.get(asset);
    if (cached) return cached;
    const profile = new Map<string, ImportedNodeRuntime>();
    const pending = asset.sourceRoot.children.map((object, index) => ({ object, id: `node-${index}` }));
    while (pending.length) {
      const { object, id } = pending.pop()!;
      profile.set(id, { object, originalVisible: object.visible });
      object.children.forEach((child, index) => pending.push({ object: child, id: `${id}-${index}` }));
    }
    this.#nodeProfiles.set(asset, profile);
    return profile;
  }

  #resolveNodeMaterials(asset: ImportedAssetRuntime, model: ImportedSceneSnapshot): Map<string, ResolvedImportedMaterialRuntime> {
    const runtimes = new Map<string, ResolvedImportedMaterialRuntime>();
    for (const [nodeId, override] of Object.entries(model.nodeOverrides ?? {})) {
      if (!override.materialId) continue;
      const runtime = this.#resolveMaterialRuntime(asset, { ...model, materialMode: "custom", customMaterialId: override.materialId });
      if (runtime) runtimes.set(nodeId, runtime);
    }
    return runtimes;
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
    customMaterial?.maps,
    runtimeHasColorMap,
    textureUvOriginForFormat(model.format),
    Object.entries(model.nodeOverrides ?? {}).map(([id, override]) => [id, override.materialId,
      materialDefinitions.find(material => material.id === override.materialId)?.colorMap?.assetId,
      materialDefinitions.find(material => material.id === override.materialId)?.maps]),
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

function isEffectivelyVisible(
  object: ImportedRenderable,
  root: THREE.Object3D,
): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function hasMaterialMaps(material: THREE.MeshPhysicalMaterial): boolean {
  return Boolean(material.map || material.normalMap || material.roughnessMap || material.metalnessMap || material.aoMap);
}
