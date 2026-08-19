import type {
  MaterialCapabilityCategory,
  MaterialCapabilityFidelity,
  MaterialCapabilityModel,
} from "../model/material/material-capabilities";
import type { MaterialDefinitionModel } from "../model/material/material-model";
import type { DeepReadonly } from "../model/scene-model";
import type { AppLocale, MessageKey } from "./i18n";
import type { MaterialSupportStatus } from "./material-library-state";

export type MaterialSnapshot = DeepReadonly<MaterialDefinitionModel>;
export type CapabilitySnapshot = DeepReadonly<MaterialCapabilityModel>;

export const SUPPORT_LABELS: Readonly<
  Record<MaterialSupportStatus, MessageKey>
> = {
  direct: "material.supportDirect",
  approximate: "material.supportApproximate",
  stored: "material.supportStored",
};

export const SUPPORT_DESCRIPTIONS: Readonly<
  Record<MaterialSupportStatus, MessageKey>
> = {
  direct: "material.supportDirectDescription",
  approximate: "material.supportApproximateDescription",
  stored: "material.supportStoredDescription",
};

export const CATEGORY_LABELS: Readonly<Record<string, MessageKey>> = {
  general: "material.categoryGeneral",
  surface: "material.categorySurface",
  plastic: "material.categorySurface",
  matte: "material.categorySurface",
  metal: "material.categoryMetal",
  glass: "material.categoryGlass",
  emissive: "material.categoryEmissive",
  procedural: "material.categoryProcedural",
  wood: "material.categoryProcedural",
  concrete: "material.categorySurface",
  volume: "material.categoryVolume",
  media: "material.categoryVolume",
};

const CAPABILITY_CATEGORY_JA: Readonly<
  Record<MaterialCapabilityCategory, string>
> = {
  preview: "WebGLプレビュー",
  material: "Materialラッパー",
  texture: "Texture",
  pigment: "Pigment（色と模様）",
  normal: "Normal（見かけの凹凸）",
  finish: "Finish（光沢と反射）",
  interior: "Interior（屈折と減衰）",
  media: "Media（内部媒質）",
  mapping: "マッピング",
  pattern: "パターン",
  warp: "ワープ",
  global: "関連グローバル設定",
};

const CAPABILITY_CATEGORY_EN: Readonly<
  Record<MaterialCapabilityCategory, string>
> = {
  preview: "WebGL preview",
  material: "Material wrapper",
  texture: "Texture",
  pigment: "Pigment (color and pattern)",
  normal: "Normal (apparent relief)",
  finish: "Finish (highlights and reflection)",
  interior: "Interior (refraction and attenuation)",
  media: "Media (interior volume)",
  mapping: "Mapping",
  pattern: "Patterns",
  warp: "Warps",
  global: "Related global settings",
};

const CAPABILITY_CATEGORIES: readonly MaterialCapabilityCategory[] = [
  "preview",
  "material",
  "texture",
  "pigment",
  "normal",
  "finish",
  "interior",
  "media",
  "mapping",
  "pattern",
  "warp",
  "global",
];

export function collectMaterialKeywords(material: MaterialSnapshot): string[] {
  const result = new Set<string>(material.tags);
  collectKeysAndStrings(material.pov, result);
  return [...result];
}

export function getMaterialSupportStatus(
  _material: MaterialSnapshot,
): MaterialSupportStatus {
  // A material contains a distinct POV-Ray profile, so the aggregate browser
  // representation is always described as an approximation.
  return "approximate";
}

export function filterCapabilities(
  capabilities: readonly CapabilitySnapshot[],
  query: string,
  support: "all" | MaterialSupportStatus,
  locale: AppLocale,
): readonly CapabilitySnapshot[] {
  const terms = query
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return capabilities.filter((entry) => {
    if (support !== "all" && fidelityToStatus(entry.fidelity) !== support) {
      return false;
    }
    const searchable = [
      entry.id,
      entry.path,
      entry.category,
      entry.label[locale],
      entry.help[locale],
      ...entry.keywords.ja,
      ...entry.keywords.en,
    ]
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function resolveCapabilityValue(
  material: MaterialSnapshot,
  path: string,
): unknown {
  if (path.includes("*") || path.includes(":")) return undefined;
  let value: unknown = material;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value;
}

export function fidelityToStatus(
  fidelity: MaterialCapabilityFidelity,
): MaterialSupportStatus {
  return fidelity === "stored-only" ? "stored" : fidelity;
}

export function capabilityCategories(): readonly MaterialCapabilityCategory[] {
  return CAPABILITY_CATEGORIES;
}

export function capabilityCategoryLabel(
  category: MaterialCapabilityCategory,
  locale: AppLocale,
): string {
  return locale === "ja"
    ? CAPABILITY_CATEGORY_JA[category]
    : CAPABILITY_CATEGORY_EN[category];
}

export function formatCapabilityValue(
  value: unknown,
  locale: AppLocale,
): string {
  if (value === undefined) return locale === "ja" ? "未設定" : "Not configured";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${locale === "ja" ? "項目" : "Items"}: ${value.length}`;
  }
  return locale === "ja" ? "設定済み" : "Configured";
}

function collectKeysAndStrings(value: unknown, result: Set<string>): void {
  if (typeof value === "string") {
    result.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectKeysAndStrings(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    result.add(key);
    collectKeysAndStrings(item, result);
  }
}
