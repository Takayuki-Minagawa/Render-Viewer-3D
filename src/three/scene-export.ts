import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";

/** Snapshot hierarchy/transforms and resources so edits/deletion during export are safe. */
export function createExportSnapshot(roots: readonly THREE.Object3D[]): { scene: THREE.Scene; clips: THREE.AnimationClip[]; dispose: () => void } {
  const scene = new THREE.Scene();
  const clips: THREE.AnimationClip[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const original of roots) {
    const copy = clone(original);
    const originals: THREE.Object3D[] = []; const copies: THREE.Object3D[] = [];
    original.traverse((node) => originals.push(node)); copy.traverse((node) => copies.push(node));
    originals.forEach((node, index) => {
      const target = copies[index]!;
      target.uuid = node.uuid;
      const mesh = target as THREE.Mesh;
      if (mesh.geometry) { mesh.geometry = mesh.geometry.clone(); geometries.add(mesh.geometry); }
      if (mesh.material) {
        const duplicateMaterial = (material: THREE.Material) => {
          const duplicate = material.clone(); materials.add(duplicate);
          for (const [key, value] of Object.entries(duplicate)) {
            if (value instanceof THREE.Texture) {
              const texture = value.clone(); textures.add(texture);
              // Texture.clone shares Source, so detach it before copying mutable/closeable images.
              texture.source = new THREE.Source(value instanceof THREE.CompressedTexture ? value.image : snapshotImage(value.image));
              (duplicate as unknown as Record<string, unknown>)[key] = texture;
            }
          }
          return duplicate;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(duplicateMaterial) : duplicateMaterial(mesh.material);
      }
      for (const sourceClip of node.animations) {
        const clip = sourceClip.clone();
        for (const track of clip.tracks) {
          const binding = THREE.PropertyBinding.parseTrackName(track.name);
          const bound = THREE.PropertyBinding.findNode(node, binding.nodeName) as THREE.Object3D | null;
          if (bound) track.name = `${bound.uuid}${binding.objectName ? `.${binding.objectName}${binding.objectIndex !== undefined ? `[${binding.objectIndex}]` : ""}` : ""}.${binding.propertyName}${binding.propertyIndex !== undefined ? `[${binding.propertyIndex}]` : ""}`;
        }
        clips.push(clip);
      }
    });
    scene.add(copy);
  }
  return { scene, clips, dispose() {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    scene.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose(); });
  } };
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function snapshotImage(image: unknown): unknown {
  if (!image || typeof image !== "object") return image;
  if (Array.isArray(image)) return image.map(snapshotImage);
  const record = image as { width?: number; height?: number; data?: unknown };
  if (ArrayBuffer.isView(record.data)) {
    const data = record.data as Uint8Array;
    return { ...record, data: data.slice() };
  }
  if (typeof document !== "undefined" && record.width && record.height) {
    const canvas = document.createElement("canvas"); canvas.width = record.width; canvas.height = record.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to snapshot texture for GLB export");
    context.drawImage(image as CanvasImageSource, 0, 0);
    return canvas;
  }
  return image;
}
