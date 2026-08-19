import {
  APP_LOCALES,
  isAppLocale,
  translate as translateBase,
  type AppLocale,
  type MessageKey as BaseMessageKey,
} from "./i18n-base";

const japaneseMaterialMessages = {
  "material.presetConcrete": "コンクリート",
  "material.presetMattePlastic": "マットプラスチック",
  "material.presetGlossyPlastic": "光沢プラスチック",
  "material.presetFrostedGlass": "すりガラス",
  "material.presetWood": "木材ベース",
  "material.diffuse": "拡散",
  "material.diffuseHelp": "小さいほど暗く締まり、大きいほど拡散光を明るく返します。",
  "material.specular": "スペキュラー",
  "material.specularHelp": "小さいほどハイライトが弱く、大きいほど強く見えます。",
  "material.roughnessHelp": "小さいほど滑らかで反射が鋭く、大きいほど反射がぼけます。",
  "material.metallic": "金属度",
  "material.metallicHelp": "0は非金属、1は金属らしい反射になります。",
  "material.reflection": "反射",
  "material.reflectionHelp": "小さいほど周囲を映さず、大きいほど環境反射が強くなります。",
  "material.transmission": "透過",
  "material.transmissionHelp": "0は光を通さず、1に近いほどガラス状に光を通します。",
  "material.ior": "屈折率（IOR）",
  "material.iorHelp": "1に近いほど曲がりが小さく、大きいほど屈折が強く見えます。",
  "material.iorPresets": "代表的な屈折率",
  "material.iorAir": "空気",
  "material.iorWater": "水",
  "material.iorAcrylic": "アクリル",
  "material.iorGlass": "ガラス",
  "material.iorDiamond": "ダイヤモンド",
  "material.opacityHelp": "0は透明、1は不透明です。透明表示も有効にしてください。",
  "material.emissiveIntensityHelp": "0では発光せず、値を上げるほど自己発光が強く見えます。",
} as const;

type MaterialMessageKey = keyof typeof japaneseMaterialMessages;

const englishMaterialMessages: Record<MaterialMessageKey, string> = {
  "material.presetConcrete": "Concrete",
  "material.presetMattePlastic": "Matte plastic",
  "material.presetGlossyPlastic": "Glossy plastic",
  "material.presetFrostedGlass": "Frosted glass",
  "material.presetWood": "Wood base",
  "material.diffuse": "Diffuse",
  "material.diffuseHelp": "Lower values look darker; higher values return more diffuse light.",
  "material.specular": "Specular",
  "material.specularHelp": "Lower values weaken highlights; higher values make them stronger.",
  "material.roughnessHelp": "Lower values look smooth with sharp reflections; higher values blur reflections.",
  "material.metallic": "Metallic",
  "material.metallicHelp": "0 behaves like a non-metal; 1 gives a metal-like reflection response.",
  "material.reflection": "Reflection",
  "material.reflectionHelp": "Lower values reduce environment reflections; higher values strengthen them.",
  "material.transmission": "Transmission",
  "material.transmissionHelp": "0 blocks transmitted light; values near 1 appear more glass-like.",
  "material.ior": "Index of refraction (IOR)",
  "material.iorHelp": "Values near 1 bend light less; higher values show stronger refraction.",
  "material.iorPresets": "Common refractive indices",
  "material.iorAir": "Air",
  "material.iorWater": "Water",
  "material.iorAcrylic": "Acrylic",
  "material.iorGlass": "Glass",
  "material.iorDiamond": "Diamond",
  "material.opacityHelp": "0 is transparent and 1 is opaque. Enable transparency as well.",
  "material.emissiveIntensityHelp": "0 emits no light; increasing the value makes self-emission look stronger.",
};

const materialMessages: Record<
  AppLocale,
  Record<MaterialMessageKey, string>
> = {
  ja: japaneseMaterialMessages,
  en: englishMaterialMessages,
};

export { APP_LOCALES, isAppLocale };
export type { AppLocale };
export type MessageKey = BaseMessageKey | MaterialMessageKey;

export function translate(locale: AppLocale, key: MessageKey): string {
  if (key in materialMessages[locale]) {
    return materialMessages[locale][key as MaterialMessageKey];
  }
  return translateBase(locale, key as BaseMessageKey);
}
