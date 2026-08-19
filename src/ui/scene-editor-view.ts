import type { EditorState, TransformMode } from "../app/editor-store";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";

export type TransformGroup = "position" | "rotationDegrees" | "scale";
export type TransformAxis = "x" | "y" | "z";
export type GeometryNumericKey =
  | "width"
  | "height"
  | "depth"
  | "radius"
  | "widthSegments"
  | "heightSegments"
  | "radiusTop"
  | "radiusBottom"
  | "radialSegments"
  | "tubeRadius"
  | "tubularSegments";

type ObjectModel = SceneSnapshot["objects"][number];

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
    {
      key: "radiusTop",
      label: "inspector.radiusTop",
      step: 0.1,
      min: 0.01,
    },
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
    {
      key: "tubeRadius",
      label: "inspector.tubeRadius",
      step: 0.05,
      min: 0.01,
    },
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

export class SceneEditorView {
  readonly #root: HTMLElement;
  readonly #objectList: HTMLElement;
  readonly #lightList: HTMLElement;
  readonly #cameraItem: HTMLElement;
  readonly #objectCount: HTMLElement;
  readonly #lightCount: HTMLElement;
  readonly #inspectorTitle: HTMLElement;
  readonly #inspectorBody: HTMLElement;
  readonly #inspectorBadge: HTMLElement;
  #renderedObjectId: string | null | undefined;
  #renderedGeometryType: GeometryModel["type"] | null = null;
  #renderedLocale: AppLocale | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#objectList = this.#query("[data-object-list]");
    this.#lightList = this.#query("[data-light-list]");
    this.#cameraItem = this.#query("[data-camera-item]");
    this.#objectCount = this.#query("[data-object-count]");
    this.#lightCount = this.#query("[data-light-count]");
    this.#inspectorTitle = this.#query("[data-inspector-title]");
    this.#inspectorBody = this.#query("[data-inspector-body]");
    this.#inspectorBadge = this.#query("[data-inspector-badge]");
  }

  render(
    model: SceneSnapshot,
    editorState: EditorState,
    locale: AppLocale,
  ): void {
    const selectedObject = editorState.selectedObjectId
      ? model.objects.find((item) => item.id === editorState.selectedObjectId)
      : undefined;

    this.#objectCount.textContent = String(model.objects.length);
    this.#lightCount.textContent = String(model.lights.length);
    this.#renderObjects(model.objects, editorState.selectedObjectId, locale);
    this.#renderLights(model.lights, locale);
    this.#renderCamera(model, locale);

    const geometryType = selectedObject?.geometry.type ?? null;
    if (
      this.#renderedObjectId !== (selectedObject?.id ?? null) ||
      this.#renderedGeometryType !== geometryType ||
      this.#renderedLocale !== locale
    ) {
      this.#buildInspector(selectedObject, editorState, locale);
      this.#renderedObjectId = selectedObject?.id ?? null;
      this.#renderedGeometryType = geometryType;
      this.#renderedLocale = locale;
    }

    if (selectedObject) this.#syncInspector(selectedObject, editorState);
  }

  #renderObjects(
    objects: SceneSnapshot["objects"],
    selectedObjectId: string | null,
    locale: AppLocale,
  ): void {
    const fragment = document.createDocumentFragment();
    if (objects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = translate(locale, "scene.noObjects");
      fragment.append(empty);
    }

    for (const object of objects) {
      const row = document.createElement("div");
      row.className = "tree-item";
      row.classList.toggle("is-selected", object.id === selectedObjectId);
      row.classList.toggle("is-muted", !object.visible);

      const select = document.createElement("button");
      select.type = "button";
      select.className = "tree-select";
      select.dataset.objectSelect = object.id;
      select.setAttribute("aria-pressed", String(object.id === selectedObjectId));
      select.setAttribute(
        "aria-label",
        `${translate(locale, "scene.selectObject")}: ${object.name}`,
      );

      const icon = document.createElement("span");
      icon.className = `tree-icon ${this.#geometryIcon(object.geometry.type)}`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = object.name;
      const meta = document.createElement("small");
      meta.textContent = translate(locale, GEOMETRY_LABELS[object.geometry.type]);
      copy.append(name, meta);
      select.append(icon, copy);

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-toggle";
      visibility.dataset.objectVisibility = object.id;
      visibility.dataset.visible = String(object.visible);
      visibility.setAttribute("aria-pressed", String(object.visible));
      visibility.setAttribute(
        "aria-label",
        `${translate(
          locale,
          object.visible ? "scene.hideObject" : "scene.showObject",
        )}: ${object.name}`,
      );
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.classList.toggle("is-off", !object.visible);
      visibility.append(dot);
      row.append(select, visibility);
      fragment.append(row);
    }
    this.#objectList.replaceChildren(fragment);
  }

  #renderLights(lights: SceneSnapshot["lights"], locale: AppLocale): void {
    const fragment = document.createDocumentFragment();
    for (const light of lights) {
      const row = document.createElement("div");
      row.className = "tree-item tree-item-static";
      row.classList.toggle("is-muted", !light.enabled);
      const icon = document.createElement("span");
      icon.className = `tree-icon light-icon${
        light.type === "directional" ? " is-key" : ""
      }`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = light.name;
      const meta = document.createElement("small");
      meta.textContent = translate(
        locale,
        light.type === "ambient" ? "scene.ambientMeta" : "scene.directionalMeta",
      );
      copy.append(name, meta);
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.classList.toggle("is-off", !light.enabled);
      dot.setAttribute(
        "aria-label",
        translate(locale, light.enabled ? "scene.enabled" : "scene.disabled"),
      );
      row.append(icon, copy, dot);
      fragment.append(row);
    }
    this.#lightList.replaceChildren(fragment);
  }

  #renderCamera(model: SceneSnapshot, locale: AppLocale): void {
    const name = this.#cameraItem.querySelector("strong");
    const meta = this.#cameraItem.querySelector("small");
    if (name) name.textContent = translate(locale, "scene.perspective");
    if (meta) {
      meta.textContent = `${model.camera.fov.toFixed(0)}° FOV · ${this.#formatVector(
        model.camera.position,
      )}`;
    }
  }

  #buildInspector(
    object: ObjectModel | undefined,
    editorState: EditorState,
    locale: AppLocale,
  ): void {
    if (!object) {
      this.#inspectorTitle.textContent = translate(
        locale,
        "inspector.noSelectionTitle",
      );
      this.#inspectorBadge.textContent = translate(locale, "inspector.noSelection");
      const empty = document.createElement("div");
      empty.className = "inspector-empty";
      const glyph = document.createElement("span");
      glyph.className = "selection-glyph";
      glyph.setAttribute("aria-hidden", "true");
      const heading = document.createElement("h3");
      heading.textContent = translate(locale, "inspector.selectPromptTitle");
      const body = document.createElement("p");
      body.textContent = translate(locale, "inspector.selectPromptBody");
      empty.append(glyph, heading, body);
      this.#inspectorBody.replaceChildren(empty);
      return;
    }

    this.#inspectorTitle.textContent = object.name;
    this.#inspectorBadge.textContent = translate(locale, "inspector.editing");
    const fragment = document.createDocumentFragment();
    fragment.append(
      this.#createIdentitySection(object, locale),
      this.#createTransformSection(object, editorState, locale),
      this.#createGeometrySection(object, locale),
      this.#createMaterialSection(object, locale),
      this.#createActionSection(object, locale),
    );
    this.#inspectorBody.replaceChildren(fragment);
  }

  #createIdentitySection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.#createSection("inspector.object", locale);
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = translate(locale, "inspector.name");
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = 80;
    input.dataset.objectNameInput = object.id;
    input.value = object.name;
    label.append(input);
    section.append(label);
    return section;
  }

  #createTransformSection(
    object: ObjectModel,
    editorState: EditorState,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.#createSection("inspector.transform", locale);
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
      this.#createVectorInputs(
        object,
        "position",
        "inspector.position",
        0.1,
        locale,
      ),
      this.#createVectorInputs(
        object,
        "rotationDegrees",
        "inspector.rotation",
        1,
        locale,
      ),
      this.#createVectorInputs(
        object,
        "scale",
        "inspector.scale",
        0.1,
        locale,
      ),
    );
    return section;
  }

  #createVectorInputs(
    object: ObjectModel,
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
      const axisLabel = document.createElement("span");
      axisLabel.textContent = axis.toUpperCase();
      const input = document.createElement("input");
      input.type = "number";
      input.step = String(step);
      input.dataset.objectId = object.id;
      input.dataset.transformGroup = group;
      input.dataset.axis = axis;
      input.value = this.#formatNumber(object.transform[group][axis]);
      label.append(axisLabel, input);
      grid.append(label);
    }
    fieldset.append(legend, grid);
    return fieldset;
  }

  #createGeometrySection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.#createSection("inspector.geometry", locale);
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
      input.value = this.#formatNumber(Number(geometry[field.key]));
      label.append(text, input);
      grid.append(label);
    }
    section.append(type, grid);
    return section;
  }

  #createMaterialSection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.#createSection("inspector.material", locale);
    const row = document.createElement("div");
    row.className = "swatch-row";
    const swatch = document.createElement("i");
    swatch.style.backgroundColor = object.material.color;
    const copy = document.createElement("span");
    const color = document.createElement("strong");
    color.dataset.materialColor = "";
    color.textContent = object.material.color.toUpperCase();
    const meta = document.createElement("small");
    meta.textContent = `${translate(locale, "inspector.roughness")} ${this.#formatNumber(
      object.material.roughness,
    )} · ${translate(locale, "inspector.metalness")} ${this.#formatNumber(
      object.material.metalness,
    )}`;
    copy.append(color, meta);
    row.append(swatch, copy);
    section.append(row);
    return section;
  }

  #createActionSection(object: ObjectModel, locale: AppLocale): HTMLElement {
    const section = this.#createSection("inspector.actions", locale);
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

  #createSection(labelKey: MessageKey, locale: AppLocale): HTMLElement {
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

  #syncInspector(object: ObjectModel, editorState: EditorState): void {
    this.#inspectorTitle.textContent = object.name;
    const nameInput = this.#inspectorBody.querySelector<HTMLInputElement>(
      "[data-object-name-input]",
    );
    if (nameInput) this.#syncInput(nameInput, object.name);

    for (const input of this.#inspectorBody.querySelectorAll<HTMLInputElement>(
      "[data-transform-group][data-axis]",
    )) {
      const group = input.dataset.transformGroup as TransformGroup;
      const axis = input.dataset.axis as TransformAxis;
      this.#syncInput(input, this.#formatNumber(object.transform[group][axis]));
    }

    const geometry = object.geometry as unknown as Record<string, number | string>;
    for (const input of this.#inspectorBody.querySelectorAll<HTMLInputElement>(
      "[data-geometry-key]",
    )) {
      const key = input.dataset.geometryKey as GeometryNumericKey;
      this.#syncInput(input, this.#formatNumber(Number(geometry[key])));
    }

    for (const button of this.#inspectorBody.querySelectorAll<HTMLButtonElement>(
      "[data-transform-mode]",
    )) {
      const active = button.dataset.transformMode === editorState.transformMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    const swatch = this.#inspectorBody.querySelector<HTMLElement>(".swatch-row > i");
    if (swatch) swatch.style.backgroundColor = object.material.color;
    const color = this.#inspectorBody.querySelector<HTMLElement>(
      "[data-material-color]",
    );
    if (color) color.textContent = object.material.color.toUpperCase();
  }

  #syncInput(input: HTMLInputElement, value: string): void {
    if (document.activeElement !== input && input.value !== value) input.value = value;
  }

  #geometryIcon(type: GeometryModel["type"]): string {
    switch (type) {
      case "box":
        return "cube-icon";
      case "sphere":
        return "sphere-icon";
      case "cylinder":
        return "cylinder-icon";
      case "cone":
        return "cone-icon";
      case "plane":
        return "plane-icon";
      case "torus":
        return "torus-icon";
    }
  }

  #formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return String(Number(value.toFixed(4)));
  }

  #formatVector(vector: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }): string {
    return `${this.#formatNumber(vector.x)}, ${this.#formatNumber(
      vector.y,
    )}, ${this.#formatNumber(vector.z)}`;
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required editor element not found: ${selector}`);
    return element;
  }
}
