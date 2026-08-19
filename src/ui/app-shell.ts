import {
  IMPORT_FILE_ACCEPT,
  importerRegistry,
  type ImportOptions,
} from "../importers";
import type { EditorState, TransformMode } from "../app/editor-store";
import type { ImportedMaterialMode } from "../model/imported-scene-model";
import type { MaterialPresetId } from "../model/material/material-model";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import {
  loadAppPreferences,
  saveAppPreferences,
  toggleLocale,
  toggleTheme,
  type AppPreferences,
} from "./app-preferences";
import {
  createImporterDisplayItems,
  createImportOptions,
  hasDraggedFiles,
  importErrorDetail,
} from "./import-ui-state";
import { translate, type MessageKey } from "./i18n";
import {
  MaterialLibraryView,
  type MaterialPreviewField,
} from "./material-library";
import {
  SceneEditorView,
  type GeometryNumericKey,
  type TransformAxis,
  type TransformGroup,
} from "./scene-editor-view";

export interface AppActions {
  toggleGrid: () => void;
  toggleAxes: () => void;
  resetCamera: () => void;
  importFiles: (files: readonly File[], options: ImportOptions) => Promise<void>;
  setImportedMaterialMode: (
    id: string,
    mode: ImportedMaterialMode,
    customMaterialId: string | null,
  ) => void;
  addObject: (primitive: GeometryModel["type"]) => void;
  selectObject: (id: string | null) => void;
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
type ImportNotice =
  | { kind: "idle" }
  | { kind: "busy"; fileNames: string }
  | { kind: "success"; fileNames: string }
  | { kind: "error"; detail: string };

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
  readonly #importButton: HTMLButtonElement;
  readonly #importDialog: HTMLDialogElement;
  readonly #importFileInput: HTMLInputElement;
  readonly #importStatus: HTMLElement;
  readonly #dropOverlay: HTMLElement;
  readonly #loadingElement: HTMLElement;
  readonly #statusText: HTMLElement;
  readonly #editorView: SceneEditorView;
  readonly #materialLibrary: MaterialLibraryView;
  #preferences: AppPreferences;
  #status: UiStatus = "initializing";
  #importBusy = false;
  #importNotice: ImportNotice = { kind: "idle" };
  #model: SceneSnapshot | undefined;
  #editorState: EditorState = DEFAULT_EDITOR_STATE;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#preferences = loadAppPreferences();
    this.#root.innerHTML = this.#template();
    this.viewportElement = this.#query("[data-viewport]");
    this.#gridButton = this.#query("[data-action='grid']");
    this.#axesButton = this.#query("[data-action='axes']");
    this.#languageButton = this.#query("[data-action='language']");
    this.#themeButton = this.#query("[data-action='theme']");
    this.#importButton = this.#query("[data-action='import']");
    this.#importDialog = this.#query("[data-import-dialog]");
    this.#importFileInput = this.#query("[data-import-file-input]");
    this.#importStatus = this.#query("[data-import-status]");
    this.#dropOverlay = this.#query("[data-drop-overlay]");
    this.#manualDialog = this.#query("[data-manual-dialog]");
    this.#loadingElement = this.#query("[data-loading]");
    this.#statusText = this.#query("[data-status]");
    this.#importFileInput.accept = IMPORT_FILE_ACCEPT;
    this.#editorView = new SceneEditorView(this.#root);
    this.#materialLibrary = new MaterialLibraryView(this.#root);
    this.#applyPreferences();
  }

  bindActions(actions: AppActions): void {
    const options = { signal: this.#abortController.signal };
    this.#gridButton.addEventListener("click", actions.toggleGrid, options);
    this.#axesButton.addEventListener("click", actions.toggleAxes, options);
    this.#query<HTMLButtonElement>("[data-action='reset']").addEventListener(
      "click",
      actions.resetCamera,
      options,
    );
    this.#bindImportEvents(actions, options);
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
      (event) => this.#handleShortcut(event, actions),
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
    this.#query("[data-view-fov]").textContent = `${model.camera.fov.toFixed(0)}°`;
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
    this.#abortController.abort();
    this.#root.replaceChildren();
  }

  #renderEditor(): void {
    if (!this.#model) return;
    this.#editorView.render(
      this.#model,
      this.#editorState,
      this.#preferences.locale,
    );
    const materialAssignments = [
      ...this.#model.objects.map(({ id, name, materialId }) => ({
        id,
        name,
        materialId,
      })),
      ...this.#model.imports.flatMap((imported) =>
        imported.materialMode === "custom" && imported.customMaterialId
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
    this.#materialLibrary.render(
      this.#model.materials,
      materialAssignments,
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

  #handleShortcut(event: KeyboardEvent, actions: AppActions): void {
    if (
      event.defaultPrevented ||
      this.#manualDialog.open ||
      this.#importDialog.open ||
      this.#materialLibrary.isOpen ||
      this.#isEditingTarget(event.target)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const selectedId = this.#editorState.selectedObjectId;
    const primitiveSelected =
      selectedId !== null &&
      (this.#model?.objects.some(({ id }) => id === selectedId) ?? false);
    if (
      (event.ctrlKey || event.metaKey) && key === "d" && primitiveSelected
    ) {
      event.preventDefault();
      actions.duplicateObject(selectedId!);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const shortcutModes: Partial<Record<string, TransformMode>> = {
      w: "translate",
      e: "rotate",
      r: "scale",
    };
    const mode = shortcutModes[key];
    if (mode) {
      event.preventDefault();
      actions.setTransformMode(mode);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
      event.preventDefault();
      actions.deleteObject(selectedId);
    }
  }

  #bindImportEvents(
    actions: AppActions,
    options: { signal: AbortSignal },
  ): void {
    this.#importButton.addEventListener(
      "click",
      () => {
        if (!this.#importDialog.open) this.#importDialog.showModal();
      },
      options,
    );
    this.#query<HTMLButtonElement>("[data-action='choose-import-files']")
      .addEventListener("click", () => this.#importFileInput.click(), options);
    this.#importDialog.addEventListener(
      "click",
      (event) => {
        if (event.target === this.#importDialog) this.#importDialog.close();
      },
      options,
    );
    this.#importFileInput.addEventListener(
      "change",
      () => {
        const files = Array.from(this.#importFileInput.files ?? []);
        this.#importFileInput.value = "";
        if (files.length === 0) return;
        this.#importDialog.close();
        void this.#runImport(files, actions);
      },
      options,
    );

    let dragDepth = 0;
    const resetDropState = () => {
      dragDepth = 0;
      this.#dropOverlay.classList.remove("is-visible");
      this.viewportElement.classList.remove("is-file-dragging");
    };
    this.viewportElement.addEventListener(
      "dragenter",
      (event) => {
        if (!hasDraggedFiles(Array.from(event.dataTransfer?.types ?? []))) return;
        event.preventDefault();
        dragDepth += 1;
        this.#dropOverlay.classList.add("is-visible");
        this.viewportElement.classList.add("is-file-dragging");
      },
      options,
    );
    this.viewportElement.addEventListener(
      "dragover",
      (event) => {
        if (!hasDraggedFiles(Array.from(event.dataTransfer?.types ?? []))) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      },
      options,
    );
    this.viewportElement.addEventListener(
      "dragleave",
      (event) => {
        if (!hasDraggedFiles(Array.from(event.dataTransfer?.types ?? []))) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) resetDropState();
      },
      options,
    );
    this.viewportElement.addEventListener(
      "drop",
      (event) => {
        if (!hasDraggedFiles(Array.from(event.dataTransfer?.types ?? []))) return;
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files ?? []);
        resetDropState();
        if (files.length > 0) void this.#runImport(files, actions);
      },
      options,
    );
  }

  async #runImport(files: readonly File[], actions: AppActions): Promise<void> {
    if (this.#importBusy || files.length === 0) return;
    const fileNames = this.#summarizeFileNames(files);
    this.#importBusy = true;
    this.#importNotice = { kind: "busy", fileNames };
    this.#setImportControlsDisabled(true);
    this.#renderImportNotice();
    try {
      await actions.importFiles(files, this.#readImportOptions());
      this.#importNotice = { kind: "success", fileNames };
    } catch (error) {
      console.error("Model import failed.", error);
      this.#importNotice = { kind: "error", detail: importErrorDetail(error) };
    } finally {
      this.#importBusy = false;
      this.#setImportControlsDisabled(false);
      this.#renderImportNotice();
    }
  }

  #readImportOptions(): ImportOptions {
    return createImportOptions({
      unit: this.#query<HTMLSelectElement>("[data-import-unit]").value,
      coordinateSystem: this.#query<HTMLSelectElement>(
        "[data-import-coordinate]",
      ).value,
      centerModel: this.#query<HTMLInputElement>("[data-import-center]").checked,
      placeOnGround: this.#query<HTMLInputElement>("[data-import-ground]").checked,
      quality: this.#query<HTMLInputElement>(
        "[name='import-quality']:checked",
      ).value,
    });
  }

  #setImportControlsDisabled(disabled: boolean): void {
    this.#importButton.disabled = disabled;
    this.#importFileInput.disabled = disabled;
    this.#query<HTMLButtonElement>("[data-action='choose-import-files']").disabled =
      disabled;
    this.#importDialog.setAttribute("aria-busy", String(disabled));
  }

  #summarizeFileNames(files: readonly File[]): string {
    const first = files[0]?.name ?? "";
    return files.length > 1 ? `${first} (+${files.length - 1})` : first;
  }

  #renderImportNotice(): void {
    const notice = this.#importNotice;
    this.#importStatus.hidden = notice.kind === "idle";
    this.#importStatus.dataset.kind = notice.kind;
    if (notice.kind === "idle") {
      this.#importStatus.textContent = "";
      return;
    }
    const key = `import.status.${notice.kind}` as MessageKey;
    const detail = notice.kind === "error" ? notice.detail : notice.fileNames;
    this.#importStatus.textContent = `${translate(
      this.#preferences.locale,
      key,
    )} ${detail}`;
  }

  #renderImporterList(): void {
    const list = this.#query<HTMLElement>("[data-import-formats]");
    const fragment = document.createDocumentFragment();
    for (const item of createImporterDisplayItems(importerRegistry)) {
      const row = document.createElement("li");
      row.dataset.importerId = item.id;
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(label);
      if (item.experimental) {
        const badge = document.createElement("small");
        badge.textContent = translate(
          this.#preferences.locale,
          "import.experimental",
        );
        row.append(badge);
      }
      fragment.append(row);
    }
    list.replaceChildren(fragment);
  }

  #findImportMaterialSelect(id: string): HTMLSelectElement | undefined {
    return Array.from(
      this.#root.querySelectorAll<HTMLSelectElement>(
        "[data-import-material-select]",
      ),
    ).find((select) => select.dataset.importMaterialSelect === id);
  }

  #isEditingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      ) !== null
    );
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
    this.#renderImporterList();
    this.#renderImportNotice();
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

  #template(): string {
    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-copy"><strong>RENDER VIEWER</strong><small data-i18n="brand.subtitle">パラメトリック3Dシーンツール</small></span></div>
          <div class="header-tools">
            <div class="header-meta"><span class="phase-badge" data-i18n="header.phase">フェーズ 4</span><span class="header-divider" aria-hidden="true"></span><span class="scene-name" data-scene-name>Lighting Study 01</span></div>
            <div class="header-actions" role="group" data-i18n-aria-label="header.controls" aria-label="表示と言語の設定">
              <button class="header-button" data-action="language" type="button"><i aria-hidden="true">文/A</i><span data-language-label>English</span></button>
              <button class="header-button" data-action="theme" type="button" aria-pressed="false"><i data-theme-icon aria-hidden="true">☀</i><span data-theme-label>ライト</span></button>
              <button class="header-button" data-action="manual" type="button" data-i18n-aria-label="manual.openLabel"><i aria-hidden="true">?</i><span data-i18n="manual.open">使い方</span></button>
            </div>
          </div>
        </header>

        <main class="workspace">
          <aside class="panel scene-panel" data-i18n-aria-label="scene.panelLabel">
            <div class="panel-heading scene-heading"><div><span class="eyebrow" data-i18n="scene.eyebrow">シーンモデル</span><h1 data-i18n="scene.title">シーン</h1></div><span class="schema-badge">JSON v2</span></div>
            <details class="primitive-menu">
              <summary data-i18n-aria-label="scene.addObjectLabel"><i aria-hidden="true">＋</i><span data-i18n="scene.addObject">オブジェクト追加</span><b aria-hidden="true">⌄</b></summary>
              <div class="primitive-grid">
                <button type="button" data-add-primitive="box"><i class="tree-icon cube-icon" aria-hidden="true"></i><span data-i18n="primitive.box">ボックス</span></button>
                <button type="button" data-add-primitive="sphere"><i class="tree-icon sphere-icon" aria-hidden="true"></i><span data-i18n="primitive.sphere">球</span></button>
                <button type="button" data-add-primitive="cylinder"><i class="tree-icon cylinder-icon" aria-hidden="true"></i><span data-i18n="primitive.cylinder">円柱</span></button>
                <button type="button" data-add-primitive="cone"><i class="tree-icon cone-icon" aria-hidden="true"></i><span data-i18n="primitive.cone">円錐</span></button>
                <button type="button" data-add-primitive="plane"><i class="tree-icon plane-icon" aria-hidden="true"></i><span data-i18n="primitive.plane">平面</span></button>
                <button type="button" data-add-primitive="torus"><i class="tree-icon torus-icon" aria-hidden="true"></i><span data-i18n="primitive.torus">トーラス</span></button>
              </div>
            </details>
            <nav class="scene-tree" data-i18n-aria-label="scene.structureLabel">
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.objects">オブジェクト</span><b data-object-count>0</b></div><div data-object-list></div></section>
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.lights">ライト</span><b data-light-count>0</b></div><div data-light-list></div></section>
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.camera">カメラ</span><b>1</b></div><div class="tree-item tree-item-static" data-camera-item><span class="tree-icon camera-icon" aria-hidden="true"></span><span><strong data-i18n="scene.perspective">透視投影</strong><small>45° FOV</small></span></div></section>
            </nav>
            <div class="model-note"><b>03</b><p><strong data-i18n="scene.modelNoteTitle">SceneModelが正本</strong><span data-i18n="scene.modelNoteBody">編集結果はモデルを経由して描画へ反映されます。</span></p></div>
          </aside>

          <section class="viewport-panel" data-i18n-aria-label="viewport.panelLabel">
            <div class="viewport-toolbar"><div class="view-title"><i></i><span data-i18n="viewport.perspective">透視投影</span><small data-view-fov>45°</small></div><div class="tool-cluster" data-i18n-aria-label="viewport.settingsLabel">
              <button class="tool-button import-tool-button" data-action="import" type="button" data-i18n-aria-label="import.openLabel"><i class="import-glyph" aria-hidden="true">↓</i><span data-i18n="import.open">Import Model</span></button>
              <button class="tool-button is-active" data-action="grid" type="button" data-i18n-aria-label="viewport.gridLabel" aria-pressed="true"><i class="grid-glyph" aria-hidden="true"></i><span data-i18n="viewport.grid">グリッド</span></button>
              <button class="tool-button is-active" data-action="axes" type="button" data-i18n-aria-label="viewport.axesLabel" aria-pressed="true"><i class="axes-glyph" aria-hidden="true"></i><span data-i18n="viewport.axes">軸</span></button>
              <button class="tool-button" data-action="reset" type="button" data-i18n-aria-label="viewport.resetLabel"><i class="reset-glyph" aria-hidden="true">↺</i><span data-i18n="viewport.reset">視点リセット</span></button>
            </div></div>
            <div class="viewport" data-viewport><div class="loading-state" data-loading><span class="loading-cube" aria-hidden="true"></span><span data-i18n="viewport.loading">WebGLを初期化中</span></div><div class="drop-overlay" data-drop-overlay aria-hidden="true"><span class="drop-overlay-glyph">↓</span><strong data-i18n="import.dropTitle">3D / CADモデルをドロップ</strong><small data-i18n="import.dropBody">ファイルはブラウザ内だけで処理されます。</small></div><div class="import-toast" data-import-status role="status" aria-live="polite" hidden></div><span class="world-label" data-i18n="viewport.world">ワールド / Y軸上向き</span><div class="interaction-hint"><span data-i18n="viewport.rotateHint">左ドラッグ・回転</span><span data-i18n="viewport.panHint">右ドラッグ・移動</span><span data-i18n="viewport.zoomHint">ホイール・ズーム</span></div></div>
            <div class="viewport-statusbar"><span class="ready-status"><i></i><span data-status>初期化中</span></span><span class="status-divider"></span><span>WEBGL · ACES</span><span class="status-spacer"></span><span>DPR ≤ 2</span></div>
          </section>

          <aside class="panel inspector-panel" data-i18n-aria-label="inspector.panelLabel">
            <div class="panel-heading"><div><span class="eyebrow" data-i18n="inspector.eyebrow">インスペクター</span><h2 data-inspector-title>未選択</h2></div><span class="readonly-badge" data-inspector-badge>未選択</span></div>
            <div class="inspector-scroll" data-inspector-body></div>
          </aside>
        </main>

        <input class="visually-hidden" data-import-file-input type="file" accept="${IMPORT_FILE_ACCEPT}" multiple tabindex="-1">
        <dialog class="import-dialog" data-import-dialog aria-labelledby="import-dialog-title">
          <form method="dialog" class="import-dialog-card" data-import-options-form>
            <div class="import-dialog-header"><div><span class="eyebrow" data-i18n="import.eyebrow">3D / CAD FILES</span><h2 id="import-dialog-title" data-i18n="import.title">Import model</h2></div><button class="dialog-close" type="submit" value="cancel" data-i18n-aria-label="import.cancelLabel">×</button></div>
            <p class="import-dialog-intro" data-i18n="import.description">Choose a model and normalization options. Processing stays in your browser.</p>
            <section class="import-supported"><h3 data-i18n="import.supportedFormats">Supported formats</h3><ul data-import-formats></ul></section>
            <div class="import-option-grid">
              <label><span data-i18n="import.unit">Unit</span><select data-import-unit name="import-unit"><option value="auto" data-i18n="import.unitAuto">Auto</option><option value="millimeter">mm</option><option value="centimeter">cm</option><option value="meter">m</option><option value="inch">in</option><option value="foot">ft</option></select></label>
              <label><span data-i18n="import.coordinate">Coordinate system</span><select data-import-coordinate name="import-coordinate"><option value="auto" data-i18n="import.coordinateAuto">Auto</option><option value="y-up">Y-Up</option><option value="z-up">Z-Up</option></select></label>
            </div>
            <div class="import-checks">
              <label><input type="checkbox" data-import-center checked><span data-i18n="import.center">Center model</span></label>
              <label><input type="checkbox" data-import-ground checked><span data-i18n="import.ground">Place on ground</span></label>
            </div>
            <fieldset class="import-quality"><legend data-i18n="import.quality">Triangulation quality</legend>
              <label><input type="radio" name="import-quality" value="low"><span data-i18n="import.qualityLow">Low</span></label>
              <label><input type="radio" name="import-quality" value="medium" checked><span data-i18n="import.qualityMedium">Medium</span></label>
              <label><input type="radio" name="import-quality" value="high"><span data-i18n="import.qualityHigh">High</span></label>
            </fieldset>
            <div class="import-dialog-note"><strong data-i18n="import.sidecarsTitle">Sidecar files</strong><span data-i18n="import.sidecarsBody">For glTF, select related .bin and image files together.</span></div>
            <div class="import-dialog-actions"><button class="secondary-action" type="submit" value="cancel" data-i18n="import.cancel">Cancel</button><button class="primary-action" type="button" data-action="choose-import-files"><span data-i18n="import.chooseFiles">Choose files</span></button></div>
          </form>
        </dialog>

        <dialog class="manual-dialog" data-manual-dialog aria-labelledby="manual-title">
          <div class="manual-header"><div><span class="eyebrow">RENDER VIEWER 3D</span><h2 id="manual-title" data-i18n="manual.title">簡易マニュアル</h2></div><form method="dialog"><button class="dialog-close" type="submit" value="close" data-i18n-aria-label="manual.closeLabel">×</button></form></div>
          <div class="manual-body">
            <p class="manual-intro" data-i18n="manual.intro">オブジェクト、マテリアル、3Dビュー操作の要点をまとめています。</p>
            <section><h3><span>01</span><b data-i18n="manual.sceneTitle">オブジェクト操作</b></h3><ul><li data-i18n="manual.addPrimitive">「オブジェクト追加」から6種類の形状を追加できます。</li><li data-i18n="manual.selectObject">一覧または3Dビューでオブジェクトを選択します。</li><li data-i18n="manual.visibility">一覧右端で表示を切り替えます。</li></ul></section>
            <section><h3><span>02</span><b data-i18n="manual.editTitle">インスペクター</b></h3><ul><li data-i18n="manual.editName">名前を編集すると一覧にも反映されます。</li><li data-i18n="manual.editTransform">位置・回転・拡大率をXYZごとに編集できます。</li><li data-i18n="manual.editGeometry">形状固有の寸法や分割数を編集できます。</li><li data-i18n="manual.duplicateDelete">複製と削除は下部から実行します。</li></ul></section>
            <section><h3><span>03</span><b data-i18n="manual.materialTitle">マテリアル</b></h3><ul><li data-i18n="manual.materialOpen">オブジェクトを選択し、インスペクターからライブラリを開きます。</li><li data-i18n="manual.materialSearch">名前・タグ・POV-Rayキーワードで検索できます。</li><li data-i18n="manual.materialAssign">マテリアルを選択中のオブジェクトへ割り当てます。</li><li data-i18n="manual.materialShared">共有変更は使用中の全オブジェクトへ反映されます。</li><li data-i18n="manual.materialStatus">対応状況でWebGLプレビューとの関係を確認できます。</li><li data-i18n="manual.materialAdvanced">詳細タブではPOV-Ray材料特性を一覧できます。</li><li data-i18n="manual.materialDisclaimer">WebGL表示はPOV-Rayレンダリングそのものではありません。</li></ul></section>
            <section><h3><span>04</span><b data-i18n="manual.shortcutsTitle">編集ショートカット</b></h3><ul><li data-i18n="manual.shortcutModes">W：移動、E：回転、R：拡大縮小。</li><li data-i18n="manual.shortcutDuplicate">Ctrl/Cmd + D：複製。</li><li data-i18n="manual.shortcutDelete">Delete / Backspace：削除。</li><li data-i18n="manual.shortcutInput">入力・ボタン操作中は無効です。</li></ul></section>
            <section><h3><span>05</span><b data-i18n="manual.navigationTitle">カメラ操作</b></h3><ul><li data-i18n="manual.rotate">左ドラッグ：回転。</li><li data-i18n="manual.pan">右ドラッグ：移動。</li><li data-i18n="manual.zoom">ホイール：ズーム。</li><li data-i18n="manual.reset">視点リセット：初期位置へ戻します。</li></ul></section>
            <section><h3><span>06</span><b data-i18n="manual.displayTitle">表示設定</b></h3><ul><li data-i18n="manual.grid">グリッドを切り替えます。</li><li data-i18n="manual.axes">XYZ軸を切り替えます。</li><li data-i18n="manual.theme">ライト・ダークテーマを切り替えます。</li></ul></section>
            <section><h3><span>07</span><b data-i18n="manual.languageTitle">言語と閉じ方</b></h3><ul><li data-i18n="manual.language">English / 日本語で言語を切り替えます。</li><li data-i18n="manual.escape">Esc、閉じる、またはダイアログ外で閉じます。</li></ul></section>
          </div>
          <a class="manual-license-link" href="${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener noreferrer" data-i18n="manual.thirdPartyLicenses">第三者ライセンス・著作権表示</a>
          <form method="dialog" class="manual-footer"><button type="submit" value="close" data-i18n="manual.close">閉じる</button></form>
        </dialog>
      </div>
    `;
  }
}

function formatEditorNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toFixed(4)));
}
