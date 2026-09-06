import { cameraDisplay } from "./camera-display";
import { bindEditTransactions, type EditTransactionActions } from "./edit-transaction-controller";
import { handleEditorShortcut } from "./shortcut-controller";
import { appShellTemplate } from "./app-shell-template";
import { ImportDialogController } from "./import-dialog-controller";
export { runImportActionSafely, type ImportActionResult } from "./import-dialog-controller";
import type { ImportOptions } from "../importers";
import type { EditorState, TransformMode } from "../app/editor-store";
import type { ImportedMaterialMode } from "../model/imported-scene-model";
import type {
  MaterialColorMapField,
  MaterialPresetId,
} from "../model/material/material-model";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import {
  loadAppPreferences,
  saveAppPreferences,
  toggleLocale,
  toggleTheme,
  type AppPreferences,
} from "./app-preferences";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import {
  MaterialLibraryView,
  type MaterialPreviewField,
  type MaterialObjectAssignment,
} from "./material-library";
import {
  SceneEditorView,
  type GeometryNumericKey,
  type TransformAxis,
  type TransformGroup,
} from "./scene-editor-view";

export interface AppActions extends EditTransactionActions {
  toggleGrid: () => void;
  toggleAxes: () => void;
  resetCamera: () => void;
  importFiles: (files: readonly File[], options: ImportOptions) => Promise<void>;
  attachMaterialColorMap: (materialId: string, file: File) => Promise<void>;
  updateMaterialColorMap: (
    materialId: string,
    field: MaterialColorMapField,
    value: unknown,
  ) => void;
  removeMaterialColorMap: (materialId: string) => void;
  setImportedMaterialMode: (
    id: string,
    mode: ImportedMaterialMode,
    customMaterialId: string | null,
  ) => void;
  addObject: (primitive: GeometryModel["type"]) => void;
  selectObject: (id: string | null) => void;
  selectImportedNode?: (importId: string, nodeId: string) => void;
  setObjectVisibility: (id: string, visible: boolean) => void;
  updateObjectName: (id: string, name: string) => void;
  updateObjectTransform: (
    id: string,
    group: TransformGroup,
    axis: TransformAxis,
    value: number,
  ) => void;
  updateObjectGeometry: (
    id: string,
    key: GeometryNumericKey,
    value: number,
  ) => void;
  duplicateObject: (id: string) => void;
  deleteObject: (id: string) => void;
  setTransformMode: (mode: TransformMode) => void;
  createMaterialFromPreset: (presetId: MaterialPresetId) => void;
  assignMaterial: (objectId: string, materialId: string) => void;
  duplicateMaterial: (materialId: string) => void;
  renameMaterial: (materialId: string, name: string) => void;
  deleteMaterial: (materialId: string) => void;
  makeMaterialUnique: (objectId: string) => void;
  updateMaterialPreview: (
    materialId: string,
    field: MaterialPreviewField,
    value: unknown,
  ) => void;
  updateMaterialPovScalar: (
    materialId: string,
    path: string,
    value: number,
  ) => void;
}

export type { GeometryNumericKey, TransformAxis, TransformGroup };

type UiStatus = "initializing" | "ready" | "error";
const GEOMETRY_TYPES = new Set<GeometryModel["type"]>([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "torus",
]);
const MATERIAL_PRESETS = new Set<MaterialPresetId>([
  "concrete",
  "matte-plastic",
  "glossy-plastic",
  "metal",
  "glass",
  "frosted-glass",
  "matte",
  "wood-base",
]);
const TRANSFORM_MODES = new Set<TransformMode>([
  "translate",
  "rotate",
  "scale",
]);
const MATERIAL_COLOR_MAP_FIELDS = new Set<MaterialColorMapField>([
  "repeatX",
  "repeatY",
  "offsetX",
  "offsetY",
  "rotationDegrees",
  "wrapMode",
]);
const MATERIAL_TEXTURE_ERROR_MESSAGES = new Map<string, MessageKey>([
  ["empty-file", "material.textureErrorEmpty"],
  ["file-too-large", "material.textureErrorTooLarge"],
  ["dimensions-too-large", "material.textureErrorTooLarge"],
  ["mime-mismatch", "material.textureErrorMimeMismatch"],
  ["animated-image", "material.textureErrorAnimated"],
  ["unsupported-format", "material.textureErrorUnsupported"],
  ["invalid-header", "material.textureErrorInvalid"],
  ["decode-failed", "material.textureErrorInvalid"],
  ["decoded-dimensions-invalid", "material.textureErrorInvalid"],
  ["resident-limit", "material.textureErrorMemory"],
  ["decoder-unavailable", "material.textureErrorDecoder"],
  ["material-missing", "material.textureErrorMaterialMissing"],
  ["disposed", "material.textureErrorInterrupted"],
]);

export function materialTextureErrorDetail(
  error: unknown,
  locale: AppLocale,
): string {
  return translate(locale, materialTextureErrorMessageKey(error));
}

export function materialTextureErrorMessageKey(error: unknown): MessageKey {
  let code: unknown;
  if (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) {
    try {
      code = Reflect.get(error, "code");
    } catch {
      code = undefined;
    }
  }
  const key =
    typeof code === "string"
      ? MATERIAL_TEXTURE_ERROR_MESSAGES.get(code)
      : undefined;
  return key ?? "material.textureErrorUnknown";
}

const TRANSFORM_GROUPS = new Set<TransformGroup>([
  "position",
  "rotationDegrees",
  "scale",
]);
const TRANSFORM_AXES = new Set<TransformAxis>(["x", "y", "z"]);
const GEOMETRY_KEYS = new Set<GeometryNumericKey>([
  "width",
  "height",
  "depth",
  "radius",
  "widthSegments",
  "heightSegments",
  "radiusTop",
  "radiusBottom",
  "radialSegments",
  "tubeRadius",
  "tubularSegments",
]);
const DEFAULT_EDITOR_STATE: EditorState = {
  selectedObjectId: null,
  transformMode: "translate",
};

export class AppShell {
  readonly viewportElement: HTMLElement;
  readonly #root: HTMLElement;
  readonly #abortController = new AbortController();
  readonly #gridButton: HTMLButtonElement;
  readonly #axesButton: HTMLButtonElement;
  readonly #languageButton: HTMLButtonElement;
  readonly #themeButton: HTMLButtonElement;
  readonly #manualDialog: HTMLDialogElement;
  readonly #loadingElement: HTMLElement;
  readonly #statusText: HTMLElement;
  readonly #importController: ImportDialogController;
  readonly #editorView: SceneEditorView;
  readonly #materialLibrary: MaterialLibraryView;
  #preferences: AppPreferences;
  #status: UiStatus = "initializing";
  #disposed = false;
  readonly #materialTextureGenerations = new Map<string, number>();
  #model: SceneSnapshot | undefined;
  #assignmentObjects: SceneSnapshot["objects"] | undefined;
  #assignmentImports: SceneSnapshot["imports"] | undefined;
  #materialAssignments: MaterialObjectAssignment[] = [];
  #editorState: EditorState = DEFAULT_EDITOR_STATE;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#preferences = loadAppPreferences();
    this.#root.innerHTML = appShellTemplate();
    this.viewportElement = this.#query("[data-viewport]");
    this.#gridButton = this.#query("[data-action='grid']");
    this.#axesButton = this.#query("[data-action='axes']");
    this.#languageButton = this.#query("[data-action='language']");
    this.#themeButton = this.#query("[data-action='theme']");
    this.#manualDialog = this.#query("[data-manual-dialog]");
    this.#loadingElement = this.#query("[data-loading]");
    this.#statusText = this.#query("[data-status]");
    this.#importController = new ImportDialogController(root, this.viewportElement);
    this.#editorView = new SceneEditorView(this.#root);
    this.#materialLibrary = new MaterialLibraryView(this.#root);
    this.#applyPreferences();
  }

  bindActions(actions: AppActions): void {
    const options = { signal: this.#abortController.signal };
    bindEditTransactions(this.#root, actions, options.signal);
    this.#gridButton.addEventListener("click", actions.toggleGrid, options);
    this.#axesButton.addEventListener("click", actions.toggleAxes, options);
    this.#query<HTMLButtonElement>("[data-action='reset']").addEventListener(
      "click",
      actions.resetCamera,
      options,
    );
    this.#importController.bind(actions, options);
    this.#languageButton.addEventListener(
      "click",
      () => this.#setLocale(toggleLocale(this.#preferences.locale)),
      options,
    );
    this.#themeButton.addEventListener(
      "click",
      () => this.#setTheme(toggleTheme(this.#preferences.theme)),
      options,
    );
    this.#query<HTMLButtonElement>("[data-action='manual']").addEventListener(
      "click",
      () => this.#manualDialog.showModal(),
      options,
    );
    this.#manualDialog.addEventListener(
      "click",
      (event) => {
        if (event.target === this.#manualDialog) this.#manualDialog.close();
      },
      options,
    );
    this.#root.addEventListener(
      "click",
      (event) => this.#handleEditorClick(event, actions),
      options,
    );
    this.#root.addEventListener(
      "input",
      (event) => this.#handleEditorInput(event, actions),
      options,
    );
    this.#root.addEventListener(
      "change",
      (event) => this.#handleEditorChange(event, actions),
      options,
    );
    this.#root.addEventListener(
      "keydown",
      (event) => this.#materialLibrary.handleUiKeydown(event),
      options,
    );
    this.#root.addEventListener(
      "focusout",
      (event) => this.#handleEditorFocusOut(event),
      options,
    );
    document.addEventListener(
      "keydown",
      (event) => handleEditorShortcut(event, actions, {
        dialogOpen: this.#manualDialog.open || this.#importController.isOpen || this.#materialLibrary.isOpen,
        editorState: this.#editorState,
        model: this.#model,
      }),
      options,
    );
  }

  update(
    model: SceneSnapshot,
    editorState: EditorState = this.#editorState,
  ): void {
    this.#model = model;
    this.#editorState = editorState;
    this.#setPressed(this.#gridButton, model.helpers.gridVisible);
    this.#setPressed(this.#axesButton, model.helpers.axesVisible);
    this.#query("[data-scene-name]").textContent = model.name;
    this.#renderEditor();
  }

  updateEditorState(editorState: EditorState): void {
    this.#editorState = editorState;
    this.#renderEditor();
  }

  refreshPreferences(): void {
    this.#applyPreferences();
  }

  setReady(): void {
    this.#status = "ready";
    this.#loadingElement.classList.add("is-hidden");
    this.#renderStatus();
  }

  setError(message?: string): void {
    this.#status = "error";
    this.#loadingElement.classList.remove("is-hidden");
    this.#loadingElement.classList.add("is-error");
    this.#loadingElement.textContent =
      message ?? translate(this.#preferences.locale, "error.webgl");
    this.#renderStatus();
  }

  dispose(): void {
    this.#disposed = true;
    this.#abortController.abort();
    this.#importController.dispose();
    this.#root.replaceChildren();
  }

  #renderEditor(): void {
    if (!this.#model) return;
    const camera = cameraDisplay(this.#model.camera, this.#preferences.locale);
    this.#query("[data-view-projection]").textContent = camera.label;
    this.#query("[data-view-fov]").textContent = camera.scale;
    this.#editorView.render(
      this.#model,
      this.#editorState,
      this.#preferences.locale,
    );
    if (this.#assignmentObjects !== this.#model.objects || this.#assignmentImports !== this.#model.imports) {
      this.#assignmentObjects = this.#model.objects;
      this.#assignmentImports = this.#model.imports;
      this.#materialAssignments = [
      ...this.#model.objects.map(({ id, name, materialId }) => ({
        id,
        name,
        materialId,
      })),
      ...this.#model.imports.flatMap((imported) => Object.entries(imported.nodeOverrides ?? {}).flatMap(([nodeId, override]) => override.materialId ? [{ id: `${imported.id}/${nodeId}`, name: `${imported.name} / ${nodeId}`, materialId: override.materialId }] : [])),
      ...this.#model.imports.flatMap((imported) =>
        imported.customMaterialId
          ? [
              {
                id: imported.id,
                name: imported.name,
                materialId: imported.customMaterialId,
              },
            ]
          : [],
      ),
    ];
    }
    this.#materialLibrary.render(
      this.#model.materials,
      this.#materialAssignments,
      this.#model.objects.some(
        ({ id }) => id === this.#editorState.selectedObjectId,
      )
        ? this.#editorState.selectedObjectId
        : null,
      this.#preferences.locale,
    );
  }

  #handleEditorClick(event: MouseEvent, actions: AppActions): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (this.#materialLibrary.handleUiClick(target)) return;

    const openMaterial = target.closest<HTMLElement>(
      "[data-open-material-library]",
    );
    if (openMaterial) {
      this.#materialLibrary.open(openMaterial.dataset.openMaterialLibrary);
      return;
    }

    if (target.closest("[data-create-material-from-preset]")) {
      const presetId = this.#materialLibrary.selectedPresetId;
      if (this.#isMaterialPreset(presetId)) {
        actions.createMaterialFromPreset(presetId);
      }
      return;
    }

    const assignMaterialId = target.closest<HTMLElement>("[data-assign-material]")
      ?.dataset.assignMaterial;
    if (assignMaterialId && this.#editorState.selectedObjectId) {
      actions.assignMaterial(this.#editorState.selectedObjectId, assignMaterialId);
      return;
    }

    const duplicateMaterialId = target.closest<HTMLElement>(
      "[data-duplicate-material]",
    )?.dataset.duplicateMaterial;
    if (duplicateMaterialId) {
      actions.duplicateMaterial(duplicateMaterialId);
      return;
    }

    const deleteMaterialId = target.closest<HTMLElement>(
      "[data-delete-material]",
    )?.dataset.deleteMaterial;
    if (deleteMaterialId) {
      actions.deleteMaterial(deleteMaterialId);
      return;
    }

    const makeUniqueObjectId = target.closest<HTMLElement>(
      "[data-make-material-unique]",
    )?.dataset.makeMaterialUnique;
    if (makeUniqueObjectId) {
      actions.makeMaterialUnique(makeUniqueObjectId);
      return;
    }

    const removeColorMapId = target.closest<HTMLElement>(
      "[data-remove-material-color-map]",
    )?.dataset.removeMaterialColorMap;
    if (removeColorMapId) {
      this.#nextMaterialTextureGeneration(removeColorMapId);
      actions.removeMaterialColorMap(removeColorMapId);
      this.#materialLibrary.setTextureStatus(removeColorMapId, { kind: "idle" });
      queueMicrotask(() =>
        this.#root
          .querySelector<HTMLInputElement>("[data-material-texture-input]")
          ?.focus(),
      );
      return;
    }

    const previewPreset = target.closest<HTMLElement>(
      "[data-material-preview-value]",
    );
    const previewValue = Number(previewPreset?.dataset.materialPreviewValue);
    const previewId = previewPreset?.dataset.materialPreviewId;
    const previewField = previewPreset?.dataset
      .materialPreviewField as MaterialPreviewField | undefined;
    if (previewId && previewField && Number.isFinite(previewValue)) {
      actions.updateMaterialPreview(previewId, previewField, previewValue);
      return;
    }

    const addButton = target.closest<HTMLButtonElement>("[data-add-primitive]");
    const primitive = addButton?.dataset.addPrimitive;
    if (addButton && this.#isGeometryType(primitive)) {
      actions.addObject(primitive);
      addButton.closest("details")?.removeAttribute("open");
      return;
    }

    const visibilityButton = target.closest<HTMLButtonElement>(
      "[data-object-visibility]",
    );
    const visibilityId = visibilityButton?.dataset.objectVisibility;
    if (visibilityButton && visibilityId) {
      actions.setObjectVisibility(
        visibilityId,
        visibilityButton.dataset.visible !== "true",
      );
      return;
    }

    const selectButton = target.closest<HTMLButtonElement>("[data-object-select]");
    const selectedId = selectButton?.dataset.objectSelect;
    if (selectButton && selectedId) {
      actions.selectObject(selectedId);
      if (selectButton.dataset.importedNodeSelect) actions.selectImportedNode?.(selectedId, selectButton.dataset.importedNodeSelect);
      return;
    }

    const modeButton = target.closest<HTMLButtonElement>("[data-transform-mode]");
    const mode = modeButton?.dataset.transformMode;
    if (modeButton && this.#isTransformMode(mode)) {
      actions.setTransformMode(mode);
      return;
    }

    const duplicateButton = target.closest<HTMLButtonElement>(
      "[data-duplicate-object]",
    );
    const duplicateId = duplicateButton?.dataset.duplicateObject;
    if (duplicateButton && duplicateId) {
      actions.duplicateObject(duplicateId);
      return;
    }

    const deleteButton = target.closest<HTMLButtonElement>("[data-delete-object]");
    const deleteId = deleteButton?.dataset.deleteObject;
    if (deleteButton && deleteId) actions.deleteObject(deleteId);
  }

  #handleEditorInput(event: Event, actions: AppActions): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) {
      return;
    }
    const colorMapId = input.dataset.materialColorMapId;
    const colorMapField = input.dataset
      .materialColorMapField as MaterialColorMapField | undefined;
    if (
      colorMapId &&
      colorMapField &&
      MATERIAL_COLOR_MAP_FIELDS.has(colorMapField)
    ) {
      const value =
        colorMapField === "wrapMode"
          ? input.value
          : input instanceof HTMLInputElement
            ? input.valueAsNumber
            : Number.NaN;
      if (typeof value === "string" || Number.isFinite(value)) {
        actions.updateMaterialColorMap(colorMapId, colorMapField, value);
      }
      return;
    }
    if (this.#materialLibrary.handleUiInput(input)) return;

    const importMaterialSelect = input.dataset.importMaterialSelect;
    if (importMaterialSelect && input instanceof HTMLSelectElement) {
      const mode = input.dataset.importCurrentMode;
      if (this.#isImportedMaterialMode(mode)) {
        actions.setImportedMaterialMode(importMaterialSelect, mode, input.value);
      }
      return;
    }

    if (input instanceof HTMLInputElement) {
      const importMaterialModeId = input.dataset.importMaterialMode;
      if (
        importMaterialModeId &&
        input.type === "radio" &&
        input.checked &&
        this.#isImportedMaterialMode(input.value)
      ) {
        const materialSelect = this.#findImportMaterialSelect(importMaterialModeId);
        actions.setImportedMaterialMode(
          importMaterialModeId,
          input.value,
          materialSelect?.value || null,
        );
        return;
      }

      const renameMaterialId = input.dataset.renameMaterial;
      if (renameMaterialId) {
        actions.renameMaterial(renameMaterialId, input.value);
        return;
      }

      const materialId = input.dataset.materialPreviewId;
      const materialField = input.dataset
        .materialPreviewField as MaterialPreviewField | undefined;
      if (materialId && materialField) {
        const value =
          input.type === "checkbox"
            ? input.checked
            : input.type === "number" || input.type === "range"
              ? input.valueAsNumber
              : input.value;
        if (typeof value !== "number" || Number.isFinite(value)) {
          actions.updateMaterialPreview(materialId, materialField, value);
        }
        return;
      }

      const materialPovId = input.dataset.materialPovId;
      const materialPovPath = input.dataset.materialPovPath;
      if (
        materialPovId &&
        materialPovPath &&
        Number.isFinite(input.valueAsNumber)
      ) {
        actions.updateMaterialPovScalar(
          materialPovId,
          materialPovPath,
          input.valueAsNumber,
        );
        return;
      }

      const nameId = input.dataset.objectNameInput;
      if (nameId) {
        actions.updateObjectName(nameId, input.value);
        return;
      }

      const objectId = input.dataset.objectId;
      if (!objectId || !Number.isFinite(input.valueAsNumber)) return;

      const group = input.dataset.transformGroup;
      const axis = input.dataset.axis;
      if (this.#isTransformGroup(group) && this.#isTransformAxis(axis)) {
        actions.updateObjectTransform(objectId, group, axis, input.valueAsNumber);
        return;
      }

      const geometryKey = input.dataset.geometryKey;
      if (this.#isGeometryKey(geometryKey)) {
        actions.updateObjectGeometry(objectId, geometryKey, input.valueAsNumber);
      }
    }
  }

  #handleEditorChange(event: Event, actions: AppActions): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const materialId = input.dataset.materialTextureInput;
    if (!materialId || input.type !== "file") return;

    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const generation = this.#nextMaterialTextureGeneration(materialId);
    this.#materialLibrary.setTextureStatus(materialId, { kind: "busy" });
    void this.#runMaterialTextureAction(
      materialId,
      file,
      generation,
      actions,
    );
  }

  async #runMaterialTextureAction(
    materialId: string,
    file: File,
    generation: number,
    actions: AppActions,
  ): Promise<void> {
    try {
      await actions.attachMaterialColorMap(materialId, file);
      if (
        this.#disposed ||
        this.#materialTextureGenerations.get(materialId) !== generation
      ) {
        return;
      }
      this.#materialLibrary.setTextureStatus(materialId, { kind: "success" });
    } catch (error) {
      if (
        this.#disposed ||
        this.#materialTextureGenerations.get(materialId) !== generation
      ) {
        return;
      }
      console.error("Material texture loading failed.", error);
      this.#materialLibrary.setTextureStatus(materialId, {
        kind: "error",
        detail: materialTextureErrorMessageKey(error),
      });
    }
  }

  #nextMaterialTextureGeneration(materialId: string): number {
    const next = (this.#materialTextureGenerations.get(materialId) ?? 0) + 1;
    this.#materialTextureGenerations.set(materialId, next);
    return next;
  }

  #handleEditorFocusOut(event: FocusEvent): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (this.#materialLibrary.handleUiFocusOut(input) || !this.#model) return;

    const nameId = input.dataset.objectNameInput;
    if (nameId) {
      const object =
        this.#model.objects.find((item) => item.id === nameId) ??
        this.#model.imports.find((item) => item.id === nameId);
      if (object) input.value = object.name;
      return;
    }

    const objectId = input.dataset.objectId;
    if (!objectId) return;
    const primitive = this.#model.objects.find((item) => item.id === objectId);
    const object =
      primitive ?? this.#model.imports.find((item) => item.id === objectId);
    if (!object) return;

    const group = input.dataset.transformGroup;
    const axis = input.dataset.axis;
    if (this.#isTransformGroup(group) && this.#isTransformAxis(axis)) {
      input.value = formatEditorNumber(object.transform[group][axis]);
      return;
    }

    const geometryKey = input.dataset.geometryKey;
    if (!primitive) return;
    if (this.#isGeometryKey(geometryKey)) {
      const geometry = primitive.geometry as unknown as Record<
        string,
        number | string
      >;
      input.value = formatEditorNumber(Number(geometry[geometryKey]));
    }
  }

  #findImportMaterialSelect(id: string): HTMLSelectElement | undefined {
    return Array.from(
      this.#root.querySelectorAll<HTMLSelectElement>(
        "[data-import-material-select]",
      ),
    ).find((select) => select.dataset.importMaterialSelect === id);
  }

  #isGeometryType(value: string | undefined): value is GeometryModel["type"] {
    return value !== undefined && GEOMETRY_TYPES.has(value as GeometryModel["type"]);
  }

  #isImportedMaterialMode(
    value: string | undefined,
  ): value is ImportedMaterialMode {
    return value === "imported" || value === "custom";
  }

  #isMaterialPreset(value: string): value is MaterialPresetId {
    return MATERIAL_PRESETS.has(value as MaterialPresetId);
  }

  #isTransformMode(value: string | undefined): value is TransformMode {
    return value !== undefined && TRANSFORM_MODES.has(value as TransformMode);
  }

  #isTransformGroup(value: string | undefined): value is TransformGroup {
    return value !== undefined && TRANSFORM_GROUPS.has(value as TransformGroup);
  }

  #isTransformAxis(value: string | undefined): value is TransformAxis {
    return value !== undefined && TRANSFORM_AXES.has(value as TransformAxis);
  }

  #isGeometryKey(value: string | undefined): value is GeometryNumericKey {
    return value !== undefined && GEOMETRY_KEYS.has(value as GeometryNumericKey);
  }

  #setPressed(button: HTMLButtonElement, pressed: boolean): void {
    button.setAttribute("aria-pressed", String(pressed));
    button.classList.toggle("is-active", pressed);
  }

  #setLocale(locale: AppPreferences["locale"]): void {
    this.#preferences = { ...this.#preferences, locale };
    saveAppPreferences(this.#preferences);
    this.#applyLocale();
  }

  #setTheme(theme: AppPreferences["theme"]): void {
    this.#preferences = { ...this.#preferences, theme };
    saveAppPreferences(this.#preferences);
    this.#applyTheme();
  }

  #applyPreferences(): void {
    this.#applyLocale();
    this.#applyTheme();
  }

  #applyLocale(): void {
    const { locale } = this.#preferences;
    document.documentElement.lang = locale;
    document.title = translate(locale, "document.title");
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute("content", translate(locale, "document.description"));
    this.viewportElement
      .querySelector<HTMLCanvasElement>(".viewport-canvas")
      ?.setAttribute("aria-label", translate(locale, "viewport.canvasLabel"));
    for (const element of this.#root.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const key = element.dataset.i18n as MessageKey | undefined;
      if (key) element.textContent = translate(locale, key);
    }
    for (const element of this.#root.querySelectorAll<HTMLElement>(
      "[data-i18n-aria-label]",
    )) {
      const key = element.dataset.i18nAriaLabel as MessageKey | undefined;
      if (key) element.setAttribute("aria-label", translate(locale, key));
    }
    this.#root
      .querySelector<HTMLInputElement>("[data-material-search]")
      ?.setAttribute("placeholder", translate(locale, "material.searchPlaceholder"));
    this.#importController.setLocale(locale);
    this.#renderLanguageButton();
    this.#renderThemeButton();
    this.#renderStatus();
    this.#renderEditor();
  }

  #applyTheme(): void {
    const { theme } = this.#preferences;
    document.documentElement.dataset.theme = theme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0b0e13" : "#eef2f7");
    this.#renderThemeButton();
  }

  #renderLanguageButton(): void {
    const { locale } = this.#preferences;
    const switchesToEnglish = locale === "ja";
    this.#languageButton.setAttribute(
      "aria-label",
      translate(
        locale,
        switchesToEnglish
          ? "language.switchToEnglish"
          : "language.switchToJapanese",
      ),
    );
    this.#query("[data-language-label]").textContent = translate(
      locale,
      switchesToEnglish ? "language.english" : "language.japanese",
    );
  }

  #renderThemeButton(): void {
    const { locale, theme } = this.#preferences;
    const switchesToLight = theme === "dark";
    this.#themeButton.setAttribute(
      "aria-label",
      translate(
        locale,
        switchesToLight ? "theme.switchToLight" : "theme.switchToDark",
      ),
    );
    this.#themeButton.setAttribute("aria-pressed", String(theme === "light"));
    this.#query("[data-theme-icon]").textContent = switchesToLight ? "☀" : "☾";
    this.#query("[data-theme-label]").textContent = translate(
      locale,
      switchesToLight ? "theme.light" : "theme.dark",
    );
  }

  #renderStatus(): void {
    this.#statusText.textContent = translate(
      this.#preferences.locale,
      `status.${this.#status}` as MessageKey,
    );
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required UI element not found: ${selector}`);
    return element;
  }


}

function formatEditorNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(4)));
}
