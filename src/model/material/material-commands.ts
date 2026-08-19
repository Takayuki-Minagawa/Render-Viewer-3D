import type { SceneModel } from "../scene-model";
import type {
  MaterialDefinitionModel,
  MaterialPresetId,
  PhysicalMaterialPreviewModel,
} from "./material-model";
import {
  createMaterialDefinition,
  createPovMaterialFromPreview,
  getMaterialPreset,
} from "./material-presets";

export interface AddMaterialOptions {
  id?: string;
  name?: string;
  presetId?: MaterialPresetId;
}

export type DeleteMaterialResult = "deleted" | "in-use" | "not-found";
export type PhysicalMaterialPreviewProperty = keyof PhysicalMaterialPreviewModel;

const NAME_MAX_LENGTH = 80;
const MATERIAL_ID_MAX_LENGTH = 80;
const UNIT_MIN = 0;
const UNIT_MAX = 1;

export function addMaterial(
  draft: SceneModel,
  options: AddMaterialOptions = {},
): MaterialDefinitionModel {
  const id = createUniqueMaterialId(draft, options.id);
  const preferredName =
    normalizeName(options.name ?? "") ??
    (options.presetId
      ? getMaterialPreset(options.presetId).label.en
      : "Material");
  const material = createMaterialDefinition(
    id,
    createUniqueMaterialName(draft, preferredName),
    options.presetId,
  );
  draft.materials.push(material);
  return material;
}

export function duplicateMaterial(
  draft: SceneModel,
  materialId: string,
): MaterialDefinitionModel | undefined {
  const source = findMaterial(draft, materialId);
  if (!source) return undefined;

  const duplicate = structuredClone(source);
  duplicate.id = createUniqueMaterialId(draft, `${source.id}-copy`);
  duplicate.name = createUniqueCopyName(draft, source.name);
  draft.materials.push(duplicate);
  return duplicate;
}

export function renameMaterial(
  draft: SceneModel,
  materialId: string,
  name: string,
): boolean {
  const material = findMaterial(draft, materialId);
  const normalized = normalizeName(name);
  if (!material || !normalized) return false;

  material.name = normalized;
  return true;
}

export function deleteMaterial(
  draft: SceneModel,
  materialId: string,
): DeleteMaterialResult {
  const index = draft.materials.findIndex(
    (material) => material.id === materialId,
  );
  if (index < 0) return "not-found";
  if (getMaterialUsageCount(draft, materialId) > 0) return "in-use";

  draft.materials.splice(index, 1);
  return "deleted";
}

export function assignMaterial(
  draft: SceneModel,
  objectId: string,
  materialId: string,
): boolean {
  const object = draft.objects.find((candidate) => candidate.id === objectId);
  if (!object || !findMaterial(draft, materialId)) return false;

  object.materialId = materialId;
  return true;
}

export function makeMaterialUnique(
  draft: SceneModel,
  objectId: string,
): MaterialDefinitionModel | undefined {
  const object = draft.objects.find((candidate) => candidate.id === objectId);
  if (!object) return undefined;

  const material = findMaterial(draft, object.materialId);
  if (!material) return undefined;
  if (getMaterialUsageCount(draft, material.id) <= 1) return material;

  const duplicate = duplicateMaterial(draft, material.id);
  if (!duplicate) return undefined;
  object.materialId = duplicate.id;
  return duplicate;
}

export function applyMaterialPreset(
  draft: SceneModel,
  materialId: string,
  presetId: MaterialPresetId,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material) return false;

  const preset = getMaterialPreset(presetId);
  const materialPreview = structuredClone(
    preset.preview,
  ) as PhysicalMaterialPreviewModel;
  material.category = preset.category;
  material.tags = [...preset.tags];
  material.presetId = preset.id;
  material.preview = materialPreview;
  material.pov = createPovMaterialFromPreview(materialPreview);
  return true;
}

export function updateMaterialPreview(
  draft: SceneModel,
  materialId: string,
  update: Partial<PhysicalMaterialPreviewModel>,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material) return false;

  let changed = false;
  for (const [property, value] of Object.entries(update)) {
    if (
      setNormalizedPreviewProperty(
        material.preview,
        property as PhysicalMaterialPreviewProperty,
        value,
      )
    ) {
      changed = true;
    }
  }
  if (changed) material.presetId = null;
  return true;
}

export function updateMaterialPreviewProperty(
  draft: SceneModel,
  materialId: string,
  property: PhysicalMaterialPreviewProperty,
  value: unknown,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material) return false;

  const changed = setNormalizedPreviewProperty(
    material.preview,
    property,
    value,
  );
  if (changed) material.presetId = null;
  return true;
}

export function updateMaterialPovScalar(
  draft: SceneModel,
  materialId: string,
  path: string,
  value: number,
): boolean {
  const material = findMaterial(draft, materialId);
  if (!material || !Number.isFinite(value) || !path.startsWith("pov.")) {
    return false;
  }

  const segments = path.slice("pov.".length).split(".");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    return false;
  }

  const target = resolveOwnPathTarget(material.pov, segments);
  if (!target || typeof target.value !== "number") return false;

  const normalized = clamp(value, -1_000_000_000, 1_000_000_000);
  if (Array.isArray(target.container)) {
    target.container[target.key as number] = normalized;
  } else {
    target.container[target.key as string] = normalized;
  }
  material.presetId = null;
  return true;
}

export function getMaterialUsageCount(
  scene: Pick<SceneModel, "objects" | "imports">,
  materialId: string,
): number {
  const objectUsage = scene.objects.reduce(
    (count, object) => count + Number(object.materialId === materialId),
    0,
  );
  return scene.imports.reduce(
    (count, imported) =>
      count + Number(imported.customMaterialId === materialId),
    objectUsage,
  );
}

export function getMaterialUsageCounts(
  scene: Pick<SceneModel, "materials" | "objects" | "imports">,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>(
    scene.materials.map((material) => [material.id, 0] as const),
  );
  for (const object of scene.objects) {
    counts.set(object.materialId, (counts.get(object.materialId) ?? 0) + 1);
  }
  for (const imported of scene.imports) {
    const materialId = imported.customMaterialId;
    if (!materialId) continue;
    counts.set(materialId, (counts.get(materialId) ?? 0) + 1);
  }
  return counts;
}

export function findMaterial(
  scene: Pick<SceneModel, "materials">,
  materialId: string,
): MaterialDefinitionModel | undefined {
  return scene.materials.find((material) => material.id === materialId);
}

export function createUniqueMaterialId(
  scene: Pick<SceneModel, "materials">,
  preferredId?: string,
): string {
  const existing = new Set(scene.materials.map((material) => material.id));
  const preferred = normalizeId(preferredId ?? "");
  if (preferred && !existing.has(preferred)) return preferred;

  const base = preferred ?? "material";
  for (let ordinal = 1; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const suffix = `-${String(ordinal).padStart(2, "0")}`;
    const candidate = `${base.slice(0, MATERIAL_ID_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique material id.");
}

interface OwnPathTarget {
  container: Record<string, unknown> | unknown[];
  key: string | number;
  value: unknown;
}

function resolveOwnPathTarget(
  root: object,
  segments: string[],
): OwnPathTarget | undefined {
  let current: unknown = root;

  for (let index = 0; index < segments.length; index += 1) {
    if (current === null || typeof current !== "object") return undefined;

    const segment = segments[index];
    const key = Array.isArray(current)
      ? parseArrayIndex(segment, current.length)
      : segment;
    if (key === undefined || !Object.hasOwn(current, key)) return undefined;

    const container = current as Record<string, unknown> | unknown[];
    const value = container[key as never];
    if (index === segments.length - 1) return { container, key, value };
    current = value;
  }

  return undefined;
}

function parseArrayIndex(
  segment: string,
  length: number,
): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(segment)) return undefined;
  const index = Number(segment);
  return Number.isSafeInteger(index) && index < length ? index : undefined;
}

function setNormalizedPreviewProperty(
  preview: PhysicalMaterialPreviewModel,
  property: PhysicalMaterialPreviewProperty,
  value: unknown,
): boolean {
  switch (property) {
    case "baseColor":
    case "emissiveColor":
    case "attenuationColor":
    case "specularColor":
    case "sheenColor": {
      const normalized = normalizeColor(value, preview[property]);
      if (normalized === preview[property]) return false;
      preview[property] = normalized;
      return true;
    }
    case "transparent":
    case "doubleSided":
    case "wireframe": {
      if (typeof value !== "boolean" || value === preview[property]) {
        return false;
      }
      preview[property] = value;
      return true;
    }
    case "diffuse":
    case "metalness":
    case "roughness":
    case "opacity":
    case "reflection":
    case "transmission":
    case "clearcoat":
    case "clearcoatRoughness":
    case "specularIntensity":
    case "sheen":
    case "sheenRoughness":
    case "iridescence":
    case "anisotropy":
      return setNumber(preview, property, value, UNIT_MIN, UNIT_MAX);
    case "emissiveIntensity":
      return setNumber(preview, property, value, 0, 100);
    case "ior":
      return setNumber(preview, property, value, 1, 10);
    case "iridescenceIOR":
      return setNumber(preview, property, value, 1, 2.333);
    case "thickness":
      return setNumber(preview, property, value, 0, 10_000);
    case "anisotropyRotationDegrees":
      return setNumber(preview, property, value, -360_000, 360_000);
    case "dispersion":
      return setNumber(preview, property, value, 0, 10);
    case "attenuationDistance": {
      if (value === null) {
        if (preview.attenuationDistance === null) return false;
        preview.attenuationDistance = null;
        return true;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      const normalized = clamp(value, 0.000_001, 1_000_000_000);
      if (preview.attenuationDistance === normalized) return false;
      preview.attenuationDistance = normalized;
      return true;
    }
    case "iridescenceThicknessRange": {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
      ) {
        return false;
      }
      const minimum = clamp(value[0], 0, 10_000);
      const maximum = clamp(value[1], 0, 10_000);
      const normalized: [number, number] =
        minimum <= maximum ? [minimum, maximum] : [maximum, minimum];
      if (
        preview.iridescenceThicknessRange[0] === normalized[0] &&
        preview.iridescenceThicknessRange[1] === normalized[1]
      ) {
        return false;
      }
      preview.iridescenceThicknessRange = normalized;
      return true;
    }
  }
}

type NumericPreviewProperty = {
  [Key in keyof PhysicalMaterialPreviewModel]:
    PhysicalMaterialPreviewModel[Key] extends number ? Key : never;
}[keyof PhysicalMaterialPreviewModel];

function setNumber(
  preview: PhysicalMaterialPreviewModel,
  property: NumericPreviewProperty,
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const normalized = clamp(value, minimum, maximum);
  if (preview[property] === normalized) return false;
  preview[property] = normalized;
  return true;
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const short = /^#([\da-f]{3})$/i.exec(trimmed);
  if (short) {
    return `#${[...short[1]].map((digit) => digit.repeat(2)).join("")}`.toLowerCase();
  }
  return /^#[\da-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

function createUniqueMaterialName(
  scene: Pick<SceneModel, "materials">,
  preferredName: string,
): string {
  const existing = new Set(scene.materials.map((material) => material.name));
  const base = normalizeName(preferredName) ?? "Material";
  if (!existing.has(base)) return base;

  for (let ordinal = 2; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const suffix = ` ${ordinal}`;
    const candidate = `${base.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique material name.");
}

function createUniqueCopyName(
  scene: Pick<SceneModel, "materials">,
  sourceName: string,
): string {
  const existing = new Set(scene.materials.map((material) => material.name));
  const base = normalizeName(sourceName) ?? "Material";

  for (let ordinal = 1; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const suffix = ordinal === 1 ? " Copy" : ` Copy ${ordinal}`;
    const candidate = `${base.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique material name.");
}

function normalizeName(name: string): string | undefined {
  const normalized = name.trim().slice(0, NAME_MAX_LENGTH);
  return normalized || undefined;
}

function normalizeId(id: string): string | undefined {
  const normalized = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MATERIAL_ID_MAX_LENGTH);
  return normalized || undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
