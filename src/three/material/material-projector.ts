import * as THREE from "three";
import type { DeepReadonly } from "../../model/scene-model";
import type { MaterialDefinitionModel } from "../../model/material/material-model";
import {
  getMaterialCapability,
  type MaterialSupportLevel,
} from "./material-capabilities";

type MaterialDefinitionSnapshot = DeepReadonly<MaterialDefinitionModel>;

const THREE_IOR_MINIMUM = 1;
const THREE_IOR_MAXIMUM = 2.333;
const PREVIEW_DIFFUSE_UNIFORM = "uPreviewDiffuse";
const PREVIEW_DIFFUSE_PROGRAM_CACHE_KEY =
  "render-viewer-3d-preview-diffuse-v1";
const TRANSMISSION_FRAGMENT_ANCHOR = "#include <transmission_fragment>";
const PREVIEW_DIFFUSE_SCALE_STATEMENT = "totalDiffuse *= uPreviewDiffuse;";

interface ScalarUniform {
  value: number;
}

const previewDiffuseUniforms = new WeakMap<
  THREE.MeshPhysicalMaterial,
  ScalarUniform
>();

export interface MaterialProjectionDiagnostic {
  readonly path: string;
  readonly code: string;
  readonly support: MaterialSupportLevel;
}

export interface MeshPhysicalPreviewProjection {
  readonly baseColor: string;
  readonly diffuse: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly emissiveColor: string;
  readonly emissiveIntensity: number;
  readonly side: THREE.Side;
  readonly wireframe: boolean;
  readonly reflection: number;
  readonly transmission: number;
  readonly ior: number;
  readonly thickness: number;
  readonly attenuationColor: string;
  readonly attenuationDistance: number;
  readonly clearcoat: number;
  readonly clearcoatRoughness: number;
  readonly specularIntensity: number;
  readonly specularColor: string;
  readonly sheen: number;
  readonly sheenColor: string;
  readonly sheenRoughness: number;
  readonly iridescence: number;
  readonly iridescenceIOR: number;
  readonly iridescenceThicknessRange: readonly [number, number];
  readonly anisotropy: number;
  readonly anisotropyRotation: number;
  readonly dispersion: number;
}

export interface MaterialProjection {
  readonly preview: MeshPhysicalPreviewProjection;
  readonly valueSignature: string;
  readonly programSignature: string;
  readonly diagnostics: readonly MaterialProjectionDiagnostic[];
}

export function projectMaterial(
  definition: MaterialDefinitionSnapshot,
): MaterialProjection {
  const { preview } = definition;
  const projected: MeshPhysicalPreviewProjection = {
    baseColor: preview.baseColor,
    diffuse: preview.diffuse,
    metalness: preview.metalness,
    roughness: preview.roughness,
    opacity: preview.opacity,
    transparent: preview.transparent,
    emissiveColor: preview.emissiveColor,
    emissiveIntensity: preview.emissiveIntensity,
    side: preview.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    wireframe: preview.wireframe,
    reflection: preview.reflection,
    transmission: preview.transmission,
    ior: THREE.MathUtils.clamp(
      preview.ior,
      THREE_IOR_MINIMUM,
      THREE_IOR_MAXIMUM,
    ),
    thickness: preview.thickness,
    attenuationColor: preview.attenuationColor,
    attenuationDistance:
      preview.attenuationDistance ?? Number.POSITIVE_INFINITY,
    clearcoat: preview.clearcoat,
    clearcoatRoughness: preview.clearcoatRoughness,
    specularIntensity: preview.specularIntensity,
    specularColor: preview.specularColor,
    sheen: preview.sheen,
    sheenColor: preview.sheenColor,
    sheenRoughness: preview.sheenRoughness,
    iridescence: preview.iridescence,
    iridescenceIOR: preview.iridescenceIOR,
    iridescenceThicknessRange: [
      preview.iridescenceThicknessRange[0],
      preview.iridescenceThicknessRange[1],
    ],
    anisotropy: preview.anisotropy,
    anisotropyRotation: THREE.MathUtils.degToRad(
      preview.anisotropyRotationDegrees,
    ),
    dispersion: preview.dispersion,
  };
  const diagnostics = [
    createDiagnostic("preview.diffuse"),
    createDiagnostic("preview.reflection"),
    ...collectPovRayDiagnostics(definition.pov),
  ];
  if (projected.ior !== preview.ior) {
    diagnostics.unshift({
      path: "preview.ior",
      code: "preview.ior.clamped",
      support: "approximate",
    });
  }

  return {
    preview: projected,
    valueSignature: createValueSignature(projected),
    programSignature: createProgramSignature(projected),
    diagnostics,
  };
}

export function createMeshPhysicalMaterial(
  projection: MaterialProjection,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial();
  installPreviewDiffuseLobe(material, projection.preview.diffuse);
  applyMaterialProjection(material, projection);
  return material;
}

export function applyMaterialProjection(
  material: THREE.MeshPhysicalMaterial,
  projection: MaterialProjection,
): void {
  const preview = projection.preview;
  installPreviewDiffuseLobe(material, preview.diffuse);
  previewDiffuseUniforms.get(material)!.value = preview.diffuse;
  material.color.set(preview.baseColor);
  material.metalness = preview.metalness;
  material.roughness = preview.roughness;
  material.opacity = preview.opacity;
  material.transparent = preview.transparent;
  material.emissive.set(preview.emissiveColor);
  material.emissiveIntensity = preview.emissiveIntensity;
  material.side = preview.side;
  material.wireframe = preview.wireframe;
  material.envMapIntensity = preview.reflection;
  material.transmission = preview.transmission;
  material.ior = preview.ior;
  material.thickness = preview.thickness;
  material.attenuationColor.set(preview.attenuationColor);
  material.attenuationDistance = preview.attenuationDistance;
  material.clearcoat = preview.clearcoat;
  material.clearcoatRoughness = preview.clearcoatRoughness;
  material.specularIntensity = preview.specularIntensity;
  material.specularColor.set(preview.specularColor);
  material.sheen = preview.sheen;
  material.sheenColor.set(preview.sheenColor);
  material.sheenRoughness = preview.sheenRoughness;
  material.iridescence = preview.iridescence;
  material.iridescenceIOR = preview.iridescenceIOR;
  material.iridescenceThicknessRange[0] =
    preview.iridescenceThicknessRange[0];
  material.iridescenceThicknessRange[1] =
    preview.iridescenceThicknessRange[1];
  material.anisotropy = preview.anisotropy;
  material.anisotropyRotation = preview.anisotropyRotation;
  material.dispersion = preview.dispersion;
}

function installPreviewDiffuseLobe(
  material: THREE.MeshPhysicalMaterial,
  initialValue: number,
): void {
  if (previewDiffuseUniforms.has(material)) return;

  const uniform: ScalarUniform = { value: initialValue };
  previewDiffuseUniforms.set(material, uniform);
  material.onBeforeCompile = (shader) => {
    shader.uniforms[PREVIEW_DIFFUSE_UNIFORM] = uniform;
    shader.fragmentShader = injectPreviewDiffuseLobe(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => PREVIEW_DIFFUSE_PROGRAM_CACHE_KEY;
  material.needsUpdate = true;
}

function injectPreviewDiffuseLobe(fragmentShader: string): string {
  const firstAnchor = fragmentShader.indexOf(TRANSMISSION_FRAGMENT_ANCHOR);
  const secondAnchor = fragmentShader.indexOf(
    TRANSMISSION_FRAGMENT_ANCHOR,
    firstAnchor + TRANSMISSION_FRAGMENT_ANCHOR.length,
  );
  if (firstAnchor < 0 || secondAnchor >= 0) {
    throw new Error(
      "Unexpected MeshPhysicalMaterial shader: expected exactly one transmission fragment anchor.",
    );
  }

  const shaderWithScale = fragmentShader.replace(
    TRANSMISSION_FRAGMENT_ANCHOR,
    `${PREVIEW_DIFFUSE_SCALE_STATEMENT}\n${TRANSMISSION_FRAGMENT_ANCHOR}`,
  );
  return `uniform float ${PREVIEW_DIFFUSE_UNIFORM};\n${shaderWithScale}`;
}

function createValueSignature(preview: MeshPhysicalPreviewProjection): string {
  return JSON.stringify([
    preview.baseColor,
    preview.diffuse,
    preview.metalness,
    preview.roughness,
    preview.opacity,
    preview.transparent,
    preview.emissiveColor,
    preview.emissiveIntensity,
    preview.side,
    preview.wireframe,
    preview.reflection,
    preview.transmission,
    preview.ior,
    preview.thickness,
    preview.attenuationColor,
    signatureNumber(preview.attenuationDistance),
    preview.clearcoat,
    preview.clearcoatRoughness,
    preview.specularIntensity,
    preview.specularColor,
    preview.sheen,
    preview.sheenColor,
    preview.sheenRoughness,
    preview.iridescence,
    preview.iridescenceIOR,
    ...preview.iridescenceThicknessRange,
    preview.anisotropy,
    preview.anisotropyRotation,
    preview.dispersion,
  ]);
}

function createProgramSignature(preview: MeshPhysicalPreviewProjection): string {
  return JSON.stringify([
    preview.transparent,
    preview.side,
    preview.wireframe,
    preview.transmission > 0,
    preview.clearcoat > 0,
    preview.sheen > 0,
    preview.iridescence > 0,
    preview.anisotropy > 0,
    preview.dispersion > 0,
  ]);
}

function signatureNumber(value: number): number | string {
  if (Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return "NaN";
  return value > 0 ? "Infinity" : "-Infinity";
}

function collectPovRayDiagnostics(
  value: MaterialDefinitionSnapshot["pov"],
): MaterialProjectionDiagnostic[] {
  const diagnostics: MaterialProjectionDiagnostic[] = [];
  visitPovRayValue(value, "pov", diagnostics, new WeakSet<object>());
  return diagnostics;
}

function visitPovRayValue(
  value: unknown,
  path: string,
  diagnostics: MaterialProjectionDiagnostic[],
  visited: WeakSet<object>,
): void {
  if (value === undefined) return;
  if (value === null) {
    diagnostics.push(createDiagnostic(path));
    return;
  }
  if (typeof value !== "object") {
    diagnostics.push(createDiagnostic(path));
    return;
  }
  if (visited.has(value)) {
    diagnostics.push(createDiagnostic(path));
    return;
  }

  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visitPovRayValue(item, `${path}.${index}`, diagnostics, visited);
    });
    visited.delete(value);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitPovRayValue(child, `${path}.${key}`, diagnostics, visited);
  }
  visited.delete(value);
}

function createDiagnostic(path: string): MaterialProjectionDiagnostic {
  const capability = getMaterialCapability(path);
  return {
    path,
    code: capability.code,
    support: capability.support,
  };
}
