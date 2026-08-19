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

export type MaterialTextureUvOrigin = "bottom-left" | "top-left";

interface MaterialRuntimeEntry {
  readonly material: THREE.MeshPhysicalMaterial;
  topLeftMaterial?: THREE.MeshPhysicalMaterial;
  fallbackMaterial?: THREE.MeshPhysicalMaterial;
  texture?: THREE.Texture<DecodedMaterialImage>;
  textureAssetId?: string;
  topLeftTexture?: THREE.Texture<DecodedMaterialImage>;
  topLeftTextureAssetId?: string;
  textureSignature: string;
  colorMap: ColorMapSnapshot | null;
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
          colorMap: null,
          valueSignature: projection.valueSignature,
          programSignature: projection.programSignature,
          projection,
          projectionDiagnostics: projection.diagnostics,
          runtimeDiagnostics: [],
        };
        this.#entries.set(definition.id, entry);
      } else {
        entry.material.name = definition.name;
        if (entry.topLeftMaterial) {
          entry.topLeftMaterial.name = topLeftMaterialName(definition.name);
        }
        if (entry.valueSignature !== projection.valueSignature) {
          const programChanged =
            entry.programSignature !== projection.programSignature;
          applyMaterialProjection(entry.material, projection);
          if (entry.fallbackMaterial) {
            applyMaterialProjection(entry.fallbackMaterial, projection);
          }
          if (entry.topLeftMaterial) {
            applyMaterialProjection(entry.topLeftMaterial, projection);
          }
          if (programChanged) {
            entry.material.needsUpdate = true;
            if (entry.fallbackMaterial) {
              entry.fallbackMaterial.needsUpdate = true;
            }
            if (entry.topLeftMaterial) {
              entry.topLeftMaterial.needsUpdate = true;
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

  requireMaterial(
    materialId: string,
    uvOrigin: MaterialTextureUvOrigin = "bottom-left",
  ): THREE.MeshPhysicalMaterial {
    const entry = this.#entries.get(materialId);
    if (!entry) {
      throw new Error("Missing material runtime for SceneModel id: " + materialId);
    }
    if (uvOrigin === "top-left") {
      return this.#getTopLeftMaterial(entry, materialId);
    }
    return entry.material;
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
    entry.colorMap = colorMap;
    if (!colorMap) {
      this.#detachTexture(entry);
      this.#disposeTopLeftMaterial(entry);
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
        applyTextureMapping(entry.texture, colorMap, "bottom-left");
        if (entry.topLeftTexture) {
          applyTextureMapping(entry.topLeftTexture, colorMap, "top-left");
        }
        entry.textureSignature = signature;
      }
      entry.runtimeDiagnostics = [];
      return;
    }

    const hadTexture = Boolean(entry.texture);
    const hadTopLeftTexture = Boolean(entry.topLeftTexture);
    this.#detachTexture(entry);
    this.#detachTopLeftTexture(entry);

    const texture = this.#createTexture(colorMap, "bottom-left");
    if (!texture) {
      this.#markTextureUnavailable(entry, signature);
      return;
    }

    let topLeftTexture: THREE.Texture<DecodedMaterialImage> | undefined;
    try {
      if (entry.topLeftMaterial) {
        topLeftTexture = this.#createTexture(colorMap, "top-left");
      }
    } catch (error) {
      texture.dispose();
      this.#images?.release(colorMap.assetId);
      throw error;
    }
    if (entry.topLeftMaterial && !topLeftTexture) {
      texture.dispose();
      this.#images?.release(colorMap.assetId);
      this.#markTextureUnavailable(entry, signature);
      return;
    }

    entry.texture = texture;
    entry.textureAssetId = colorMap.assetId;
    entry.textureSignature = signature;
    entry.material.map = texture;
    if (!hadTexture) entry.material.needsUpdate = true;
    if (entry.topLeftMaterial && topLeftTexture) {
      entry.topLeftTexture = topLeftTexture;
      entry.topLeftTextureAssetId = colorMap.assetId;
      entry.topLeftMaterial.map = topLeftTexture;
      if (!hadTopLeftTexture) entry.topLeftMaterial.needsUpdate = true;
    }
    entry.runtimeDiagnostics = [];
  }

  #getTopLeftMaterial(
    entry: MaterialRuntimeEntry,
    materialId: string,
  ): THREE.MeshPhysicalMaterial {
    const colorMap = entry.colorMap;
    if (!entry.texture || !colorMap) return entry.material;
    if (entry.topLeftMaterial && entry.topLeftTexture) {
      return entry.topLeftMaterial;
    }

    const texture = this.#createTexture(colorMap, "top-left");
    if (!texture) return this.requireUntexturedMaterial(materialId);

    let material = entry.topLeftMaterial;
    try {
      if (!material) material = createMeshPhysicalMaterial(entry.projection);
    } catch (error) {
      texture.dispose();
      this.#images?.release(colorMap.assetId);
      throw error;
    }
    material.name = topLeftMaterialName(entry.material.name);
    material.userData.sceneMaterialId = materialId;
    material.userData.materialTextureUvOrigin = "top-left";
    material.map = texture;
    material.needsUpdate = true;
    entry.topLeftMaterial = material;
    entry.topLeftTexture = texture;
    entry.topLeftTextureAssetId = colorMap.assetId;
    return material;
  }

  #createTexture(
    colorMap: ColorMapSnapshot,
    uvOrigin: MaterialTextureUvOrigin,
  ): THREE.Texture<DecodedMaterialImage> | undefined {
    const lease = this.#images?.acquire(colorMap.assetId);
    if (!lease) return undefined;

    const texture = new THREE.Texture<DecodedMaterialImage>();
    try {
      texture.source = lease.source;
      texture.name = colorMap.sourceName;
      texture.userData.materialTextureAssetId = colorMap.assetId;
      texture.userData.materialTextureUvOrigin = uvOrigin;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      applyTextureMapping(texture, colorMap, uvOrigin, false);
      texture.needsUpdate = true;
      return texture;
    } catch (error) {
      texture.dispose();
      this.#images?.release(colorMap.assetId);
      throw error;
    }
  }

  #markTextureUnavailable(
    entry: MaterialRuntimeEntry,
    signature: string,
  ): void {
    this.#detachTexture(entry);
    this.#disposeTopLeftMaterial(entry);
    this.#disposeFallback(entry);
    entry.textureSignature = signature;
    entry.runtimeDiagnostics = [
      {
        path: "preview.colorMap",
        code: "preview.color-map.asset-unavailable",
        support: "stored-only",
      },
    ];
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

  #detachTopLeftTexture(entry: MaterialRuntimeEntry): void {
    const texture = entry.topLeftTexture;
    const assetId = entry.topLeftTextureAssetId;
    if (!texture || !assetId) {
      if (entry.topLeftMaterial) entry.topLeftMaterial.map = null;
      entry.topLeftTexture = undefined;
      entry.topLeftTextureAssetId = undefined;
      return;
    }

    if (entry.topLeftMaterial) {
      const hadMap = entry.topLeftMaterial.map !== null;
      entry.topLeftMaterial.map = null;
      if (hadMap) entry.topLeftMaterial.needsUpdate = true;
    }
    texture.dispose();
    this.#images?.release(assetId);
    entry.topLeftTexture = undefined;
    entry.topLeftTextureAssetId = undefined;
  }

  #disposeTopLeftMaterial(entry: MaterialRuntimeEntry): void {
    this.#detachTopLeftTexture(entry);
    entry.topLeftMaterial?.dispose();
    entry.topLeftMaterial = undefined;
  }

  #disposeFallback(entry: MaterialRuntimeEntry): void {
    entry.fallbackMaterial?.dispose();
    entry.fallbackMaterial = undefined;
  }

  #disposeEntry(entry: MaterialRuntimeEntry): void {
    this.#detachTexture(entry);
    this.#disposeTopLeftMaterial(entry);
    this.#disposeFallback(entry);
    entry.material.dispose();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("MaterialRuntimeCache has already been disposed.");
    }
  }
}

const TOP_LEFT_UV_Y_FLIP_MATRIX = new THREE.Matrix3().set(
  1, 0, 0,
  0, -1, 1,
  0, 0, 1,
);

function applyTextureMapping(
  texture: THREE.Texture,
  colorMap: ColorMapSnapshot,
  uvOrigin: MaterialTextureUvOrigin,
  notifyWrapChange = true,
): void {
  const wrapping = toThreeWrapping(colorMap.wrapMode);
  const wrapChanged = texture.wrapS !== wrapping || texture.wrapT !== wrapping;
  texture.wrapS = wrapping;
  texture.wrapT = wrapping;
  texture.repeat.set(colorMap.repeatX, colorMap.repeatY);
  texture.offset.set(colorMap.offsetX, colorMap.offsetY);
  texture.center.set(0.5, 0.5);
  texture.rotation = THREE.MathUtils.degToRad(colorMap.rotationDegrees);
  texture.updateMatrix();
  texture.matrixAutoUpdate = uvOrigin === "bottom-left";
  if (uvOrigin === "top-left") {
    texture.matrix.multiply(TOP_LEFT_UV_Y_FLIP_MATRIX);
  }
  if (notifyWrapChange && wrapChanged) texture.needsUpdate = true;
}

function topLeftMaterialName(name: string): string {
  return name + " (top-left UV origin)";
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
