import type { MaterialColorMapField, MaterialColorMapModel, MaterialPbrMapChannel } from "../model/material/material-model";
import { MATERIAL_PBR_CHANNELS, setMaterialPbrMap, updateMaterialPbrMap } from "../model/material/material-pbr-map";
import type { MaterialImageAssetStore } from "../three/material/image-asset-store";
import type { SceneStore } from "./scene-store";

export class MaterialPbrMapController {
  readonly #generations = new Map<string, number>();
  #disposed = false;
  constructor(private readonly scene: SceneStore, private readonly assets: MaterialImageAssetStore) {}
  async attach(materialId: string, channel: MaterialPbrMapChannel, file: File): Promise<void> {
    this.#assertActive();
    if (!MATERIAL_PBR_CHANNELS.includes(channel)) throw new Error("Unsupported PBR image channel.");
    if (!this.#material(materialId)) throw new Error("The target material no longer exists.");
    const key = `${materialId}:${channel}`;
    const generation = this.#next(key);
    const descriptor = await this.assets.importFile(file, true);
    if (this.#disposed || this.#generations.get(key) !== generation || !this.#material(materialId)) {
      this.assets.delete(descriptor.assetId);
      return;
    }
    const previous = this.#material(materialId)?.maps?.[channel];
    const next: MaterialColorMapModel = previous ? { ...descriptor, repeatX: previous.repeatX, repeatY: previous.repeatY, offsetX: previous.offsetX, offsetY: previous.offsetY, rotationDegrees: previous.rotationDegrees, wrapMode: previous.wrapMode } : descriptor;
    try {
      this.scene.update((draft) => { if (!setMaterialPbrMap(draft, materialId, channel, next)) throw new Error("The PBR image could not be attached."); });
    } catch (error) { this.#deleteUnreferenced(descriptor.assetId); throw error; }
    if (previous) this.#deleteUnreferenced(previous.assetId);
  }
  update(materialId: string, channel: MaterialPbrMapChannel, field: MaterialColorMapField, value: unknown): void {
    this.#assertActive();
    this.scene.update((draft) => { updateMaterialPbrMap(draft, materialId, channel, field, value); });
  }
  remove(materialId: string, channel: MaterialPbrMapChannel): void {
    this.#assertActive(); this.#next(`${materialId}:${channel}`);
    const previous = this.#material(materialId)?.maps?.[channel];
    this.scene.update((draft) => { setMaterialPbrMap(draft, materialId, channel, null); });
    if (previous) this.#deleteUnreferenced(previous.assetId);
  }
  cancelPending(): void { for (const key of this.#generations.keys()) this.#next(key); }
  dispose(): void { this.#disposed = true; this.cancelPending(); }
  #next(key: string): number { const next = (this.#generations.get(key) ?? 0) + 1; this.#generations.set(key, next); return next; }
  #material(id: string) { return this.scene.getSnapshot().materials.find((material) => material.id === id); }
  #deleteUnreferenced(assetId: string): void {
    if (!this.scene.getSnapshot().materials.some((material) => material.colorMap?.assetId === assetId || Object.values(material.maps ?? {}).some((map) => map?.assetId === assetId))) this.assets.delete(assetId);
  }
  #assertActive(): void { if (this.#disposed) throw new Error("The PBR image controller was disposed."); }
}
