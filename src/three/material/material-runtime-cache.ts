import * as THREE from "three";
import type { DeepReadonly } from "../../model/scene-model";
import { materialColorMapSignature } from "../../model/material/material-color-map";
import type {
  MaterialColorMapModel,
  MaterialDefinitionModel,
  MaterialTextureWrapMode,
} from "../../model/material/material-model";
import {
  applyMaterialProjection,
  createMeshPhysicalMaterial,
  projectMaterial,
  type MaterialProjection,
  type MaterialProjectionDiagnostic,
} from "./material-projector";
import {
  MaterialImageAssetStore,
  type DecodedMaterialImage,
} from "./image-asset-store";

type MaterialDefinitionSnapshot = DeepReadonly<MaterialDefinitionModel>;
type ColorMapSnapshot = DeepReadonly<MaterialColorMapModel>;

interface MaterialRuntimeEntry {
  readonly material: THREE.MeshPhysicalMaterial;
  fallbackMaterial?: THREE.MeshPhysicalMaterial;
  texture?: THREE.Texture<DecodedMaterialImage>;
  textureAssetId?: string;
  textureSignature: string;
  valueSignature: string;
  programSignature: string;
  projection: MaterialProjection;
  projectionDiagnostics: readonly MaterialProjectionDiagnostic[];
  runtimeDiagnostics: readonly MaterialProjectionDiagnostic[];
}

export class MaterialRuntimeCache {
  readonly #entries = new Map<string, MaterialRuntimeEntry>();
  readonly #images: MaterialImageAssetStore | undefined;
  #disposed = false;

  constructor(images?: MaterialImageAssetStore) {
    this.#images = images;
  }

  reconcile(definitions: readonly MaterialDefinitionSnapshot[]): void {
    this.#assertActive();
    const ids = collectUniqueMaterialIds(definitions);
    const projections = definitions.map((definition) => ({
      definition,
      projection: projectMaterial(definition),
    }));

    for (const { definition, projection } of projections) {
      let entry = this.#entries.get(definition.id);
      if (!entry) {
        const material = createMeshPhysicalMaterial(projection);
        material.name = definition.name;
        material.userData.sceneMaterialId = definition.id;
        entry = {
          material,
          textureSignature: "",
          valueSignature: projection.valueSignature,
          programSignature: projection.programSignature,
          projection,
          projectionDiagnostics: projection.diagnostics,
          runtimeDiagnostics: [],
        };
        this.#entries.set(definition.id, entry);
      } else {
        entry.material.name = definition.name;
        if (entry.valueSignature !== projection.valueSignature) {
          const programChanged =
            entry.programSignature !== projection.programSignature;
          applyMaterialProjection(entry.material, projection);
          if (entry.fallbackMaterial) {
            applyMaterialProjection(entry.fallbackMaterial, projection);
          }
          if (programChanged) {
            entry.material.needsUpdate = true;
            if (entry.fallbackMaterial) {
              entry.fallbackMaterial.needsUpdate = true;
            }
          }
          entry.valueSignature = projection.valueSignature;
          entry.programSignature = projection.programSignature;
        }
        entry.projection = projection;
        entry.projectionDiagnostics = projection.diagnostics;
      }

      this.#reconcileColorMap(entry, definition.colorMap);
    }

    for (const [id, entry] of this.#entries) {
      if (ids.has(id)) continue;
      this.#disposeEntry(entry);
      this.#entries.delete(id);
    }
  }

  getMaterial(materialId: string): THREE.MeshPhysicalMaterial | undefined {
    return this.#entries.get(materialId)?.material;
  }

  requireMaterial(materialId: string): THREE.MeshPhysicalMaterial {
    const material = this.getMaterial(materialId);
    if (!material) {
      throw new Error("Missing material runtime for SceneModel id: " + materialId);
    }
    return material;
  }

  requireUntexturedMaterial(materialId: string): THREE.MeshPhysicalMaterial {
    const entry = this.#entries.get(materialId);
    if (!entry) {
      throw new Error("Missing material runtime for SceneModel id: " + materialId);
    }
    if (!entry.texture) return entry.material;
    if (!entry.fallbackMaterial) {
      const fallback = createMeshPhysicalMaterial(entry.projection);
      fallback.name = entry.material.name + " (UV fallback)";
      fallback.userData.sceneMaterialId = materialId;
      fallback.userData.materialTextureFallback = true;
      entry.fallbackMaterial = fallback;
    }
    return entry.fallbackMaterial;
  }

  getDiagnostics(
    materialId: string,
  ): readonly MaterialProjectionDiagnostic[] {
    const entry = this.#entries.get(materialId);
    return entry
      ? [...entry.projectionDiagnostics, ...entry.runtimeDiagnostics]
      : [];
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) this.#disposeEntry(entry);
    this.#entries.clear();
  }

  #reconcileColorMap(
    entry: MaterialRuntimeEntry,
    colorMap: ColorMapSnapshot | null,
  ): void {
    if (!colorMap) {
      this.#detachTexture(entry);
      this.#disposeFallback(entry);
      entry.textureSignature = "";
      entry.runtimeDiagnostics = [];
      return;
    }

    const signature = materialColorMapSignature(
      colorMap as MaterialColorMapModel,
    );
    if (entry.texture && entry.textureAssetId === colorMap.assetId) {
      if (entry.textureSignature !== signature) {
        applyTextureMapping(entry.texture, colorMap);
        entry.textureSignature = signature;
      }
      entry.runtimeDiagnostics = [];
      return;
    }

    const lease = this.#images?.acquire(colorMap.assetId);
    if (!lease) {
      this.#detachTexture(entry);
      this.#disposeFallback(entry);
      entry.textureSignature = signature;
      entry.runtimeDiagnostics = [
        {
          path: "preview.colorMap",
          code: "preview.color-map.asset-unavailable",
          support: "stored-only",
        },
      ];
      return;
    }

    const texture = new THREE.Texture<DecodedMaterialImage>();
    texture.source = lease.source;
    texture.name = colorMap.sourceName;
    texture.userData.materialTextureAssetId = colorMap.assetId;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    applyTextureMapping(texture, colorMap);
    texture.needsUpdate = true;

    const hadTexture = Boolean(entry.texture);
    this.#detachTexture(entry);
    entry.texture = texture;
    entry.textureAssetId = colorMap.assetId;
    entry.textureSignature = signature;
    entry.material.map = texture;
    if (!hadTexture) entry.material.needsUpdate = true;
    entry.runtimeDiagnostics = [];
  }

  #detachTexture(entry: MaterialRuntimeEntry): void {
    const texture = entry.texture;
    const assetId = entry.textureAssetId;
    if (!texture || !assetId) {
      entry.material.map = null;
      entry.texture = undefined;
      entry.textureAssetId = undefined;
      return;
    }

    const hadMap = entry.material.map !== null;
    entry.material.map = null;
    if (hadMap) entry.material.needsUpdate = true;
    texture.dispose();
    this.#images?.release(assetId);
    entry.texture = undefined;
    entry.textureAssetId = undefined;
  }

  #disposeFallback(entry: MaterialRuntimeEntry): void {
    entry.fallbackMaterial?.dispose();
    entry.fallbackMaterial = undefined;
  }

  #disposeEntry(entry: MaterialRuntimeEntry): void {
    this.#detachTexture(entry);
    this.#disposeFallback(entry);
    entry.material.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("MaterialRuntimeCache has already been disposed.");
    }
  }
}

function applyTextureMapping(
  texture: THREE.Texture,
  colorMap: ColorMapSnapshot,
): void {
  const wrapping = toThreeWrapping(colorMap.wrapMode);
  texture.wrapS = wrapping;
  texture.wrapT = wrapping;
  texture.repeat.set(colorMap.repeatX, colorMap.repeatY);
  texture.offset.set(colorMap.offsetX, colorMap.offsetY);
  texture.center.set(0.5, 0.5);
  texture.rotation = THREE.MathUtils.degToRad(colorMap.rotationDegrees);
  texture.updateMatrix();
  texture.needsUpdate = true;
}

function toThreeWrapping(mode: MaterialTextureWrapMode): THREE.Wrapping {
  switch (mode) {
    case "repeat":
      return THREE.RepeatWrapping;
    case "clamp-to-edge":
      return THREE.ClampToEdgeWrapping;
    case "mirrored-repeat":
      return THREE.MirroredRepeatWrapping;
  }
}

function collectUniqueMaterialIds(
  definitions: readonly MaterialDefinitionSnapshot[],
): Set<string> {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error("Duplicate material id in SceneModel: " + definition.id);
    }
    ids.add(definition.id);
  }
  return ids;
}
