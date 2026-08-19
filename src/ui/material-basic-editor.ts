import type { PhysicalMaterialPreviewModel } from "../model/material/material-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import type { MaterialSnapshot } from "./material-capability-ui";
import "./material-library-warning.css";

export type MaterialPreviewField = keyof PhysicalMaterialPreviewModel;

interface BasicNumberField {
  readonly key: MaterialPreviewField;
  readonly label: MessageKey;
  readonly help: MessageKey;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

export const IOR_PRESETS = [
  { label: "material.iorAir", value: 1 },
  { label: "material.iorWater", value: 1.33 },
  { label: "material.iorAcrylic", value: 1.49 },
  { label: "material.iorGlass", value: 1.5 },
  { label: "material.iorDiamond", value: 2.42 },
] as const satisfies readonly {
  readonly label: MessageKey;
  readonly value: number;
}[];

const BASIC_NUMBER_FIELDS: readonly BasicNumberField[] = [
  numberField("diffuse", "material.diffuse", "material.diffuseHelp"),
  numberField(
    "specularIntensity",
    "material.specular",
    "material.specularHelp",
  ),
  numberField("roughness", "material.roughness", "material.roughnessHelp"),
  numberField("metalness", "material.metallic", "material.metallicHelp"),
  numberField(
    "reflection",
    "material.reflection",
    "material.reflectionHelp",
  ),
  numberField(
    "transmission",
    "material.transmission",
    "material.transmissionHelp",
  ),
  numberField("ior", "material.ior", "material.iorHelp", 1, 2.5, 0.01),
  numberField("opacity", "material.opacity", "material.opacityHelp"),
  numberField(
    "emissiveIntensity",
    "material.emissiveIntensity",
    "material.emissiveIntensityHelp",
    0,
    10,
    0.1,
  ),
];

export function renderMaterialBasicEditor(
  material: MaterialSnapshot,
  locale: AppLocale,
): HTMLElement {
  const editor = element("div", "material-basic-editor");
  const identity = element("section", "material-editor-section");
  const nameLabel = element("label", "field-label");
  nameLabel.append(textElement("span", translate(locale, "material.renameLabel")));
  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 80;
  name.autocomplete = "off";
  name.value = material.name;
  name.dataset.renameMaterial = material.id;
  nameLabel.append(name);
  identity.append(nameLabel);

  const colors = element("section", "material-editor-section material-color-grid");
  colors.append(
    colorField(material, locale, "baseColor", "material.baseColor"),
    colorField(material, locale, "emissiveColor", "material.emissiveColor"),
  );

  const numbers = element(
    "section",
    "material-editor-section material-number-stack",
  );
  for (const field of BASIC_NUMBER_FIELDS) {
    numbers.append(numberInputField(material, locale, field));
    if (field.key === "ior") numbers.append(iorPresets(material, locale));
  }

  const toggles = element(
    "section",
    "material-editor-section material-toggle-grid",
  );
  toggles.append(
    toggle(material, locale, "transparent", "material.transparent"),
    toggle(material, locale, "doubleSided", "material.sideDouble"),
    toggle(material, locale, "wireframe", "material.wireframe"),
  );
  editor.append(identity, colors, numbers, toggles);
  return editor;
}

function colorField(
  material: MaterialSnapshot,
  locale: AppLocale,
  field: "baseColor" | "emissiveColor",
  labelKey: MessageKey,
): HTMLElement {
  const wrapper = element("fieldset", "material-color-field");
  wrapper.append(textElement("legend", translate(locale, labelKey)));
  const controls = document.createElement("div");
  const color = document.createElement("input");
  color.type = "color";
  color.dataset.materialPreviewId = material.id;
  color.dataset.materialPreviewField = field;
  color.setAttribute("aria-label", translate(locale, labelKey));
  const text = document.createElement("input");
  text.type = "text";
  text.pattern = "#[0-9a-fA-F]{6}";
  text.maxLength = 7;
  text.dataset.materialPreviewId = material.id;
  text.dataset.materialPreviewField = field;
  text.setAttribute("aria-label", translate(locale, "material.colorValueLabel"));
  controls.append(color, text);
  wrapper.append(controls);
  return wrapper;
}

function numberInputField(
  material: MaterialSnapshot,
  locale: AppLocale,
  field: BasicNumberField,
): HTMLElement {
  const wrapper = element("div", "material-number-field");
  const copy = document.createElement("div");
  const id = `material-${material.id}-${field.key}`;
  const label = textElement("label", translate(locale, field.label));
  label.setAttribute("for", `${id}-number`);
  const help = textElement("small", translate(locale, field.help));
  help.id = `${id}-help`;
  copy.append(label, help);
  const controls = element("div", "material-number-controls");
  for (const type of ["range", "number"] as const) {
    const input = document.createElement("input");
    input.type = type;
    input.min = String(field.minimum);
    input.max = String(field.maximum);
    input.step = String(field.step);
    input.dataset.materialPreviewId = material.id;
    input.dataset.materialPreviewField = field.key;
    input.setAttribute("aria-describedby", help.id);
    if (type === "range") {
      input.setAttribute("aria-label", translate(locale, field.label));
    } else {
      input.id = `${id}-number`;
      input.inputMode = "decimal";
    }
    controls.append(input);
  }
  wrapper.append(copy, controls);
  return wrapper;
}

function iorPresets(
  material: MaterialSnapshot,
  locale: AppLocale,
): HTMLElement {
  const presets = element("div", "ior-presets");
  presets.setAttribute("role", "group");
  presets.setAttribute("aria-label", translate(locale, "material.iorPresets"));
  for (const { label, value } of IOR_PRESETS) {
    const button = textElement(
      "button",
      `${translate(locale, label)} ${value}`,
    );
    button.setAttribute("type", "button");
    button.dataset.materialPreviewId = material.id;
    button.dataset.materialPreviewField = "ior";
    button.dataset.materialPreviewValue = String(value);
    presets.append(button);
  }
  const warning = textElement(
    "small",
    locale === "ja"
      ? "2.333を超える値もモデルへ保持されますが、WebGLプレビューでは2.333に制限して近似表示します。"
      : "Values above 2.333 remain in the model, while the WebGL preview clamps them to 2.333 for approximation.",
  );
  warning.className = "material-inline-warning";
  warning.dataset.iorPreviewWarning = "";
  presets.append(warning);
  return presets;
}

function toggle(
  material: MaterialSnapshot,
  locale: AppLocale,
  field: "transparent" | "doubleSided" | "wireframe",
  labelKey: MessageKey,
): HTMLElement {
  const label = element("label", "material-toggle");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.materialPreviewId = material.id;
  input.dataset.materialPreviewField = field;
  label.append(input, textElement("span", translate(locale, labelKey)));
  return label;
}

function numberField(
  key: MaterialPreviewField,
  label: MessageKey,
  help: MessageKey,
  minimum = 0,
  maximum = 1,
  step = 0.01,
): BasicNumberField {
  return { key, label, help, minimum, maximum, step };
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className: string,
): HTMLElementTagNameMap[Tag] {
  const value = document.createElement(tag);
  value.className = className;
  return value;
}

function textElement<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  value: string,
): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}
