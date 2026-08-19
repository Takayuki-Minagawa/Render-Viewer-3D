import {
  APP_LOCALES,
  isAppLocale,
  translate as translateBase,
  type AppLocale,
  type MessageKey,
} from "./i18n-material";

const japaneseOverrides: Partial<Record<MessageKey, string>> = {
  "material.supportStored": "モデル保持（プレビューなし）",
  "material.supportStoredDescription":
    "POV-Rayプロファイルの構造と値をモデルへ保持しますが、WebGLプレビューには表示しません。",
  "material.disclaimer":
    "このエディターはPOV-Ray 3.7の用語体系に沿っています。WebGLプレビューはPOV-Rayによるレンダリングではなく、一部の効果は近似表示または未表示です。基本タブのWebGLプレビュー設定と詳細タブのPOV-Rayプロファイルは別管理で、自動同期されません。",
  "material.capabilityTitle": "POV-Ray材料概念カタログ",
  "material.capabilityDescription":
    "POV-Rayの材料機能を概念ID単位で一覧化した対応表です。値が未設定の概念も表示します。WebGLプレビュー設定とPOV-Rayプロファイルは別管理で、自動同期されません。",
  "material.keyword": "概念ID・用語",
  "material.notEditable":
    "この概念はモデルへ保持できますが、現在のWebGLプレビューでは表示しません。",
  "manual.materialStatus":
    "直接プレビュー、近似プレビュー、モデル保持（プレビューなし）の表示でWebGLとの関係を確認できます。",
  "manual.materialAdvanced":
    "「詳細」ではPOV-RayのPigment、Normal、Finish、Interior、Mediaなどを概念ID単位で確認します。",
  "manual.materialDisclaimer":
    "WebGL表示はPOV-Rayレンダリングそのものではありません。WebGLプレビュー設定とPOV-Rayプロファイルは別管理で、自動同期されません。",
};

const englishOverrides: Partial<Record<MessageKey, string>> = {
  "material.supportStored": "Model only (not previewed)",
  "material.supportStoredDescription":
    "The POV-Ray profile structure and values remain in the model but are not rendered in the WebGL preview.",
  "material.disclaimer":
    "This editor follows POV-Ray 3.7 terminology. The WebGL preview is not POV-Ray rendering; some effects are approximated or unavailable. Basic-tab WebGL preview settings and the Advanced-tab POV-Ray profile are managed separately and are not synchronized automatically.",
  "material.capabilityTitle": "POV-Ray material concept catalog",
  "material.capabilityDescription":
    "A support catalog organized by POV-Ray material concept ID. Concepts remain listed even when no value is configured. WebGL preview settings and the POV-Ray profile are managed separately and are not synchronized automatically.",
  "material.keyword": "Concept ID or term",
  "material.notEditable":
    "This concept can remain in the model but is not rendered in the current WebGL preview.",
  "manual.materialStatus":
    "Direct preview, Approximate preview, and Model only (not previewed) describe the relationship to WebGL.",
  "manual.materialAdvanced":
    "Advanced lists POV-Ray Pigment, Normal, Finish, Interior, and Media concepts by concept ID.",
  "manual.materialDisclaimer":
    "The WebGL view is not POV-Ray rendering. WebGL preview settings and the POV-Ray profile are managed separately and are not synchronized automatically.",
};

const overrides: Record<AppLocale, Partial<Record<MessageKey, string>>> = {
  ja: japaneseOverrides,
  en: englishOverrides,
};

export { APP_LOCALES, isAppLocale };
export type { AppLocale, MessageKey };

export function translate(locale: AppLocale, key: MessageKey): string {
  return overrides[locale][key] ?? translateBase(locale, key);
}
