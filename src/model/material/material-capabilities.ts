import { freezeDeep } from "../immutable";
import type { DeepReadonly } from "../scene-model";
import type { PovRayTargetVersion } from "./material-model";

export type MaterialCapabilityFidelity =
  | "direct"
  | "approximate"
  | "stored-only";

export type MaterialCapabilityCategory =
  | "preview"
  | "material"
  | "texture"
  | "pigment"
  | "normal"
  | "finish"
  | "interior"
  | "media"
  | "mapping"
  | "pattern"
  | "warp"
  | "global";

export interface LocalizedMaterialCapabilityText {
  ja: string;
  en: string;
}

export interface LocalizedMaterialCapabilityKeywords {
  ja: string[];
  en: string[];
}

export interface MaterialCapabilityModel {
  id: string;
  path: string;
  category: MaterialCapabilityCategory;
  povVersions: PovRayTargetVersion[];
  fidelity: MaterialCapabilityFidelity;
  label: LocalizedMaterialCapabilityText;
  help: LocalizedMaterialCapabilityText;
  keywords: LocalizedMaterialCapabilityKeywords;
  dependencies?: string[];
  sourceUrl: string;
}

const REFERENCE_37 = "https://www.povray.org/documentation/3.7.0/r3_4.html";
const COLOR_37 = "https://www.povray.org/documentation/3.7.0/r3_3.html";
const FINISH_38 = "https://wiki.povray.org/content/Reference%3AFinish";

function capability(
  id: string,
  path: string,
  category: MaterialCapabilityCategory,
  fidelity: MaterialCapabilityFidelity,
  ja: string,
  en: string,
  helpJa: string,
  helpEn: string,
  keywordsJa: string[],
  keywordsEn: string[],
  options: {
    povVersions?: PovRayTargetVersion[];
    dependencies?: string[];
    sourceUrl?: string;
  } = {},
): MaterialCapabilityModel {
  const storesPovOnly = path === "pov" || path.startsWith("pov.");
  return {
    id,
    path,
    category,
    povVersions: options.povVersions ?? ["3.7", "3.8"],
    fidelity: storesPovOnly ? "stored-only" : fidelity,
    label: { ja, en },
    help: storesPovOnly
      ? {
          ja: "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
          en: "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
        }
      : { ja: helpJa, en: helpEn },
    keywords: { ja: keywordsJa, en: keywordsEn },
    dependencies: options.dependencies,
    sourceUrl: options.sourceUrl ?? REFERENCE_37,
  };
}

const PREVIEW_CAPABILITIES: MaterialCapabilityModel[] = [
  capability("preview.base-color", "preview.baseColor", "preview", "direct", "ベースカラー", "Base color", "WebGLプレビューの表面色です。", "Surface color in the WebGL preview.", ["色", "拡散色"], ["color", "albedo"]),
  capability("preview.diffuse", "preview.diffuse", "preview", "approximate", "拡散", "Diffuse", "POV-Rayの拡散量をPBR材質へ近似します。", "Approximates POV-Ray diffuse response in the PBR material.", ["拡散", "diffuse"], ["diffuse", "lambert"]),
  capability("preview.reflection", "preview.reflection", "preview", "approximate", "反射", "Reflection", "環境反射で反射量を近似します。", "Approximates reflection using environment lighting.", ["反射", "鏡面"], ["reflection", "mirror"]),
  capability("preview.metalness", "preview.metalness", "preview", "direct", "メタルネス", "Metalness", "Three.jsの金属度へ直接設定します。", "Maps directly to Three.js metalness.", ["金属", "メタル"], ["metal", "metalness"]),
  capability("preview.roughness", "preview.roughness", "preview", "direct", "ラフネス", "Roughness", "Three.jsの粗さへ直接設定します。POV-Ray finish roughnessとは尺度が異なります。", "Maps to Three.js roughness; its scale differs from POV-Ray finish roughness.", ["粗さ", "艶"], ["roughness", "gloss"]),
  capability("preview.opacity", "preview.opacity", "preview", "direct", "不透明度", "Opacity", "WebGLの不透明度へ直接設定します。", "Maps directly to WebGL opacity.", ["透明", "不透明"], ["opacity", "alpha"]),
  capability("preview.emission", "preview.emissiveColor", "preview", "direct", "発光", "Emission", "発光色と強度をWebGL材質へ設定します。", "Sets emissive color and intensity on the WebGL material.", ["発光", "自己発光"], ["emission", "emissive"]),
  capability("preview.sidedness", "preview.doubleSided", "preview", "direct", "両面", "Double sided", "両面描画を直接切り替えます。", "Directly toggles double-sided rendering.", ["両面", "裏面"], ["double sided", "backface"]),
  capability("preview.wireframe", "preview.wireframe", "preview", "direct", "ワイヤーフレーム", "Wireframe", "ワイヤーフレーム表示を直接切り替えます。", "Directly toggles wireframe rendering.", ["線", "ワイヤー"], ["wire", "wireframe"]),
  capability("preview.transmission", "preview.transmission", "preview", "direct", "透過", "Transmission", "MeshPhysicalMaterialの透過へ直接設定します。", "Maps directly to MeshPhysicalMaterial transmission.", ["透過", "ガラス"], ["transmission", "glass"]),
  capability("preview.ior", "preview.ior", "preview", "approximate", "屈折率", "IOR", "SceneModelは元のIORを保持します。Three.jsプレビューは1～2.333へ制限し、範囲外では警告します。", "The SceneModel preserves the original IOR; the Three.js preview clamps it to 1–2.333 and reports a warning when clamped.", ["屈折率", "ior"], ["ior", "refraction"]),
  capability("preview.volume", "preview.thickness", "preview", "direct", "厚みと減衰", "Thickness and attenuation", "厚み、減衰色、減衰距離を物理材質へ設定します。", "Sets thickness, attenuation color, and attenuation distance.", ["厚み", "吸収", "減衰"], ["thickness", "attenuation"]),
  capability("preview.clearcoat", "preview.clearcoat", "preview", "direct", "クリアコート", "Clearcoat", "クリアコート量と粗さを直接設定します。", "Maps clearcoat amount and roughness directly.", ["塗装", "クリア"], ["clearcoat", "coating"]),
  capability("preview.specular", "preview.specularIntensity", "preview", "direct", "スペキュラー", "Specular", "非金属の鏡面反射強度と色を直接設定します。", "Maps dielectric specular intensity and color directly.", ["鏡面", "ハイライト"], ["specular", "highlight"]),
  capability("preview.sheen", "preview.sheen", "preview", "direct", "シーン", "Sheen", "布状のシーン量、色、粗さを直接設定します。", "Maps sheen amount, color, and roughness directly.", ["布", "シーン"], ["sheen", "fabric"]),
  capability("preview.iridescence", "preview.iridescence", "preview", "direct", "虹色干渉", "Iridescence", "虹色干渉の強度、IOR、膜厚範囲を直接設定します。", "Maps iridescence, IOR, and film thickness range directly.", ["虹色", "薄膜"], ["iridescence", "thin film"]),
  capability("preview.anisotropy", "preview.anisotropy", "preview", "direct", "異方性", "Anisotropy", "異方性と回転角を直接設定します。", "Maps anisotropy and its rotation directly.", ["異方性", "回転"], ["anisotropy", "rotation"]),
  capability("preview.dispersion", "preview.dispersion", "preview", "direct", "分散", "Dispersion", "MeshPhysicalMaterialの分散へ直接設定します。", "Maps directly to MeshPhysicalMaterial dispersion.", ["分散", "色収差"], ["dispersion", "chromatic"]),
];

const POV_CAPABILITIES: MaterialCapabilityModel[] = [
  capability("pov.material", "pov", "material", "stored-only", "materialラッパー", "Material wrapper", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["材料", "material"], ["material", "wrapper"]),
  capability("pov.texture.plain", "pov.texture", "texture", "stored-only", "プレーンtexture", "Plain texture", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["テクスチャ", "表面"], ["texture", "surface"]),
  capability("pov.texture.patterned", "pov.texture.pattern", "texture", "stored-only", "パターンtexture", "Patterned texture", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["パターン", "texture map"], ["pattern", "texture map"]),
  capability("pov.texture.layered", "pov.texture.layers", "texture", "stored-only", "レイヤーtexture", "Layered texture", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["レイヤー", "積層"], ["layer", "stack"]),
  capability("pov.texture.material-map", "pov.texture.materialMap", "texture", "stored-only", "material_map", "Material map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["材質マップ", "画像"], ["material map", "indexed image"]),
  capability("pov.texture.interior", "pov.interiorTexture", "texture", "stored-only", "interior_texture", "Interior texture", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["内側", "裏面"], ["interior texture", "back surface"]),
  capability("pov.pigment.rgbft", "pov.texture.pigment.color", "pigment", "stored-only", "RGBFT色", "RGBFT color", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["色", "フィルター", "透過"], ["rgbft", "filter", "transmit"], { sourceUrl: COLOR_37 }),
  capability("pov.pigment.image", "pov.texture.pigment.imageMap", "pigment", "stored-only", "image_map", "Image map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["画像", "イメージマップ"], ["image", "image map"]),
  capability("pov.pigment.maps", "pov.texture.pigment.*Map", "pigment", "stored-only", "color_map / pigment_map", "Color and pigment maps", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["カラーマップ", "ピグメントマップ"], ["color map", "pigment map"]),
  capability("pov.pigment.quick-color", "pov.texture.pigment.quickColor", "pigment", "stored-only", "quick_color", "Quick color", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["代替色", "品質"], ["quick color", "quality"]),
  capability("pov.normal.procedural", "pov.texture.normal.pattern", "normal", "stored-only", "プロシージャルnormal", "Procedural normal", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["法線", "凹凸"], ["normal", "procedural"]),
  capability("pov.normal.normal-map", "pov.texture.normal.normalMap", "normal", "stored-only", "normal_map", "Normal map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["法線マップ"], ["normal map"]),
  capability("pov.normal.slope-map", "pov.texture.normal.slopeMap", "normal", "stored-only", "slope_map", "Slope map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["傾斜", "スロープ"], ["slope", "slope map"]),
  capability("pov.normal.bump-map", "pov.texture.normal.imageMap", "normal", "stored-only", "bump_map", "Bump map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["バンプ", "凹凸画像"], ["bump", "bump map"]),
  capability("pov.normal.controls", "pov.texture.normal", "normal", "stored-only", "bump_size / accuracy", "Normal controls", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["精度", "スケール"], ["accuracy", "bump size", "no bump scale"]),
  capability("pov.finish.diffuse", "pov.texture.finish.diffuse", "finish", "stored-only", "diffuse / albedo", "Diffuse / albedo", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["拡散", "アルベド", "brilliance"], ["diffuse", "albedo", "brilliance"]),
  capability("pov.finish.ambient-emission", "pov.texture.finish.emission", "finish", "stored-only", "ambient / emission", "Ambient / emission", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["環境光", "発光"], ["ambient", "emission"]),
  capability("pov.finish.highlight", "pov.texture.finish", "finish", "stored-only", "phong / specular", "Phong / specular", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["フォン", "鏡面", "粗さ"], ["phong", "specular", "roughness"]),
  capability("pov.finish.metallic", "pov.texture.finish.metallic", "finish", "stored-only", "metallic", "Metallic", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["金属"], ["metallic", "metalness"]),
  capability("pov.finish.reflection", "pov.texture.finish.reflection", "finish", "stored-only", "reflection / fresnel", "Reflection / Fresnel", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["反射", "フレネル"], ["reflection", "fresnel"]),
  capability("pov.finish.energy", "pov.texture.finish.conserveEnergy", "finish", "stored-only", "conserve_energy", "Conserve energy", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["エネルギー保存"], ["conserve energy"]),
  capability("pov.finish.iridescence", "pov.texture.finish.iridescence", "finish", "stored-only", "irid", "Iridescence", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["虹色", "膜厚"], ["irid", "iridescence"]),
  capability("pov.finish.subsurface", "pov.texture.finish.subsurface", "finish", "stored-only", "subsurface", "Subsurface", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["表面下散乱", "半透明"], ["subsurface", "translucency"], { dependencies: ["global_settings.subsurface", "radiosity"] }),
  capability("pov.finish.38", "pov.texture.finish.useAlpha", "finish", "stored-only", "3.8 finish拡張", "3.8 finish extensions", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["3.8", "アルファ"], ["3.8", "use alpha"], { povVersions: ["3.8"], sourceUrl: FINISH_38 }),
  capability("pov.interior.ior", "pov.interior.ior", "interior", "stored-only", "ior", "IOR", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["屈折率"], ["ior", "refraction"]),
  capability("pov.interior.caustics", "pov.interior.caustics", "interior", "stored-only", "caustics", "Caustics", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["コースティクス", "集光"], ["caustics", "photons"], { dependencies: ["photons"] }),
  capability("pov.interior.dispersion", "pov.interior.dispersion", "interior", "stored-only", "dispersion", "Dispersion", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["分散", "色収差"], ["dispersion", "samples"]),
  capability("pov.interior.fade", "pov.interior.fadeDistance", "interior", "stored-only", "fade_distance / power / color", "Interior fade", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["減衰", "吸収色"], ["fade", "attenuation"]),
  capability("pov.media.absorption", "pov.interior.media.absorption", "media", "stored-only", "media absorption", "Media absorption", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["媒体", "吸収"], ["media", "absorption"], { dependencies: ["object.hollow"] }),
  capability("pov.media.emission", "pov.interior.media.emission", "media", "stored-only", "media emission", "Media emission", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["媒体", "発光"], ["media", "emission"], { dependencies: ["object.hollow"] }),
  capability("pov.media.scattering", "pov.interior.media.scattering", "media", "stored-only", "scattering 1–5", "Scattering types 1–5", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["散乱", "ミー", "レイリー"], ["scattering", "mie", "rayleigh", "henyey-greenstein"], { dependencies: ["object.hollow"] }),
  capability("pov.media.density", "pov.interior.media.density", "media", "stored-only", "density / density_map", "Density / density map", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["密度", "密度マップ"], ["density", "density map"]),
  capability("pov.media.sampling", "pov.interior.media", "media", "stored-only", "mediaサンプリング", "Media sampling", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["サンプル", "積分", "ジッター"], ["samples", "integration", "jitter"]),
  capability("pov.mapping.uv", "pov.texture.*.uv", "mapping", "stored-only", "UVマッピング", "UV mapping", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["UV", "座標"], ["uv", "coordinates"]),
  capability("pov.mapping.image", "pov.texture.*.imageMap", "mapping", "stored-only", "画像投影", "Image projection", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["平面", "球", "円柱", "トーラス"], ["planar", "spherical", "cylindrical", "toroidal"]),
  capability("pov.mapping.image-options", "pov.texture.*.imageMap", "mapping", "stored-only", "画像オプション", "Image options", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["ガンマ", "補間", "アルファ"], ["gamma", "interpolation", "alpha"]),
  capability("pov.mapping.uv-vectors", "pov.extensions.uvVectors", "mapping", "stored-only", "uv_vectors", "UV vectors", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["三角形", "UVベクトル"], ["triangle", "uv vectors"]),
  capability("pov.texture.cutaway", "pov.extensions.cutawayTextures", "texture", "stored-only", "cutaway_textures", "Cutaway textures", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["CSG", "切断面"], ["csg", "cutaway"]),
  capability("pov.texture.tiles", "pov.texture.extensions.tiles", "texture", "stored-only", "tiles（旧構文）", "Tiles (legacy)", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["旧構文", "タイル"], ["legacy", "tiles"]),
];

const PATTERN_TYPES = [
  "agate", "boxed", "bozo", "brick", "bumps", "cells", "checker",
  "crackle", "cubic", "cylindrical", "density_file", "dents", "facets",
  "function", "gradient", "granite", "hexagon", "leopard",
  "marble", "object", "onion", "pavement", "pigment_pattern", "planar",
  "quilted", "radial", "ripples", "slope", "aoi", "spherical", "spiral1",
  "spiral2", "spotted", "square", "tiling", "triangular", "waves", "wood",
  "wrinkles", "average", "image_pattern",
] as const;

const FRACTAL_PATTERN_CAPABILITIES: MaterialCapabilityModel[] = [
  capability(
    "pov.pattern.mandel",
    "pov.*.pattern:mandel",
    "pattern",
    "stored-only",
    "mandel フラクタル",
    "mandel fractal",
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    ["mandel", "マンデルブロ", "iterations", "exponent", "interior", "exterior"],
    ["mandel", "mandelbrot", "iterations", "exponent", "interior", "exterior"],
  ),
  capability(
    "pov.pattern.julia",
    "pov.*.pattern:julia",
    "pattern",
    "stored-only",
    "julia フラクタル",
    "julia fractal",
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    ["julia", "ジュリア", "complex", "iterations", "exponent", "interior", "exterior"],
    ["julia", "complex", "iterations", "exponent", "interior", "exterior"],
  ),
  capability(
    "pov.pattern.magnet-mandel",
    "pov.*.pattern:magnet/mandel",
    "pattern",
    "stored-only",
    "magnet mandel フラクタル",
    "magnet mandel fractal",
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    ["magnet", "mandel", "magnet TYPE mandel ITERATIONS", "iterations", "interior", "exterior"],
    ["magnet", "mandel", "magnet type mandel iterations", "iterations", "interior", "exterior"],
  ),
  capability(
    "pov.pattern.magnet-julia",
    "pov.*.pattern:magnet/julia",
    "pattern",
    "stored-only",
    "magnet julia フラクタル",
    "magnet julia fractal",
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    ["magnet", "julia", "magnet TYPE julia COMPLEX ITERATIONS", "complex", "iterations", "interior", "exterior"],
    ["magnet", "julia", "magnet type julia complex iterations", "complex", "iterations", "interior", "exterior"],
  ),
];

const PATTERN_CAPABILITIES = PATTERN_TYPES.map((pattern) =>
  capability(
    `pov.pattern.${pattern.replaceAll("_", "-")}`,
    `pov.*.pattern:${pattern}`,
    "pattern",
    "stored-only",
    `${pattern} パターン`,
    `${pattern} pattern`,
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    [pattern, "パターン"],
    [pattern, "pattern"],
  ),
);

const PATTERN_CONTROL_CAPABILITIES: MaterialCapabilityModel[] = [
  capability("pov.pattern.maps", "pov.*.pattern.map", "pattern", "stored-only", "パターンmap", "Pattern maps", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["マップ", "制御点"], ["map", "control point"]),
  capability("pov.pattern.wave", "pov.*.pattern.wave", "pattern", "stored-only", "波形", "Wave forms", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["波形", "周波数", "位相"], ["wave", "frequency", "phase"]),
  capability("pov.pattern.noise", "pov.*.pattern.parameters.noiseGenerator", "pattern", "stored-only", "noise_generator", "Noise generator", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["ノイズ"], ["noise", "noise generator"]),
  capability("pov.pattern.turbulence", "pov.*.pattern.turbulence", "pattern", "stored-only", "turbulence", "Turbulence", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["乱流", "オクターブ"], ["turbulence", "octaves", "lambda", "omega"]),
  capability("pov.pattern.transforms", "pov.*.pattern.transforms", "pattern", "stored-only", "パターン変換", "Pattern transforms", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["変換", "移動", "回転"], ["transform", "translate", "rotate", "scale"]),
];

const WARP_TYPES = [
  "repeat", "black_hole", "turbulence", "cylindrical", "spherical",
  "toroidal", "planar", "cubic",
] as const;

const WARP_CAPABILITIES = WARP_TYPES.map((warp) =>
  capability(
    `pov.warp.${warp.replaceAll("_", "-")}`,
    `pov.*.pattern.warp:${warp}`,
    "warp",
    "stored-only",
    `${warp} warp`,
    `${warp} warp`,
    "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。",
    "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.",
    [warp, "ワープ", "座標"],
    [warp, "warp", "coordinates"],
  ),
);

const GLOBAL_CAPABILITIES: MaterialCapabilityModel[] = [
  capability("pov.global.ambient", "pov.extensions.global.ambientLight", "global", "stored-only", "ambient_light / assumed_gamma", "Ambient light / assumed gamma", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["環境光", "ガンマ"], ["ambient light", "assumed gamma"]),
  capability("pov.global.irid", "pov.extensions.global.iridWavelength", "global", "stored-only", "irid_wavelength / mm_per_unit", "Iridescence scale", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["波長", "単位"], ["wavelength", "units"]),
  capability("pov.global.radiosity", "pov.extensions.global.radiosity", "global", "stored-only", "radiosity / photons", "Radiosity / photons", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["ラジオシティ", "フォトン"], ["radiosity", "photons"]),
  capability("pov.global.object-flags", "pov.extensions.object", "global", "stored-only", "オブジェクト材質フラグ", "Object material flags", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["中空", "影", "反射"], ["hollow", "double illuminate", "no shadow"]),
  capability("pov.extensions", "pov.extensions", "material", "stored-only", "拡張ノード", "Extension nodes", "POV-Rayの構造と値を保持します。現在のWebGLプレビューには反映されません。", "Stores the POV-Ray structure and values; the current WebGL preview does not render this feature.", ["拡張", "未対応", "raw"], ["extension", "unsupported", "raw"]),
];

export const MATERIAL_CAPABILITIES: DeepReadonly<MaterialCapabilityModel[]> =
  freezeDeep([
    ...PREVIEW_CAPABILITIES,
    ...POV_CAPABILITIES,
    ...PATTERN_CAPABILITIES,
    ...FRACTAL_PATTERN_CAPABILITIES,
    ...PATTERN_CONTROL_CAPABILITIES,
    ...WARP_CAPABILITIES,
    ...GLOBAL_CAPABILITIES,
  ]);

export function findMaterialCapability(
  capabilityId: string,
): DeepReadonly<MaterialCapabilityModel> | undefined {
  return MATERIAL_CAPABILITIES.find((entry) => entry.id === capabilityId);
}
