import type { EditorState, TransformMode } from "../app/editor-store";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import type { GeometryNumericKey, TransformGroup } from "./scene-editor-view";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import { getMaterialSupportStatus } from "./material-library";
type ObjectModel = SceneSnapshot["objects"][number];
type MaterialModel = SceneSnapshot["materials"][number];
type TransformableModel = Pick<ObjectModel, "id" | "name" | "transform">;
const MATERIAL_STATUS_LABELS = { direct: "material.supportDirect", approximate: "material.supportApproximate", stored: "material.supportStored" } as const;
interface GeometryField {
  readonly key: GeometryNumericKey;
  readonly label: MessageKey;
  readonly step: number;
  readonly min: number;
  readonly integer?: boolean;
}

const GEOMETRY_FIELDS: Record<GeometryModel["type"], readonly GeometryField[]> = {
  box: [
    { key: "width", label: "inspector.width", step: 0.1, min: 0.01 },
    { key: "height", label: "inspector.height", step: 0.1, min: 0.01 },
    { key: "depth", label: "inspector.depth", step: 0.1, min: 0.01 },
  ],
  sphere: [
    { key: "radius", label: "inspector.radius", step: 0.1, min: 0.01 },
    {
      key: "widthSegments",
      label: "inspector.widthSegments",
      step: 1,
      min: 3,
      integer: true,
    },
    {
      key: "heightSegments",
      label: "inspector.heightSegments",
      step: 1,
      min: 2,
      integer: true,
    },
  ],
  cylinder: [
    { key: "radiusTop", label: "inspector.radiusTop", step: 0.1, min: 0.01 },
    {
      key: "radiusBottom",
      label: "inspector.radiusBottom",
      step: 0.1,
      min: 0.01,
    },
    { key: "height", label: "inspector.height", step: 0.1, min: 0.01 },
    {
      key: "radialSegments",
      label: "inspector.radialSegments",
      step: 1,
      min: 3,
      integer: true,
    },
  ],
  cone: [
    { key: "radius", label: "inspector.radius", step: 0.1, min: 0.01 },
    { key: "height", label: "inspector.height", step: 0.1, min: 0.01 },
    {
      key: "radialSegments",
      label: "inspector.radialSegments",
      step: 1,
      min: 3,
      integer: true,
    },
  ],
  plane: [
    { key: "width", label: "inspector.width", step: 0.1, min: 0.01 },
    { key: "height", label: "inspector.height", step: 0.1, min: 0.01 },
  ],
  torus: [
    { key: "radius", label: "inspector.radius", step: 0.1, min: 0.01 },
    { key: "tubeRadius", label: "inspector.tubeRadius", step: 0.05, min: 0.01 },
    {
      key: "radialSegments",
      label: "inspector.radialSegments",
      step: 1,
      min: 3,
      integer: true,
    },
    {
      key: "tubularSegments",
      label: "inspector.tubularSegments",
      step: 1,
      min: 3,
      integer: true,
    },
  ],
};

const GEOMETRY_LABELS: Record<GeometryModel["type"], MessageKey> = {
  box: "primitive.box",
  sphere: "primitive.sphere",
  cylinder: "primitive.cylinder",
  cone: "primitive.cone",
  plane: "primitive.plane",
  torus: "primitive.torus",
};

const TRANSFORM_LABELS: Record<TransformMode, MessageKey> = {
  translate: "inspector.modeTranslate",
  rotate: "inspector.modeRotate",
  scale: "inspector.modeScale",
};

/** Builds primitive and shared transform fields; value synchronization stays in the view. */
export class PrimitiveInspector {
  createIdentitySection(object: TransformableModel, locale: AppLocale): HTMLElement {
    const section = this.createSection("inspector.object", locale);
    const label = document.createElement("label");
    label.className = "field-label";
    const text = document.createElement("span");
    text.textContent = translate(locale, "inspector.name");
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = 80;
    input.dataset.objectNameInput = object.id;
    input.value = object.name;
    label.append(text, input);
    section.append(label);
    return section;
  }

  createTransformSection(
    object: TransformableModel,
    editorState: EditorState,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.createSection("inspector.transform", locale);
    const modes = document.createElement("div");
    modes.className = "transform-modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", translate(locale, "inspector.transformMode"));
    const shortcuts: Record<TransformMode, string> = {
      translate: "W",
      rotate: "E",
      scale: "R",
    };
    for (const mode of ["translate", "rotate", "scale"] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-button";
      button.dataset.transformMode = mode;
      button.classList.toggle("is-active", editorState.transformMode === mode);
      button.setAttribute("aria-pressed", String(editorState.transformMode === mode));
      const key = document.createElement("kbd");
      key.textContent = shortcuts[mode];
      const text = document.createElement("span");
      text.textContent = translate(locale, TRANSFORM_LABELS[mode]);
      button.append(key, text);
      modes.append(button);
    }
    section.append(modes);
    section.append(
      this.createVectorInputs(object, "position", "inspector.position", 0.1, locale),
      this.createVectorInputs(
        object,
        "rotationDegrees",
        "inspector.rotation",
        1,
        locale,
      ),
      this.createVectorInputs(object, "scale", "inspector.scale", 0.1, locale),
    );
    return section;
  }

  createVectorInputs(
    object: TransformableModel,
    group: TransformGroup,
    labelKey: MessageKey,
    step: number,
    locale: AppLocale,
  ): HTMLElement {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "vector-fieldset";
    const legend = document.createElement("legend");
    legend.textContent = translate(locale, labelKey);
    const grid = document.createElement("div");
    grid.className = "vector-input-grid";
    for (const axis of ["x", "y", "z"] as const) {
      const label = document.createElement("label");
      const text = document.createElement("span");
      text.textContent = axis.toUpperCase();
      const input = document.createElement("input");
      input.type = "number";
      input.step = String(step);
      input.dataset.objectId = object.id;
      input.dataset.transformGroup = group;
      input.dataset.axis = axis;
      input.value = formatNumber(object.transform[group][axis]);
      label.append(text, input);
      grid.append(label);
    }
    fieldset.append(legend, grid);
    return fieldset;
  }

  createGeometrySection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.createSection("inspector.geometry", locale);
    const type = document.createElement("p");
    type.className = "geometry-type";
    type.textContent = translate(locale, GEOMETRY_LABELS[object.geometry.type]);
    const grid = document.createElement("div");
    grid.className = "geometry-input-grid";
    const geometry = object.geometry as unknown as Record<string, number | string>;
    for (const field of GEOMETRY_FIELDS[object.geometry.type]) {
      const label = document.createElement("label");
      const text = document.createElement("span");
      text.textContent = translate(locale, field.label);
      const input = document.createElement("input");
      input.type = "number";
      input.step = String(field.step);
      input.min = String(field.min);
      input.inputMode = field.integer ? "numeric" : "decimal";
      input.dataset.objectId = object.id;
      input.dataset.geometryKey = field.key;
      input.value = formatNumber(Number(geometry[field.key]));
      label.append(text, input);
      grid.append(label);
    }
    section.append(type, grid);
    return section;
  }

  createMaterialSection(
    object: ObjectModel,
    material: MaterialModel | undefined,
    usageCount: number,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.createSection("inspector.material", locale);
    const card = document.createElement("div");
    card.className = "material-inspector-card";
    const summary = document.createElement("div");
    summary.className = "material-inspector-summary";
    const swatch = document.createElement("span");
    swatch.className = "material-swatch";
    swatch.setAttribute("aria-hidden", "true");
    const fill = document.createElement("i");
    fill.dataset.inspectorMaterialSwatch = "";
    fill.style.backgroundColor = material?.preview.baseColor ?? "#000000";
    swatch.append(fill);
    const copy = document.createElement("span");
    copy.className = "material-inspector-copy";
    const name = document.createElement("strong");
    name.dataset.inspectorMaterialName = "";
    name.textContent = material?.name ?? object.materialId;
    const meta = document.createElement("small");
    meta.dataset.inspectorMaterialMeta = "";
    const status = material ? getMaterialSupportStatus(material) : "stored";
    meta.textContent = `${translate(locale, MATERIAL_STATUS_LABELS[status])} · ${translate(
      locale,
      "material.usedBy",
    )} ${usageCount}`;
    copy.append(name, meta);
    summary.append(swatch, copy);
    const open = document.createElement("button");
    open.type = "button";
    open.dataset.openMaterialLibrary = material?.id ?? object.materialId;
    open.textContent = translate(locale, "inspector.materialOpen");
    card.append(summary, open);
    section.append(card);
    return section;
  }

  createActionSection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.createSection("inspector.actions", locale);
    const actions = document.createElement("div");
    actions.className = "object-actions";
    const duplicate = document.createElement("button");
    duplicate.type = "button";
    duplicate.className = "secondary-action";
    duplicate.dataset.duplicateObject = object.id;
    duplicate.textContent = translate(locale, "inspector.duplicate");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-action";
    remove.dataset.deleteObject = object.id;
    remove.textContent = translate(locale, "inspector.delete");
    remove.setAttribute(
      "aria-label",
      `${translate(locale, "inspector.delete")}: ${object.name}`,
    );
    actions.append(duplicate, remove);
    section.append(actions);
    return section;
  }

  createSection(labelKey: MessageKey, locale: AppLocale): HTMLElement {
    const section = document.createElement("section");
    section.className = "property-section";
    const heading = document.createElement("div");
    heading.className = "property-heading";
    const label = document.createElement("span");
    label.textContent = translate(locale, labelKey);
    const rule = document.createElement("i");
    rule.setAttribute("aria-hidden", "true");
    heading.append(label, rule);
    section.append(heading);
    return section;
  }

}
function formatNumber(value: number): string { return Number.isFinite(value) ? String(Number(value.toFixed(4))) : "0"; }
