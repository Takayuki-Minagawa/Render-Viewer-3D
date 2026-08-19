import * as THREE from "three";
import type {
  MaterialDefinitionModel,
  PhysicalMaterialPreviewModel,
} from "../model/material/material-model";
import {
  createDefaultPhysicalMaterialPreview,
  createMaterialDefinitionFromPreview,
} from "../model/material/material-presets";

const NAME_MAX_LENGTH = 80;
const ID_MAX_LENGTH = 80;
const ATTENUATION_DISTANCE_MINIMUM = 0.000_001;
const ATTENUATION_DISTANCE_MAXIMUM = 1_000_000_000;

/**
 * Converts the scalar/color part of a Three.js material into the application's
 * common physical preview model without mutating the source material.
 *
 * Texture slots are deliberately not projected: imported textures remain owned
 * by, and rendered through, the original runtime material. A custom application
 * material is therefore a scalar approximation of the imported material.
 */
export function adaptImportedMaterialToPreview(
  material: THREE.Material,
): PhysicalMaterialPreviewModel {
  const values: Partial<PhysicalMaterialPreviewModel> = {};
  const source = asPropertyBag(material);

  assignFinite(values, "opacity", source.opacity, 0, 1);
  assignBoolean(values, "transparent", source.transparent);
  values.doubleSided = material.side === THREE.DoubleSide;
  assignBoolean(values, "wireframe", source.wireframe);
  assignColor(values, "baseColor", source.color);
  assignColor(values, "emissiveColor", source.emissive);
  assignFinite(values, "emissiveIntensity", source.emissiveIntensity, 0, 100);

  if (isMeshStandardMaterial(material)) {
    // MeshStandardMaterial has an unscaled diffuse lobe.
    values.diffuse = 1;
    assignFinite(values, "roughness", source.roughness, 0, 1);
    assignFinite(values, "metalness", source.metalness, 0, 1);
    assignFinite(values, "reflection", source.envMapIntensity, 0, 1);
  } else if (hasColor(source)) {
    applyFallbackPbrApproximation(material, source, values);
  }

  if (isMeshPhysicalMaterial(material)) {
    assignFinite(values, "transmission", source.transmission, 0, 1);
    assignFinite(values, "ior", source.ior, 1, 10);
    assignFinite(values, "thickness", source.thickness, 0, 10_000);
    assignColor(values, "attenuationColor", source.attenuationColor);
    assignAttenuationDistance(values, source.attenuationDistance);
    assignFinite(values, "clearcoat", source.clearcoat, 0, 1);
    assignFinite(
      values,
      "clearcoatRoughness",
      source.clearcoatRoughness,
      0,
      1,
    );
    assignFinite(values, "specularIntensity", source.specularIntensity, 0, 1);
    assignColor(values, "specularColor", source.specularColor);
    assignFinite(values, "sheen", source.sheen, 0, 1);
    assignFinite(values, "sheenRoughness", source.sheenRoughness, 0, 1);
    assignColor(values, "sheenColor", source.sheenColor);
    assignFinite(values, "iridescence", source.iridescence, 0, 1);
    assignFinite(values, "iridescenceIOR", source.iridescenceIOR, 1, 2.333);
    assignThicknessRange(values, source.iridescenceThicknessRange);
    assignFinite(values, "anisotropy", source.anisotropy, 0, 1);
    assignAnisotropyRotation(values, source.anisotropyRotation);
    assignFinite(values, "dispersion", source.dispersion, 0, 10);
  }

  return createDefaultPhysicalMaterialPreview(values);
}

export function createImportedMaterialDefinition(
  material: THREE.Material,
  id: string,
  name: string,
): MaterialDefinitionModel {
  return createMaterialDefinitionFromPreview(
    id,
    name,
    adaptImportedMaterialToPreview(material),
  );
}

/**
 * Traverses in Three.js' stable pre-order, expands material arrays in their
 * original order, and includes each material identity exactly once.
 */
export function collectImportedMaterialDefinitions(
  root: THREE.Object3D,
  prefix: string,
): MaterialDefinitionModel[] {
  const materials = collectUniqueMaterials(root);
  const idPrefix = sanitizeIdPrefix(prefix);
  const namePrefix = sanitizeNamePart(prefix) ?? "Imported";
  const names = new Set<string>();

  return materials.map((material, index) => {
    const ordinal = index + 1;
    const materialName = sanitizeNamePart(material.name) ?? `Material ${ordinal}`;
    const name = allocateUniqueName(`${namePrefix} / ${materialName}`, names);
    const id = createIndexedId(idPrefix, ordinal);
    return createImportedMaterialDefinition(material, id, name);
  });
}

function collectUniqueMaterials(root: THREE.Object3D): THREE.Material[] {
  const result: THREE.Material[] = [];
  const seen = new Set<THREE.Material>();

  root.traverse((object) => {
    const value = asPropertyBag(object).material;
    const materials = Array.isArray(value) ? value : [value];
    for (const candidate of materials) {
      if (!isMaterial(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
  });

  return result;
}

function applyFallbackPbrApproximation(
  material: THREE.Material,
  source: Record<string, unknown>,
  values: Partial<PhysicalMaterialPreviewModel>,
): void {
  values.diffuse = 1;
  values.metalness = 0;

  if (isMeshPhongMaterial(material)) {
    const shininess = finiteNumber(source.shininess);
    if (shininess !== undefined) {
      values.roughness = clamp(Math.sqrt(2 / (Math.max(0, shininess) + 2)), 0, 1);
    }
    if (assignColor(values, "specularColor", source.specular)) {
      values.specularIntensity = 1;
    }
    return;
  }

  // Unlit/Lambert-like sources have no directly representable BRDF controls.
  values.roughness = 1;
  values.specularIntensity = 0;
}

function assignAttenuationDistance(
  values: Partial<PhysicalMaterialPreviewModel>,
  value: unknown,
): void {
  const distance = finiteNumber(value);
  if (distance === undefined) return;
  values.attenuationDistance = clamp(
    distance,
    ATTENUATION_DISTANCE_MINIMUM,
    ATTENUATION_DISTANCE_MAXIMUM,
  );
}

function assignThicknessRange(
  values: Partial<PhysicalMaterialPreviewModel>,
  value: unknown,
): void {
  if (!Array.isArray(value) || value.length !== 2) return;
  const first = finiteNumber(value[0]);
  const second = finiteNumber(value[1]);
  if (first === undefined || second === undefined) return;
  const minimum = clamp(Math.min(first, second), 0, 10_000);
  const maximum = clamp(Math.max(first, second), 0, 10_000);
  values.iridescenceThicknessRange = [minimum, maximum];
}

function assignAnisotropyRotation(
  values: Partial<PhysicalMaterialPreviewModel>,
  value: unknown,
): void {
  const radians = finiteNumber(value);
  if (radians === undefined) return;
  values.anisotropyRotationDegrees = clamp(
    THREE.MathUtils.radToDeg(radians),
    -360_000,
    360_000,
  );
}

function assignFinite<Key extends keyof PhysicalMaterialPreviewModel>(
  values: Partial<PhysicalMaterialPreviewModel>,
  key: Key,
  value: unknown,
  minimum: number,
  maximum: number,
): void {
  const scalar = finiteNumber(value);
  if (scalar === undefined) return;
  values[key] = clamp(scalar, minimum, maximum) as PhysicalMaterialPreviewModel[Key];
}

function assignBoolean<Key extends keyof PhysicalMaterialPreviewModel>(
  values: Partial<PhysicalMaterialPreviewModel>,
  key: Key,
  value: unknown,
): void {
  if (typeof value !== "boolean") return;
  values[key] = value as PhysicalMaterialPreviewModel[Key];
}

function assignColor<Key extends keyof PhysicalMaterialPreviewModel>(
  values: Partial<PhysicalMaterialPreviewModel>,
  key: Key,
  value: unknown,
): boolean {
  const color = colorToSrgbHex(value);
  if (!color) return false;
  values[key] = color as PhysicalMaterialPreviewModel[Key];
  return true;
}

function colorToSrgbHex(value: unknown): string | undefined {
  if (!isColor(value)) return undefined;
  const channels = [value.r, value.g, value.b];
  if (!channels.every(Number.isFinite)) return undefined;

  // Three.js stores Color channels in its Linear-sRGB working space. Hex color
  // strings in the application are display/sRGB values, so convert explicitly.
  const color = new THREE.Color(
    clamp(value.r, 0, 1),
    clamp(value.g, 0, 1),
    clamp(value.b, 0, 1),
  );
  return `#${color.getHexString(THREE.SRGBColorSpace)}`;
}

function allocateUniqueName(base: string, existing: Set<string>): string {
  const normalizedBase = base.slice(0, NAME_MAX_LENGTH);
  if (!existing.has(normalizedBase)) {
    existing.add(normalizedBase);
    return normalizedBase;
  }

  for (let ordinal = 2; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const suffix = ` ${ordinal}`;
    const candidate = `${normalizedBase.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (existing.has(candidate)) continue;
    existing.add(candidate);
    return candidate;
  }
  throw new Error("Unable to allocate a unique imported material name.");
}

function sanitizeIdPrefix(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ID_MAX_LENGTH)
    .replace(/-+$/g, "");
  return normalized || "imported";
}

function createIndexedId(prefix: string, ordinal: number): string {
  const suffix = `-material-${ordinal}`;
  return `${prefix.slice(0, ID_MAX_LENGTH - suffix.length)}${suffix}`;
}

function sanitizeNamePart(value: string): string | undefined {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasColor(value: Record<string, unknown>): boolean {
  return isColor(value.color);
}

function isColor(value: unknown): value is THREE.Color {
  return (
    typeof value === "object" &&
    value !== null &&
    asPropertyBag(value).isColor === true
  );
}

function isMaterial(value: unknown): value is THREE.Material {
  return (
    typeof value === "object" &&
    value !== null &&
    asPropertyBag(value).isMaterial === true
  );
}

function isMeshStandardMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial {
  return asPropertyBag(material).isMeshStandardMaterial === true;
}

function isMeshPhysicalMaterial(
  material: THREE.Material,
): material is THREE.MeshPhysicalMaterial {
  return asPropertyBag(material).isMeshPhysicalMaterial === true;
}

function isMeshPhongMaterial(
  material: THREE.Material,
): material is THREE.MeshPhongMaterial {
  return asPropertyBag(material).isMeshPhongMaterial === true;
}

function asPropertyBag(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}
