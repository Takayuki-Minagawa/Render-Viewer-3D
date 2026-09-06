import { ImportedInspector } from "./imported-inspector";
import { PrimitiveInspector } from "./primitive-inspector";
import { SceneTreeView } from "./scene-tree-view";
export { createObjectTreeRenderKey } from "./scene-tree-view";
import type { EditorState } from "../app/editor-store";
import type { MaterialDefinitionModel } from "../model/material/material-model";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import { getMaterialSupportStatus } from "./material-library";

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
type ImportedModel = SceneSnapshot["imports"][number];
type MaterialModel = SceneSnapshot["materials"][number];

const MATERIAL_STATUS_LABELS = {
  direct: "material.supportDirect",
  approximate: "material.supportApproximate",
  stored: "material.supportStored",
} as const satisfies Record<string, MessageKey>;

export function createImportedInspectorBuildKey(
  imported: SceneSnapshot["imports"][number],
  materials: SceneSnapshot["materials"],
  locale: AppLocale,
): string {
  return JSON.stringify([
    imported.id,
    locale,
    imported.metadata,
    imported.warnings,
    materials.map(({ id, name }) => [id, name]),
  ]);
}

export class SceneEditorView {
  readonly #importedInspector = new ImportedInspector();
  readonly #primitiveInspector = new PrimitiveInspector();
  readonly #tree: SceneTreeView;
  readonly #root: HTMLElement;
  readonly #inspectorTitle: HTMLElement;
  readonly #inspectorBody: HTMLElement;
  readonly #inspectorBadge: HTMLElement;
  #renderedObjectId: string | null | undefined;
  #renderedGeometryType: GeometryModel["type"] | null = null;
  #renderedMaterialId: string | null = null;
  #renderedImportKey: string | null = null;
  #renderedLocale: AppLocale | undefined;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#tree = new SceneTreeView(root);
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
    const selectedImport = editorState.selectedObjectId
      ? model.imports.find((item) => item.id === editorState.selectedObjectId)
      : undefined;
    const selectedMaterial = selectedObject
      ? model.materials.find((material) => material.id === selectedObject.materialId)
      : undefined;

    this.#tree.render(model, editorState, locale);

    if (selectedImport) {
      const importKey = createImportedInspectorBuildKey(
        selectedImport,
        model.materials,
        locale,
      );
      if (this.#renderedImportKey !== importKey) {
        this.#buildImportedInspector(
          selectedImport,
          model.materials,
          editorState,
          locale,
        );
        this.#renderedImportKey = importKey;
      }
      this.#syncImportedInspector(selectedImport, editorState);
      this.#renderedObjectId = undefined;
      this.#renderedGeometryType = null;
      this.#renderedMaterialId = null;
      this.#renderedLocale = locale;
      return;
    }

    this.#renderedImportKey = null;
    const geometryType = selectedObject?.geometry.type ?? null;
    const materialId = selectedMaterial?.id ?? null;
    if (
      this.#renderedObjectId !== (selectedObject?.id ?? null) ||
      this.#renderedGeometryType !== geometryType ||
      this.#renderedMaterialId !== materialId ||
      this.#renderedLocale !== locale
    ) {
      this.#buildInspector(
        selectedObject,
        selectedMaterial,
        model.objects,
        editorState,
        locale,
      );
      this.#renderedObjectId = selectedObject?.id ?? null;
      this.#renderedGeometryType = geometryType;
      this.#renderedMaterialId = materialId;
      this.#renderedLocale = locale;
    }

    if (selectedObject) {
      this.#syncInspector(
        selectedObject,
        selectedMaterial,
        model.objects,
        editorState,
        locale,
      );
    }
  }

  #buildInspector(
    object: ObjectModel | undefined,
    material: MaterialModel | undefined,
    objects: SceneSnapshot["objects"],
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
      this.#primitiveInspector.createIdentitySection(object, locale),
      this.#primitiveInspector.createTransformSection(object, editorState, locale),
      this.#primitiveInspector.createGeometrySection(object, locale),
      this.#primitiveInspector.createMaterialSection(
        object,
        material,
        objects.filter((candidate) => candidate.materialId === object.materialId).length,
        locale,
      ),
      this.#primitiveInspector.createActionSection(object, locale),
    );
    this.#inspectorBody.replaceChildren(fragment);
  }

  #buildImportedInspector(
    imported: ImportedModel,
    materials: SceneSnapshot["materials"],
    editorState: EditorState,
    locale: AppLocale,
  ): void {
    this.#inspectorTitle.textContent = imported.name;
    this.#inspectorBadge.textContent = translate(locale, "inspector.imported");
    const fragment = document.createDocumentFragment();
    fragment.append(
      this.#primitiveInspector.createIdentitySection(imported, locale),
      this.#primitiveInspector.createTransformSection(imported, editorState, locale),
      this.#importedInspector.createImportedMetadataSection(imported, locale),
      this.#importedInspector.createImportedWarningsSection(imported, locale),
      this.#importedInspector.createImportedMaterialSection(imported, materials, locale),
      this.#importedInspector.createImportedActionSection(imported, locale),
    );
    this.#inspectorBody.replaceChildren(fragment);
  }

  #syncImportedInspector(
    imported: ImportedModel,
    editorState: EditorState,
  ): void {
    this.#inspectorTitle.textContent = imported.name;
    const nameInput = this.#inspectorBody.querySelector<HTMLInputElement>(
      "[data-object-name-input]",
    );
    if (nameInput) this.#syncInput(nameInput, imported.name);
    for (const input of this.#inspectorBody.querySelectorAll<HTMLInputElement>(
      "[data-transform-group][data-axis]",
    )) {
      const group = input.dataset.transformGroup as TransformGroup;
      const axis = input.dataset.axis as TransformAxis;
      this.#syncInput(input, this.#formatNumber(imported.transform[group][axis]));
    }
    for (const button of this.#inspectorBody.querySelectorAll<HTMLButtonElement>(
      "[data-transform-mode]",
    )) {
      const active = button.dataset.transformMode === editorState.transformMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const input of this.#inspectorBody.querySelectorAll<HTMLInputElement>(
      "[data-import-material-mode]",
    )) {
      input.checked = input.value === imported.materialMode;
    }
    const select = this.#inspectorBody.querySelector<HTMLSelectElement>(
      "[data-import-material-select]",
    );
    if (select) {
      select.dataset.importCurrentMode = imported.materialMode;
      if (
        imported.customMaterialId &&
        document.activeElement !== select &&
        select.value !== imported.customMaterialId
      ) {
        select.value = imported.customMaterialId;
      }
    }
    const open = this.#inspectorBody.querySelector<HTMLButtonElement>(
      "[data-open-material-library]",
    );
    if (open && imported.customMaterialId) {
      open.dataset.openMaterialLibrary = imported.customMaterialId;
    }
  }

  #syncInspector(
    object: ObjectModel,
    material: MaterialModel | undefined,
    objects: SceneSnapshot["objects"],
    editorState: EditorState,
    locale: AppLocale,
  ): void {
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

    const swatch = this.#inspectorBody.querySelector<HTMLElement>(
      "[data-inspector-material-swatch]",
    );
    if (swatch && material) swatch.style.backgroundColor = material.preview.baseColor;
    const name = this.#inspectorBody.querySelector<HTMLElement>(
      "[data-inspector-material-name]",
    );
    if (name) name.textContent = material?.name ?? object.materialId;
    const meta = this.#inspectorBody.querySelector<HTMLElement>(
      "[data-inspector-material-meta]",
    );
    if (meta) {
      const status = material ? getMaterialSupportStatus(material) : "stored";
      const usageCount = objects.filter(
        (candidate) => candidate.materialId === object.materialId,
      ).length;
      meta.textContent = `${translate(locale, MATERIAL_STATUS_LABELS[status])} · ${translate(
        locale,
        "material.usedBy",
      )} ${usageCount}`;
    }
  }

  #syncInput(input: HTMLInputElement, value: string): void {
    if (document.activeElement !== input && input.value !== value) input.value = value;
  }

  #formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return String(Number(value.toFixed(4)));
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required editor element not found: ${selector}`);
    return element;
  }
}

export type { MaterialDefinitionModel };
