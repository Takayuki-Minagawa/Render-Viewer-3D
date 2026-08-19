import { MATERIAL_TEXTURE_FILE_ACCEPT } from "../model/material/material-color-map";
import type {
  MaterialColorMapField,
  PhysicalMaterialPreviewModel,
} from "../model/material/material-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import type { MaterialSnapshot } from "./material-capability-ui";
import "./material-library-warning.css";

export type MaterialPreviewField = keyof PhysicalMaterialPreviewModel;

export type MaterialTextureUiStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "success" }
  | { readonly kind: "error"; readonly detail: MessageKey };

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
  textureStatus: MaterialTextureUiStatus = { kind: "idle" },
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
  editor.append(
    identity,
    colors,
    renderMaterialColorMapEditor(material, locale, textureStatus),
    numbers,
    toggles,
  );
  return editor;
}

export function syncMaterialTextureStatus(
  root: ParentNode,
  materialId: string,
  locale: AppLocale,
  status: MaterialTextureUiStatus,
): void {
  const section = [...root.querySelectorAll<HTMLElement>(
    "[data-material-texture-section]",
  )].find((candidate) => candidate.dataset.materialTextureSection === materialId);
  const message = [...root.querySelectorAll<HTMLElement>(
    "[data-material-texture-status]",
  )].find((candidate) => candidate.dataset.materialTextureStatus === materialId);
  if (!section || !message) return;

  section.setAttribute("aria-busy", String(status.kind === "busy"));
  message.hidden = status.kind === "idle";
  message.dataset.kind = status.kind;
  message.setAttribute("role", status.kind === "error" ? "alert" : "status");
  if (status.kind === "idle") {
    message.textContent = "";
    return;
  }
  const key =
    status.kind === "busy"
      ? "material.textureBusy"
      : status.kind === "success"
        ? "material.textureSuccess"
        : "material.textureError";
  message.textContent =
    translate(locale, key) +
    (status.kind === "error" ? " " + translate(locale, status.detail) : "");
}

function renderMaterialColorMapEditor(
  material: MaterialSnapshot,
  locale: AppLocale,
  status: MaterialTextureUiStatus,
): HTMLElement {
  const colorMap = material.colorMap;
  const section = element("section", "material-editor-section material-texture-editor");
  section.dataset.materialTextureSection = material.id;

  const heading = textElement("h4", translate(locale, "material.textureTitle"));
  const description = textElement(
    "p",
    translate(locale, "material.textureDescription"),
  );
  description.className = "material-texture-description";

  const pickerRow = element("div", "material-texture-picker");
  const picker = element("label", "material-texture-picker-button");
  const input = document.createElement("input");
  input.type = "file";
  input.accept = MATERIAL_TEXTURE_FILE_ACCEPT;
  input.className = "visually-hidden";
  input.dataset.materialTextureInput = material.id;
  input.setAttribute(
    "aria-label",
    translate(
      locale,
      colorMap ? "material.textureReplace" : "material.textureChoose",
    ),
  );
  picker.append(
    input,
    textElement(
      "span",
      translate(
        locale,
        colorMap ? "material.textureReplace" : "material.textureChoose",
      ),
    ),
  );

  const remove = textElement(
    "button",
    translate(locale, "material.textureRemove"),
  );
  remove.type = "button";
  remove.className = "secondary-action";
  remove.dataset.removeMaterialColorMap = material.id;
  remove.disabled = !colorMap;
  pickerRow.append(picker, remove);

  const metadata = element("div", "material-texture-metadata");
  metadata.hidden = !colorMap;
  if (colorMap) {
    metadata.append(
      textElement("strong", colorMap.sourceName),
      textElement(
        "small",
        colorMap.width +
          " × " +
          colorMap.height +
          " px · " +
          formatFileSize(colorMap.byteSize, locale),
      ),
    );
  }

  const mapping = element("fieldset", "material-texture-mapping");
  mapping.disabled = !colorMap;
  mapping.append(
    textElement("legend", translate(locale, "material.textureMapping")),
    mappingNumberField(
      material.id,
      locale,
      "repeatX",
      "material.textureRepeatX",
      0.01,
      1000,
      0.01,
    ),
    mappingNumberField(
      material.id,
      locale,
      "repeatY",
      "material.textureRepeatY",
      0.01,
      1000,
      0.01,
    ),
    mappingNumberField(
      material.id,
      locale,
      "offsetX",
      "material.textureOffsetX",
      -1000,
      1000,
      0.01,
    ),
    mappingNumberField(
      material.id,
      locale,
      "offsetY",
      "material.textureOffsetY",
      -1000,
      1000,
      0.01,
    ),
    mappingNumberField(
      material.id,
      locale,
      "rotationDegrees",
      "material.textureRotation",
      -360000,
      360000,
      1,
    ),
    mappingWrapField(material.id, locale),
  );
  mapping.hidden = !colorMap;

  const help = textElement("small", translate(locale, "material.textureHelp"));
  help.className = "material-inline-warning";
  const message = document.createElement("p");
  message.dataset.materialTextureStatus = material.id;
  message.className = "material-texture-status";
  message.setAttribute("aria-live", "polite");
  section.append(heading, description, pickerRow, metadata, mapping, help, message);
  syncMaterialTextureStatus(section, material.id, locale, status);
  return section;
}

function mappingNumberField(
  materialId: string,
  locale: AppLocale,
  field: Exclude<MaterialColorMapField, "wrapMode">,
  labelKey: MessageKey,
  minimum: number,
  maximum: number,
  step: number,
): HTMLElement {
  const label = element("label", "material-texture-field");
  label.append(textElement("span", translate(locale, labelKey)));
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
  input.inputMode = "decimal";
  input.dataset.materialColorMapId = materialId;
  input.dataset.materialColorMapField = field;
  label.append(input);
  return label;
}

function mappingWrapField(
  materialId: string,
  locale: AppLocale,
): HTMLElement {
  const label = element("label", "material-texture-field");
  label.append(textElement("span", translate(locale, "material.textureWrap")));
  const select = document.createElement("select");
  select.dataset.materialColorMapId = materialId;
  select.dataset.materialColorMapField = "wrapMode";
  for (const [value, key] of [
    ["repeat", "material.textureWrapRepeat"],
    ["clamp-to-edge", "material.textureWrapClamp"],
    ["mirrored-repeat", "material.textureWrapMirror"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = translate(locale, key);
    select.append(option);
  }
  label.append(select);
  return label;
}

function formatFileSize(bytes: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: bytes >= 1024 * 1024 ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024));
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
