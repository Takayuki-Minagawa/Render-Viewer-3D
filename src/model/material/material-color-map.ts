import type { SceneModel } from "../scene-model";
import { findMaterial } from "./material-commands";
import type {
  MaterialColorMapField,
  MaterialColorMapModel,
  MaterialTextureWrapMode,
} from "./material-model";

export const MATERIAL_TEXTURE_FILE_ACCEPT =
  ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
export const MATERIAL_TEXTURE_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MATERIAL_TEXTURE_MAX_DIMENSION = 4096;
export const MATERIAL_TEXTURE_MAX_PIXELS = 16_777_216;

const ASSET_ID_MAX_LENGTH = 120;
const SOURCE_NAME_MAX_LENGTH = 200;
const REPEAT_MIN = 0.01;
const REPEAT_MAX = 1_000;
const OFFSET_LIMIT = 1_000;
const ROTATION_LIMIT = 360_000;
const MIME_TYPES = new Set<MaterialColorMapModel["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const WRAP_MODES = new Set<MaterialTextureWrapMode>([
  "repeat",
  "clamp-to-edge",
  "mirrored-repeat",
]);

export interface CreateMaterialColorMapInput {
  readonly assetId: string;
  readonly sourceName: string;
  readonly mimeType: MaterialColorMapModel["mimeType"];
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export function createMaterialColorMap(
  input: CreateMaterialColorMapInput,
): MaterialColorMapModel | undefined {
  return normalizeMaterialColorMap({
    ...input,
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    rotationDegrees: 0,
    wrapMode: "repeat",
  });
}

export function attachMaterialColorMap(
  draft: SceneModel,
  materialId: string,
  colorMap: MaterialColorMapModel,
): boolean {
  const material = findMaterial(draft, materialId);
  const normalized = normalizeMaterialColorMap(colorMap);
  if (!material || !normalized) return false;

  material.colorMap = normalized;
  material.presetId = null;
  return true;
}

export function updateMaterialColorMap(
  draft: SceneModel,
  materialId: string,
  field: MaterialColorMapField,
  value: unknown,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material?.colorMap) return false;
  const next = updateMaterialColorMapValue(material.colorMap, field, value);
  if (!next) return false;

  material.colorMap = next;
  material.presetId = null;
  return true;
}

export function removeMaterialColorMap(
  draft: SceneModel,
  materialId: string,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material?.colorMap) return false;

  material.colorMap = null;
  material.presetId = null;
  return true;
}

export function updateMaterialColorMapValue(
  colorMap: MaterialColorMapModel,
  field: MaterialColorMapField,
  value: unknown,
): MaterialColorMapModel | undefined {
  const next = copyMaterialColorMap(colorMap);
  switch (field) {
    case "repeatX":
    case "repeatY":
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      next[field] = clamp(value, REPEAT_MIN, REPEAT_MAX);
      break;
    case "offsetX":
    case "offsetY":
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      next[field] = clamp(value, -OFFSET_LIMIT, OFFSET_LIMIT);
      break;
    case "rotationDegrees":
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      next.rotationDegrees = clamp(value, -ROTATION_LIMIT, ROTATION_LIMIT);
      break;
    case "wrapMode":
      if (
        typeof value !== "string" ||
        !WRAP_MODES.has(value as MaterialTextureWrapMode)
      ) {
        return undefined;
      }
      next.wrapMode = value as MaterialTextureWrapMode;
      break;
    default:
      return undefined;
  }
  return next;
}

export function normalizeMaterialColorMap(
  colorMap: MaterialColorMapModel,
): MaterialColorMapModel | undefined {
  const assetId = normalizeText(colorMap.assetId, ASSET_ID_MAX_LENGTH);
  const sourceName = normalizeText(colorMap.sourceName, SOURCE_NAME_MAX_LENGTH);
  if (
    !assetId ||
    !sourceName ||
    !MIME_TYPES.has(colorMap.mimeType) ||
    !Number.isSafeInteger(colorMap.byteSize) ||
    colorMap.byteSize <= 0 ||
    colorMap.byteSize > MATERIAL_TEXTURE_MAX_FILE_BYTES ||
    !isDimension(colorMap.width) ||
    !isDimension(colorMap.height) ||
    colorMap.width * colorMap.height > MATERIAL_TEXTURE_MAX_PIXELS ||
    !WRAP_MODES.has(colorMap.wrapMode)
  ) {
    return undefined;
  }

  let normalized = copyMaterialColorMap(colorMap);
  normalized.assetId = assetId;
  normalized.sourceName = sourceName;
  for (const field of [
    "repeatX",
    "repeatY",
    "offsetX",
    "offsetY",
    "rotationDegrees",
    "wrapMode",
  ] as const) {
    const next = updateMaterialColorMapValue(
      normalized,
      field,
      normalized[field],
    );
    if (!next) return undefined;
    normalized = next;
  }
  return normalized;
}

export function materialColorMapSignature(
  colorMap: MaterialColorMapModel,
): string {
  return JSON.stringify([
    colorMap.assetId,
    colorMap.repeatX,
    colorMap.repeatY,
    colorMap.offsetX,
    colorMap.offsetY,
    colorMap.rotationDegrees,
    colorMap.wrapMode,
  ]);
}

function copyMaterialColorMap(
  colorMap: MaterialColorMapModel,
): MaterialColorMapModel {
  return {
    assetId: colorMap.assetId,
    sourceName: colorMap.sourceName,
    mimeType: colorMap.mimeType,
    byteSize: colorMap.byteSize,
    width: colorMap.width,
    height: colorMap.height,
    repeatX: colorMap.repeatX,
    repeatY: colorMap.repeatY,
    offsetX: colorMap.offsetX,
    offsetY: colorMap.offsetY,
    rotationDegrees: colorMap.rotationDegrees,
    wrapMode: colorMap.wrapMode,
  };
}

function normalizeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maximumLength);
  return normalized || null;
}

function isDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MATERIAL_TEXTURE_MAX_DIMENSION
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
