import * as THREE from "three";
import type { MaterialPbrMapChannel, MaterialPbrMaps } from "../../model/material/material-model";
import type { DeepReadonly } from "../../model/scene-model";
import { materialColorMapSignature } from "../../model/material/material-color-map";
import { MaterialImageAssetStore } from "./image-asset-store";
import { applyTextureMapping } from "./texture-mapping";

export const PBR_MAP_PROPERTIES = { normal: "normalMap", roughness: "roughnessMap", metalness: "metalnessMap", ao: "aoMap" } as const;
interface TextureEntry { texture: THREE.Texture; assetId: string; signature: string; }
export class PbrMapRuntime {
  readonly #entries = new Map<THREE.MeshPhysicalMaterial, Map<MaterialPbrMapChannel, TextureEntry>>();
  constructor(private readonly images?: MaterialImageAssetStore) {}
  has(material: THREE.MeshPhysicalMaterial): boolean { return (this.#entries.get(material)?.size ?? 0) > 0; }
  reconcile(material: THREE.MeshPhysicalMaterial, maps: DeepReadonly<MaterialPbrMaps> | undefined, origin: "bottom-left" | "top-left"): void {
    let entries = this.#entries.get(material);
    if (!entries) { entries = new Map(); this.#entries.set(material, entries); }
    for (const channel of Object.keys(PBR_MAP_PROPERTIES) as MaterialPbrMapChannel[]) {
      const descriptor = maps?.[channel];
      const property = PBR_MAP_PROPERTIES[channel];
      let entry = entries.get(channel);
      if (entry && entry.assetId !== descriptor?.assetId) {
        material[property] = null;
        entry.texture.dispose(); this.images?.release(entry.assetId);
        entries.delete(channel); entry = undefined; material.needsUpdate = true;
      }
      if (!descriptor) continue;
      const signature = materialColorMapSignature(descriptor);
      if (entry) {
        if (entry.signature !== signature) { applyTextureMapping(entry.texture, descriptor, origin); entry.signature = signature; }
        continue;
      }
      const lease = this.images?.acquire(descriptor.assetId);
      if (!lease) continue;
      const texture = new THREE.Texture();
      try {
        texture.source = lease.source; texture.name = descriptor.sourceName;
        texture.userData.materialTextureAssetId = descriptor.assetId;
        texture.userData.materialTextureUvOrigin = origin;
        texture.colorSpace = THREE.NoColorSpace;
        texture.flipY = false;
        applyTextureMapping(texture, descriptor, origin, false);
        texture.needsUpdate = true;
        material[property] = texture; material.needsUpdate = true;
        entries.set(channel, { texture, assetId: descriptor.assetId, signature });
      } catch (error) { texture.dispose(); this.images?.release(descriptor.assetId); throw error; }
    }
  }
  disposeMaterial(material: THREE.MeshPhysicalMaterial): void {
    for (const [channel, entry] of this.#entries.get(material) ?? []) {
      material[PBR_MAP_PROPERTIES[channel]] = null;
      entry.texture.dispose(); this.images?.release(entry.assetId);
    }
    this.#entries.delete(material);
  }
}
