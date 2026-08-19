import { freezeDeep } from "../immutable";
import type { DeepReadonly } from "../scene-model";
import type {
  MaterialDefinitionModel,
  MaterialPresetId,
  PhysicalMaterialPreviewModel,
  PovColorModel,
  PovMaterialModel,
} from "./material-model";

export interface MaterialPresetDefinitionModel {
  id: MaterialPresetId;
  label: { ja: string; en: string };
  category: string;
  tags: string[];
  preview: PhysicalMaterialPreviewModel;
}

export const DEFAULT_MATERIAL_PRESET_ID: MaterialPresetId = "matte-plastic";

const DEFAULT_PREVIEW: PhysicalMaterialPreviewModel = {
  baseColor: "#5f8cff",
  diffuse: 0.8,
  metalness: 0,
  roughness: 0.6,
  opacity: 1,
  transparent: false,
  emissiveColor: "#000000",
  emissiveIntensity: 0,
  doubleSided: false,
  wireframe: false,
  reflection: 0,
  transmission: 0,
  ior: 1.5,
  thickness: 0,
  attenuationColor: "#ffffff",
  attenuationDistance: null,
  clearcoat: 0,
  clearcoatRoughness: 0,
  specularIntensity: 0.3,
  specularColor: "#ffffff",
  sheen: 0,
  sheenRoughness: 1,
  sheenColor: "#ffffff",
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThicknessRange: [100, 400],
  anisotropy: 0,
  anisotropyRotationDegrees: 0,
  dispersion: 0,
};

function preview(
  values: Partial<PhysicalMaterialPreviewModel>,
): PhysicalMaterialPreviewModel {
  return { ...structuredClone(DEFAULT_PREVIEW), ...values };
}

const PRESETS: MaterialPresetDefinitionModel[] = [
  {
    id: "matte",
    label: { ja: "マット", en: "Matte" },
    category: "basic",
    tags: ["matte", "マット", "diffuse", "拡散"],
    preview: preview({
      baseColor: "#7d8795",
      diffuse: 0.9,
      specularIntensity: 0.1,
      roughness: 0.9,
      metalness: 0,
      reflection: 0,
    }),
  },
  {
    id: "matte-plastic",
    label: { ja: "マットプラスチック", en: "Matte Plastic" },
    category: "plastic",
    tags: ["plastic", "プラスチック", "matte", "マット"],
    preview: preview({
      baseColor: "#4f86c6",
      diffuse: 0.8,
      specularIntensity: 0.3,
      roughness: 0.6,
      metalness: 0,
      reflection: 0,
      transmission: 0,
    }),
  },
  {
    id: "glossy-plastic",
    label: { ja: "光沢プラスチック", en: "Glossy Plastic" },
    category: "plastic",
    tags: ["plastic", "プラスチック", "glossy", "光沢"],
    preview: preview({
      baseColor: "#d1485f",
      diffuse: 0.7,
      specularIntensity: 0.7,
      roughness: 0.2,
      metalness: 0,
      reflection: 0,
      transmission: 0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.15,
    }),
  },
  {
    id: "metal",
    label: { ja: "金属", en: "Metal" },
    category: "metal",
    tags: ["metal", "金属", "reflective", "反射"],
    preview: preview({
      baseColor: "#aeb7c4",
      diffuse: 0.1,
      specularIntensity: 1,
      roughness: 0.2,
      metalness: 1,
      reflection: 0.8,
      transmission: 0,
    }),
  },
  {
    id: "glass",
    label: { ja: "ガラス", en: "Glass" },
    category: "glass",
    tags: ["glass", "ガラス", "transparent", "透明"],
    preview: preview({
      baseColor: "#e3f3ff",
      diffuse: 0,
      specularIntensity: 0.8,
      roughness: 0.05,
      metalness: 0,
      reflection: 0.1,
      transmission: 1,
      transparent: true,
      ior: 1.5,
      thickness: 0.5,
    }),
  },
  {
    id: "frosted-glass",
    label: { ja: "曇りガラス", en: "Frosted Glass" },
    category: "glass",
    tags: ["glass", "ガラス", "frosted", "曇り"],
    preview: preview({
      baseColor: "#d6e7e9",
      diffuse: 0.1,
      specularIntensity: 0.5,
      roughness: 0.5,
      metalness: 0,
      reflection: 0.1,
      transmission: 0.9,
      transparent: true,
      ior: 1.5,
      thickness: 0.5,
    }),
  },
  {
    id: "wood-base",
    label: { ja: "木材ベース", en: "Wood Base" },
    category: "organic",
    tags: ["wood", "木材", "organic", "自然素材"],
    preview: preview({
      baseColor: "#8b5a2b",
      diffuse: 0.8,
      specularIntensity: 0.2,
      roughness: 0.65,
      metalness: 0,
      reflection: 0.08,
    }),
  },
  {
    id: "concrete",
    label: { ja: "コンクリート", en: "Concrete" },
    category: "mineral",
    tags: ["concrete", "コンクリート", "stone", "石材"],
    preview: preview({
      baseColor: "#858583",
      diffuse: 0.8,
      specularIntensity: 0.2,
      roughness: 0.8,
      metalness: 0,
      reflection: 0.1,
      transmission: 0,
    }),
  },
];

export const MATERIAL_PRESETS: DeepReadonly<
  MaterialPresetDefinitionModel[]
> = freezeDeep(PRESETS);

export function getMaterialPreset(
  presetId: MaterialPresetId,
): DeepReadonly<MaterialPresetDefinitionModel> {
  const preset = MATERIAL_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`Unknown material preset: ${presetId}`);
  return preset;
}

export function createMaterialDefinition(
  id: string,
  name: string,
  presetId: MaterialPresetId = DEFAULT_MATERIAL_PRESET_ID,
): MaterialDefinitionModel {
  const preset = getMaterialPreset(presetId);
  const materialPreview = structuredClone(
    preset.preview,
  ) as PhysicalMaterialPreviewModel;

  return {
    id,
    name,
    category: preset.category,
    tags: [...preset.tags],
    presetId,
    preview: materialPreview,
    pov: createPovMaterialFromPreview(materialPreview),
  };
}

export function createMaterialDefinitionFromPreview(
  id: string,
  name: string,
  materialPreview: PhysicalMaterialPreviewModel,
): MaterialDefinitionModel {
  const clonedPreview = structuredClone(materialPreview);
  return {
    id,
    name,
    category: "custom",
    tags: [],
    presetId: null,
    preview: clonedPreview,
    pov: createPovMaterialFromPreview(clonedPreview),
  };
}

export function createDefaultPhysicalMaterialPreview(
  values: Partial<PhysicalMaterialPreviewModel> = {},
): PhysicalMaterialPreviewModel {
  return preview(values);
}

export function createPovMaterialFromPreview(
  materialPreview: PhysicalMaterialPreviewModel,
): PovMaterialModel {
  const baseColor = hexToPovColor(materialPreview.baseColor);
  const reflection = grayscale(materialPreview.reflection);

  return {
    targetVersion: "3.7",
    texture: {
      type: "plain",
      pigment: {
        type: "solid",
        color: {
          ...baseColor,
          transmit: Math.max(
            0,
            Math.min(1, 1 - materialPreview.opacity + materialPreview.transmission),
          ),
        },
      },
      finish: {
        diffuse: materialPreview.diffuse,
        emission: hexToPovColor(materialPreview.emissiveColor),
        specular: materialPreview.specularIntensity,
        metallic: materialPreview.metalness,
        reflection: { minimum: reflection, maximum: reflection, fresnel: true },
        conserveEnergy: true,
      },
    },
    interior: {
      ior: materialPreview.ior,
      dispersion:
        materialPreview.dispersion > 0
          ? 1 + materialPreview.dispersion
          : undefined,
      fadeDistance: materialPreview.attenuationDistance ?? undefined,
      fadeColor: hexToPovColor(materialPreview.attenuationColor),
    },
  };
}

function hexToPovColor(color: string): PovColorModel {
  const match = /^#([\da-f]{6})$/i.exec(color);
  if (!match) return { red: 1, green: 1, blue: 1 };

  const value = Number.parseInt(match[1], 16);
  return {
    red: ((value >> 16) & 0xff) / 255,
    green: ((value >> 8) & 0xff) / 255,
    blue: (value & 0xff) / 255,
  };
}

function grayscale(value: number): PovColorModel {
  return { red: value, green: value, blue: value };
}
