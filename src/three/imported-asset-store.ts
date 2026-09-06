import * as THREE from "three";

export type ImportedMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;
export type ImportedPointCloud = THREE.Points<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;
export type ImportedLine = THREE.Line<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;
export type ImportedRenderable = ImportedMesh | ImportedPointCloud | ImportedLine;

type OriginalMeshMaterial = THREE.Material | THREE.Material[];

export class ImportedAssetRuntime {
  readonly assetId: string;
  readonly root: THREE.Group;
  readonly sourceRoot: THREE.Object3D;
  readonly #originalMeshMaterials = new Map<
    ImportedMesh,
    OriginalMeshMaterial
  >();
  readonly #renderableObjects = new Set<ImportedRenderable>();
  readonly #ownedGeometries = new Set<THREE.BufferGeometry>();
  readonly #ownedMaterials = new Set<THREE.Material>();
  readonly #ownedSkeletons = new Set<THREE.Skeleton>();
  readonly #ownedInstancedMeshes = new Set<THREE.InstancedMesh>();
  readonly #ownedLights = new Set<THREE.Light>();
  #disposed = false;

  constructor(assetId: string, sourceRoot: THREE.Object3D) {
    this.assetId = assetId;
    this.sourceRoot = sourceRoot;
    this.root = new THREE.Group();
    this.root.name = sourceRoot.name;
    this.root.userData.importedAssetId = assetId;
    this.#captureOwnedResources();
    this.root.add(sourceRoot);
  }

  forEachMesh(visitor: (mesh: ImportedMesh) => void): void {
    for (const mesh of this.#originalMeshMaterials.keys()) visitor(mesh);
  }

  forEachRenderable(
    visitor: (object: ImportedRenderable) => void,
  ): void {
    for (const object of this.#renderableObjects) visitor(object);
  }

  restoreOriginalMaterials(): void {
    for (const [mesh, material] of this.#originalMeshMaterials) {
      mesh.material = material;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.restoreOriginalMaterials();
    this.root.removeFromParent();
    this.root.remove(this.sourceRoot);

    const textures = new Set<THREE.Texture>();
    for (const light of this.#ownedLights) {
      light.dispose();
    }
    for (const instancedMesh of this.#ownedInstancedMeshes) {
      if (instancedMesh.morphTexture) {
        textures.add(instancedMesh.morphTexture);
        instancedMesh.morphTexture = null;
      }
      instancedMesh.dispose();
    }
    for (const skeleton of this.#ownedSkeletons) {
      if (skeleton.boneTexture) {
        textures.add(skeleton.boneTexture);
        skeleton.boneTexture = null;
      }
      skeleton.dispose();
    }
    for (const material of this.#ownedMaterials) {
      collectMaterialTextures(material, textures);
    }

    const closedImages = new Set<object>();
    for (const texture of textures) {
      closeTextureImages(texture, closedImages);
      texture.dispose();
    }
    for (const material of this.#ownedMaterials) material.dispose();
    for (const geometry of this.#ownedGeometries) geometry.dispose();

    this.#originalMeshMaterials.clear();
    this.#renderableObjects.clear();
    this.#ownedMaterials.clear();
    this.#ownedGeometries.clear();
    this.#ownedSkeletons.clear();
    this.#ownedInstancedMeshes.clear();
    this.#ownedLights.clear();
  }

  #captureOwnedResources(): void {
    this.sourceRoot.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: unknown;
        material?: unknown;
      };
      if (object instanceof THREE.Light) {
        this.#ownedLights.add(object);
      }
      if (
        object instanceof THREE.SkinnedMesh &&
        object.skeleton instanceof THREE.Skeleton
      ) {
        this.#ownedSkeletons.add(object.skeleton);
      }
      if (object instanceof THREE.InstancedMesh) {
        this.#ownedInstancedMeshes.add(object);
      }
      if (renderable.geometry instanceof THREE.BufferGeometry) {
        this.#ownedGeometries.add(renderable.geometry);
      }

      if (object instanceof THREE.Mesh) {
        const mesh = object as ImportedMesh;
        this.#originalMeshMaterials.set(mesh, mesh.material);
        this.#renderableObjects.add(mesh);
      } else if (object instanceof THREE.Points) {
        this.#renderableObjects.add(object as ImportedPointCloud);
      } else if (object instanceof THREE.Line) {
        this.#renderableObjects.add(object as ImportedLine);
      }

      for (const material of asMaterials(renderable.material)) {
        this.#ownedMaterials.add(material);
      }
    });
  }
}

export class ImportedAssetStore {
  #retained = new Set<string>();
  readonly #deferredDeletes = new Set<string>();
  readonly #assets = new Map<string, ImportedAssetRuntime>();
  readonly #assetResources = new Map<string, Set<object>>();
  readonly #ownedResources = new Set<object>();

  get size(): number {
    return this.#assets.size;
  }

  ids(): readonly string[] { return [...this.#assets.keys()]; }

  setRetainedIds(ids: ReadonlySet<string>): void {
    this.#retained = new Set(ids);
    for (const id of this.#deferredDeletes) {
      if (!this.#retained.has(id)) this.delete(id);
    }
  }

  estimatedBytes(assetId: string): number {
    const resources = this.#assetResources.get(assetId);
    if (!resources) return 0;
    let bytes = 0;
    const arrays = new Set<ArrayBufferLike>();
    for (const resource of resources) {
      if (resource instanceof THREE.BufferGeometry) {
        const attributes = [...Object.values(resource.attributes), resource.index];
        for (const attribute of attributes) {
          if (!attribute) continue;
          const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : (attribute as THREE.BufferAttribute).array;
          if (!ArrayBuffer.isView(array)) continue;
          if (!arrays.has(array.buffer)) { arrays.add(array.buffer); bytes += array.byteLength * 2; }
        }
      } else if (resource instanceof THREE.Texture) {
        const image = resource.image as { width?: number; height?: number } | undefined;
        bytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 8 / 3;
      }
    }
    return bytes;
  }

  register(assetId: string, sourceRoot: THREE.Object3D): ImportedAssetRuntime {
    const normalizedAssetId = assetId.trim();
    if (!normalizedAssetId) {
      throw new Error("Imported asset id must not be empty.");
    }
    if (this.#assets.has(normalizedAssetId)) {
      throw new Error(`Duplicate imported asset id: ${normalizedAssetId}`);
    }
    for (const asset of this.#assets.values()) {
      if (asset.sourceRoot === sourceRoot) {
        throw new Error(
          `Imported Object3D is already registered as asset: ${asset.assetId}`,
        );
      }
    }

    const resources = collectOwnedResourceIdentities(sourceRoot);
    for (const resource of resources) {
      if (this.#ownedResources.has(resource)) {
        throw new Error(
          "Imported assets must not share geometry, material, texture, image, skeleton, instancing, light, or shadow resources.",
        );
      }
    }

    const asset = new ImportedAssetRuntime(normalizedAssetId, sourceRoot);
    this.#assets.set(normalizedAssetId, asset);
    this.#assetResources.set(normalizedAssetId, resources);
    for (const resource of resources) {
      this.#ownedResources.add(resource);
    }
    return asset;
  }

  get(assetId: string): ImportedAssetRuntime | undefined {
    return this.#assets.get(assetId);
  }

  delete(assetId: string): boolean {
    if (this.#retained.has(assetId)) { this.#deferredDeletes.add(assetId); return false; }
    this.#deferredDeletes.delete(assetId);
    const asset = this.#assets.get(assetId);
    if (!asset) return false;
    const resources = this.#assetResources.get(assetId) ?? new Set<object>();
    this.#assets.delete(assetId);
    this.#assetResources.delete(assetId);
    try {
      asset.dispose();
    } finally {
      for (const resource of resources) {
        this.#ownedResources.delete(resource);
      }
    }
    return true;
  }

  dispose(): void {
    this.#retained.clear();
    for (const assetId of [...this.#assets.keys()]) this.delete(assetId);
  }
}

function collectOwnedResourceIdentities(
  root: THREE.Object3D,
): Set<object> {
  const resources = new Set<object>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: unknown;
      material?: unknown;
    };
    if (object instanceof THREE.Light) {
      collectLightResourceIdentities(object, resources);
    }
    if (
      object instanceof THREE.SkinnedMesh &&
      object.skeleton instanceof THREE.Skeleton
    ) {
      resources.add(object.skeleton);
      if (object.skeleton.boneTexture) {
        textures.add(object.skeleton.boneTexture);
      }
    }
    if (object instanceof THREE.InstancedMesh) {
      resources.add(object);
      resources.add(object.instanceMatrix);
      if (object.instanceColor) resources.add(object.instanceColor);
      if (object.morphTexture) textures.add(object.morphTexture);
    }
    if (renderable.geometry instanceof THREE.BufferGeometry) {
      resources.add(renderable.geometry);
    }
    for (const material of asMaterials(renderable.material)) {
      materials.add(material);
    }
  });

  for (const material of materials) {
    resources.add(material);
    collectMaterialTextures(material, textures);
  }
  for (const texture of textures) {
    resources.add(texture);
    collectImageIdentities(texture.image, resources);
    collectImageIdentities(texture.source.data, resources);
  }
  return resources;
}

function collectLightResourceIdentities(
  light: THREE.Light,
  resources: Set<object>,
): void {
  resources.add(light);
  const shadow = (light as THREE.Light & {
    shadow?: THREE.LightShadow;
  }).shadow;
  if (!shadow) return;
  resources.add(shadow);
  collectRenderTargetIdentities(shadow.map, resources);
  collectRenderTargetIdentities(shadow.mapPass, resources);
}

function collectRenderTargetIdentities(
  target: THREE.RenderTarget | null,
  resources: Set<object>,
): void {
  if (!target) return;
  resources.add(target);
  resources.add(target.texture);
  if (target.depthTexture) resources.add(target.depthTexture);
  collectImageIdentities(target.texture.image, resources);
  collectImageIdentities(target.texture.source.data, resources);
  if (target.depthTexture) {
    collectImageIdentities(target.depthTexture.image, resources);
    collectImageIdentities(target.depthTexture.source.data, resources);
  }
}

function collectImageIdentities(value: unknown, resources: Set<object>): void {
  if (Array.isArray(value)) {
    for (const image of value) collectImageIdentities(image, resources);
    return;
  }
  if (typeof value === "object" && value !== null) resources.add(value);
}

function asMaterials(value: unknown): THREE.Material[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(isMaterial);
}

function isMaterial(value: unknown): value is THREE.Material {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as THREE.Material).isMaterial === true
  );
}

function collectMaterialTextures(
  material: THREE.Material,
  textures: Set<THREE.Texture>,
): void {
  const visited = new Set<object>();
  for (const value of Object.values(material)) {
    collectTextures(value, textures, visited, 0);
  }
}

function collectTextures(
  value: unknown,
  textures: Set<THREE.Texture>,
  visited: Set<object>,
  depth: number,
): void {
  if (isTexture(value)) {
    textures.add(value);
    return;
  }
  if (depth >= 4 || typeof value !== "object" || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const child of value) collectTextures(child, textures, visited, depth + 1);
    return;
  }
  for (const child of Object.values(value)) {
    collectTextures(child, textures, visited, depth + 1);
  }
}

function isTexture(value: unknown): value is THREE.Texture {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as THREE.Texture).isTexture === true
  );
}

function closeTextureImages(texture: THREE.Texture, closedImages: Set<object>): void {
  closeImageValue(texture.image, closedImages);
  closeImageValue(texture.source.data, closedImages);
}

function closeImageValue(value: unknown, closedImages: Set<object>): void {
  if (Array.isArray(value)) {
    for (const image of value) closeImageValue(image, closedImages);
    return;
  }
  if (typeof value !== "object" || value === null || closedImages.has(value)) {
    return;
  }
  closedImages.add(value);
  const close = (value as { close?: unknown }).close;
  if (typeof close === "function") close.call(value);
}
