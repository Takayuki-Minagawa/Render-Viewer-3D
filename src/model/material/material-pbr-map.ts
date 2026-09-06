import type { SceneModel } from "../scene-model";
import type { MaterialColorMapField, MaterialColorMapModel, MaterialPbrMapChannel } from "./material-model";
import { normalizeMaterialColorMap, updateMaterialColorMapValue } from "./material-color-map";

export const MATERIAL_PBR_CHANNELS: readonly MaterialPbrMapChannel[] = ["normal", "roughness", "metalness", "ao"];
export function setMaterialPbrMap(draft: SceneModel, materialId: string, channel: MaterialPbrMapChannel, descriptor: MaterialColorMapModel | null): boolean {
  if (!MATERIAL_PBR_CHANNELS.includes(channel)) return false;
  const material = draft.materials.find(({ id }) => id === materialId);
  if (!material) return false;
  if (descriptor === null) {
    if (!material.maps?.[channel]) return false;
    delete material.maps[channel];
    if (Object.keys(material.maps).length === 0) delete material.maps;
  } else {
    const normalized = normalizeMaterialColorMap(descriptor);
    if (!normalized) return false;
    material.maps ??= {};
    material.maps[channel] = normalized;
  }
  material.presetId = null;
  return true;
}
export function updateMaterialPbrMap(draft: SceneModel, materialId: string, channel: MaterialPbrMapChannel, field: MaterialColorMapField, value: unknown): boolean {
  const descriptor = draft.materials.find(({ id }) => id === materialId)?.maps?.[channel];
  if (!descriptor) return false;
  const updated = updateMaterialColorMapValue(descriptor, field, value);
  return updated ? setMaterialPbrMap(draft, materialId, channel, updated) : false;
}
