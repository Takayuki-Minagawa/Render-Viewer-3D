import { MaterialDetailView } from "./material-detail-view";
import { MaterialListView, type MaterialListViewItem } from "./material-list-view";
import "./material-library-layout.css";
import {
  createMaterialDetailRenderKey,
  materialKindMessageKey,
  resolveMaterialSelectionAfterAssignmentChange,
  resolveMaterialTabKey,
} from "./material-detail-state";
import type { MaterialColorMapField } from "../model/material/material-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import {
  DEFAULT_MATERIAL_LIBRARY_FILTERS,
  filterMaterialLibraryItems,
  type MaterialLibraryFilters,
  type MaterialSupportStatus,
} from "./material-library-state";

import {
  CATEGORY_LABELS,
  collectMaterialKeywords,
  filterCapabilities,
  getMaterialSupportStatus,
  resolveCapabilityValue,
  type MaterialSnapshot,
} from "./material-capability-ui";

import {
  type MaterialPreviewField,
} from "./material-basic-editor";
import {
  syncMaterialTextureStatus,
  type MaterialTextureUiStatus,
} from "./material-basic-editor";

export {
  collectMaterialKeywords,
  filterCapabilities,
  getMaterialSupportStatus,
  resolveCapabilityValue,
};

export interface MaterialObjectAssignment {
  readonly id: string;
  readonly name: string;
  readonly materialId: string;
}

export type MaterialEditorTab = "basic" | "advanced";
export type { MaterialPreviewField } from "./material-basic-editor";

type MaterialRenderFocus =
  | { readonly kind: "list"; readonly materialId: string }
  | { readonly kind: "texture"; readonly materialId: string }
  | { readonly kind: "assign" }
  | { readonly kind: "makeUnique" }
  | { readonly kind: "delete" };


export const MATERIAL_PRESET_CHOICES = [
  { id: "concrete", label: "material.presetConcrete" },
  { id: "matte-plastic", label: "material.presetMattePlastic" },
  { id: "glossy-plastic", label: "material.presetGlossyPlastic" },
  { id: "metal", label: "material.presetMetal" },
  { id: "glass", label: "material.presetGlass" },
  { id: "frosted-glass", label: "material.presetFrostedGlass" },
  { id: "matte", label: "material.presetMatte" },
  { id: "wood-base", label: "material.presetWood" },
] as const satisfies readonly { readonly id: string; readonly label: MessageKey }[];

export class MaterialLibraryView {
  readonly #root: HTMLElement;
  readonly #dialog: HTMLDialogElement;
  readonly #list: HTMLElement;
  readonly #detailView = new MaterialDetailView();
  readonly #listView: MaterialListView;
  readonly #usageCounts = new Map<string, number>();
  #categoryOptionsKey = "";
  #presetLocale: AppLocale | undefined;
  readonly #detail: HTMLElement;
  readonly #categoryFilter: HTMLSelectElement;
  readonly #presetSelect: HTMLSelectElement;
  readonly #resultCount: HTMLElement;
  #locale: AppLocale = "ja";
  #materials: readonly MaterialSnapshot[] = [];
  #objects: readonly MaterialObjectAssignment[] = [];
  #selectedObjectId: string | null = null;
  #selectedMaterialId: string | null = null;
  #filters: MaterialLibraryFilters = { ...DEFAULT_MATERIAL_LIBRARY_FILTERS };
  #editorTab: MaterialEditorTab = "basic";
  #capabilityQuery = "";
  #capabilitySupport: "all" | MaterialSupportStatus = "all";
  #renderedDetailKey = "";

  #renderedColorMapAssetId: string | null = null;
  readonly #textureStatuses = new Map<string, MaterialTextureUiStatus>();
  constructor(root: HTMLElement) {
    this.#root = root;
    this.#dialog = this.#createDialog();
    this.#root.querySelector(".app-shell")?.append(this.#dialog);
    this.#list = this.#query("[data-material-list]");
    this.#detail = this.#query("[data-material-detail]");
    this.#categoryFilter = this.#query("[data-material-category-filter]");
    this.#presetSelect = this.#query("[data-material-preset-select]");
    this.#resultCount = this.#query("[data-material-result-count]");
    this.#listView = new MaterialListView(this.#list, this.#resultCount);
    this.#dialog.addEventListener("click", (event) => {
      if (event.target === this.#dialog) this.#dialog.close();
    });
  }

  get isOpen(): boolean {
    return this.#dialog.open;
  }

  get selectedPresetId(): string {
    return this.#presetSelect.value;
  }

  render(
    materials: readonly MaterialSnapshot[],
    objects: readonly MaterialObjectAssignment[],
    selectedObjectId: string | null,
    locale: AppLocale,
  ): void {
    if (materials === this.#materials && objects === this.#objects &&
      selectedObjectId === this.#selectedObjectId && locale === this.#locale) return;
    const renderFocus = this.#captureRenderFocus();
    const previousObjectId = this.#selectedObjectId;
    const previousAssignedMaterialId = this.#selectedObject()?.materialId ?? null;
    const localeChanged = locale !== this.#locale;
    const objectChanged = selectedObjectId !== this.#selectedObjectId;
    this.#materials = materials;
    const materialIds = new Set(materials.map(({ id }) => id));
    for (const materialId of this.#textureStatuses.keys()) {
      if (!materialIds.has(materialId)) this.#textureStatuses.delete(materialId);
    }
    this.#objects = objects;
    this.#usageCounts.clear();
    for (const object of objects) this.#usageCounts.set(object.materialId, (this.#usageCounts.get(object.materialId) ?? 0) + 1);
    this.#selectedObjectId = selectedObjectId;
    this.#locale = locale;
    const assigned = this.#selectedObject()?.materialId ?? null;
    this.#selectedMaterialId = resolveMaterialSelectionAfterAssignmentChange({
      dialogOpen: this.#dialog.open,
      currentMaterialId: this.#selectedMaterialId,
      previousObjectId,
      nextObjectId: selectedObjectId,
      previousAssignedMaterialId,
      nextAssignedMaterialId: assigned,
    });
    if (
      !materials.some((material) => material.id === this.#selectedMaterialId) ||
      (!this.#dialog.open && objectChanged)
    ) {
      this.#selectedMaterialId = assigned ?? materials[0]?.id ?? null;
    }
    if (localeChanged) this.#renderedDetailKey = "";
    this.#renderCategoryOptions();
    this.#renderPresetOptions();
    this.#renderList();
    this.#renderDetail();
    this.#restoreRenderFocus(renderFocus);
  }

  open(materialId?: string, revealMaterial = false): void {
    if (revealMaterial) {
      this.#filters = { ...DEFAULT_MATERIAL_LIBRARY_FILTERS };
      this.#query<HTMLInputElement>("[data-material-search]").value = "";
      this.#categoryFilter.value = "all";
    }
    if (materialId && this.#materials.some((item) => item.id === materialId)) {
      this.#selectedMaterialId = materialId;
    }
    this.#renderList();
    this.#renderDetail();
    if (!this.#dialog.open) this.#dialog.showModal();
    queueMicrotask(() =>
      this.#query<HTMLInputElement>("[data-material-search]").focus(),
    );
  }

  close(): void {
    if (this.#dialog.open) this.#dialog.close();
  }

  setTextureStatus(
    materialId: string,
    status: MaterialTextureUiStatus,
  ): void {
    this.#textureStatuses.set(materialId, status);
    syncMaterialTextureStatus(
      this.#detail,
      materialId,
      this.#locale,
      status,
    );
  }

  handleUiClick(target: Element): boolean {
    const selectedId = target.closest<HTMLElement>("[data-material-select]")
      ?.dataset.materialSelect;
    if (selectedId) {
      this.#selectedMaterialId = selectedId;
      this.#renderedDetailKey = "";
      this.#renderList();
      this.#renderDetail();
      if (window.matchMedia("(max-width: 600px)").matches) {
        this.#dialog.classList.add("is-detail-view");
        queueMicrotask(() => this.#focusDetailHeading());
      } else {
        queueMicrotask(() => this.#focusMaterialListItem(selectedId));
      }
      return true;
    }
    if (target.closest("[data-material-back]")) {
      this.#dialog.classList.remove("is-detail-view");
      queueMicrotask(() =>
        this.#list
          .querySelector<HTMLElement>("[aria-current='true']")
          ?.focus(),
      );
      return true;
    }
    if (target.closest("[data-material-clear-filters]")) {
      this.#filters = { ...DEFAULT_MATERIAL_LIBRARY_FILTERS };
      const search = this.#query<HTMLInputElement>("[data-material-search]");
      search.value = "";
      this.#categoryFilter.value = "all";
      this.#renderList();
      search.focus();
      return true;
    }
    const tab = target.closest<HTMLElement>("[data-material-tab]")?.dataset
      .materialTab;
    if (tab === "basic" || tab === "advanced") {
      this.#editorTab = tab;
      this.#renderedDetailKey = "";
      this.#renderDetail();
      queueMicrotask(() => this.#focusActiveTab());
      return true;
    }
    return false;
  }

  handleUiInput(target: HTMLInputElement | HTMLSelectElement): boolean {
    if (target.matches("[data-material-search]")) {
      this.#filters = { ...this.#filters, query: target.value };
      this.#renderList();
      return true;
    }
    if (target === this.#categoryFilter) {
      this.#filters = { ...this.#filters, category: target.value };
      this.#renderList();
      return true;
    }
    if (target.matches("[data-material-capability-search]")) {
      this.#capabilityQuery = target.value;
      this.#renderedDetailKey = "";
      this.#renderDetail();
      this.#query<HTMLInputElement>("[data-material-capability-search]").focus();
      return true;
    }
    if (target.matches("[data-material-capability-support]")) {
      this.#capabilitySupport = isSupportFilter(target.value)
        ? target.value
        : "all";
      this.#renderedDetailKey = "";
      this.#renderDetail();
      queueMicrotask(() =>
        this.#query<HTMLSelectElement>("[data-material-capability-support]").focus(),
      );
      return true;
    }
    return false;
  }

  handleUiFocusOut(target: HTMLInputElement): boolean {
    const materialId =
      target.dataset.renameMaterial ??
      target.dataset.materialPreviewId ??
      target.dataset.materialPovId ??
      target.dataset.materialColorMapId;
    if (!materialId) return false;
    const material = this.#materials.find((item) => item.id === materialId);
    if (!material) return false;

    if (target.dataset.renameMaterial) {
      target.value = material.name;
      return true;
    }

    const colorMapField = target.dataset
      .materialColorMapField as MaterialColorMapField | undefined;
    if (colorMapField && material.colorMap) {
      target.value = String(material.colorMap[colorMapField]);
      return true;
    }

    const previewField = target.dataset
      .materialPreviewField as MaterialPreviewField | undefined;
    if (previewField) {
      this.#syncPreviewInput(target, material, previewField);
      return true;
    }

    const povPath = target.dataset.materialPovPath;
    if (povPath) {
      target.value = formatPovInputValue(
        resolveCapabilityValue(material, povPath),
      );
      return true;
    }
    return false;
  }

  handleUiKeydown(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const tab = target.closest<HTMLElement>("[data-material-tab]")?.dataset
      .materialTab;
    if (tab !== "basic" && tab !== "advanced") return false;
    const nextTab = resolveMaterialTabKey(tab, event.key);
    if (!nextTab) return false;

    event.preventDefault();
    this.#editorTab = nextTab;
    this.#renderedDetailKey = "";
    this.#renderDetail();
    queueMicrotask(() => this.#focusActiveTab());
    return true;
  }

  #createDialog(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "material-library-dialog";
    dialog.dataset.materialLibraryDialog = "";
    dialog.setAttribute("aria-labelledby", "material-library-title");
    dialog.setAttribute("aria-describedby", "material-library-description");
    dialog.innerHTML = `
      <div class="material-library-shell">
        <header class="material-library-header"><div><span class="eyebrow">POV-Ray MATERIAL CONCEPT WORKSPACE</span><h2 id="material-library-title" data-i18n="material.libraryTitle">マテリアルライブラリ</h2><p id="material-library-description" data-i18n="material.libraryDescription">再利用できるマテリアルを管理し、選択中のオブジェクトへ割り当てます。</p></div><form method="dialog"><button class="dialog-close" type="submit" value="close" data-i18n-aria-label="material.closeLabel" aria-label="マテリアルライブラリを閉じる">×</button></form></header>
        <p class="material-disclaimer" data-i18n="material.disclaimer">このエディターはPOV-Ray 3.7の用語体系に沿っています。WebGLプレビューはPOV-Rayによるレンダリングではなく、一部の効果は近似表示または未表示です。</p>
        <div class="material-library-workspace">
          <section class="material-library-master" aria-labelledby="material-list-title"><h3 class="visually-hidden" id="material-list-title" data-i18n="material.libraryTitle">マテリアルライブラリ</h3>
            <div class="material-create-row"><label><span data-i18n="material.presetLabel">プリセット</span><select data-material-preset-select></select></label><button type="button" class="primary-action" data-create-material-from-preset data-i18n="material.createFromPreset">プリセットから作成</button></div>
            <div class="material-filter-stack"><label class="field-label"><span data-i18n="material.searchLabel">マテリアルを検索</span><input type="search" autocomplete="off" data-material-search placeholder="名前・タグ・POV-Rayキーワード" /></label><div class="material-filter-grid is-category-only"><label><span data-i18n="material.categoryLabel">カテゴリ</span><select data-material-category-filter></select></label></div><div class="material-result-meta"><span data-material-result-count></span><button type="button" data-material-clear-filters data-i18n="material.clearFilters">絞り込みを解除</button></div></div>
            <div class="material-list" data-material-list></div>
          </section>
          <section class="material-library-detail" data-material-detail aria-live="polite"></section>
        </div>
      </div>`;
    return dialog;
  }

  #renderCategoryOptions(): void {
    const categories = [...new Set(this.#materials.map((item) => item.category))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, this.#locale));
    const optionsKey = JSON.stringify([this.#locale, categories]);
    if (optionsKey === this.#categoryOptionsKey) return;
    this.#categoryOptionsKey = optionsKey;
    this.#categoryFilter.replaceChildren(
      this.#option("all", translate(this.#locale, "material.filterAll")),
      ...categories.map((value) => this.#option(value, this.#categoryLabel(value))),
    );
    this.#categoryFilter.value = categories.includes(this.#filters.category)
      ? this.#filters.category
      : "all";
    if (this.#categoryFilter.value === "all") {
      this.#filters = { ...this.#filters, category: "all" };
    }

  }

  #renderPresetOptions(): void {
    if (this.#presetLocale === this.#locale) return;
    this.#presetLocale = this.#locale;
    const selected = this.#presetSelect.value;
    this.#presetSelect.replaceChildren(
      ...MATERIAL_PRESET_CHOICES.map((preset) =>
        this.#option(preset.id, translate(this.#locale, preset.label)),
      ),
    );
    if (MATERIAL_PRESET_CHOICES.some(({ id }) => id === selected)) {
      this.#presetSelect.value = selected;
    }
  }

  #renderList(): void {
    const all = this.#materials.map((material) => this.#listItem(material));
    const visible = filterMaterialLibraryItems(all, this.#filters, this.#locale);
    this.#listView.render(visible, all.length, this.#selectedMaterialId, this.#locale);
  }

  #renderDetail(): void {
    const material = this.#selectedMaterial();
    if (!material) {
      const empty = element("div", "material-detail-empty");
      empty.textContent = translate(this.#locale, "material.selectPrompt");
      this.#detail.replaceChildren(empty);
      this.#renderedDetailKey = "empty";
      return;
    }
    const object = this.#selectedObject();
    const usage = this.#usage(material.id);
    const assigned = object?.materialId === material.id;
    const detailKey = createMaterialDetailRenderKey({
      materialId: material.id,
      locale: this.#locale,
      editorTab: this.#editorTab,
      capabilityQuery: this.#capabilityQuery,
      capabilitySupport: this.#capabilitySupport,
      selectedObjectId: object?.id ?? null,
      selectedObjectMaterialId: object?.materialId ?? null,
      usage,
      assigned,
    });
    const colorMapAssetId = material.colorMap?.assetId ?? null;
    if (
      detailKey === this.#renderedDetailKey &&
      colorMapAssetId !== this.#renderedColorMapAssetId
    ) {
      this.#renderedDetailKey = "";
    }
    if (detailKey === this.#renderedDetailKey) {
      this.#syncInputs(material);
      return;
    }
    this.#detail.replaceChildren(...this.#detailView.build(material, {
      locale: this.#locale, editorTab: this.#editorTab, capabilityQuery: this.#capabilityQuery,
      capabilitySupport: this.#capabilitySupport, object, usage, assigned,
    }));
    this.#renderedDetailKey = detailKey;
    this.#renderedColorMapAssetId = colorMapAssetId;
    syncMaterialTextureStatus(
      this.#detail,
      material.id,
      this.#locale,
      this.#textureStatuses.get(material.id) ?? { kind: "idle" },
    );
    this.#syncInputs(material);
  }

  #syncInputs(material: MaterialSnapshot): void {
    for (const input of this.#detail.querySelectorAll<HTMLInputElement>(
      "[data-material-preview-field]",
    )) {
      if (input === document.activeElement) continue;
      const key = input.dataset.materialPreviewField as MaterialPreviewField;
      this.#syncPreviewInput(input, material, key);
    }
    for (const control of this.#detail.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("[data-material-color-map-field]")) {
      if (control === document.activeElement) continue;
      const colorMap = material.colorMap;
      const field = control.dataset
        .materialColorMapField as MaterialColorMapField | undefined;
      if (!colorMap || !field) continue;
      control.value = String(colorMap[field]);
    }
    for (const input of this.#detail.querySelectorAll<HTMLInputElement>(
      "[data-material-pov-path]",
    )) {
      if (input === document.activeElement) continue;
      const path = input.dataset.materialPovPath;
      if (path) {
        input.value = formatPovInputValue(resolveCapabilityValue(material, path));
      }
    }
    const name = this.#detail.querySelector<HTMLInputElement>(
      "[data-rename-material]",
    );
    if (name && name !== document.activeElement) name.value = material.name;
    const heading = this.#detail.querySelector<HTMLElement>(
      "[data-material-detail-heading]",
    );
    if (heading) heading.textContent = material.name;
    const presetBadge = this.#detail.querySelector<HTMLElement>(
      "[data-material-preset-badge]",
    );
    if (presetBadge) {
      presetBadge.textContent = translate(
        this.#locale,
        materialKindMessageKey(material.presetId),
      );
    }
  }

  #syncPreviewInput(
    input: HTMLInputElement,
    material: MaterialSnapshot,
    key: MaterialPreviewField,
  ): void {
    const value = material.preview[key];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.type === "color") input.value = String(value);
    else input.value = formatInputValue(value);
  }

  #captureRenderFocus(): MaterialRenderFocus | undefined {
    const active = document.activeElement;
    if (
      !this.#dialog.open ||
      !(active instanceof HTMLElement) ||
      !this.#dialog.contains(active)
    ) {
      return undefined;
    }
    const materialId = active.dataset.materialSelect;
    if (materialId) return { kind: "list", materialId };
    const textureMaterialId = active.dataset.materialTextureInput;
    if (textureMaterialId) {
      return { kind: "texture", materialId: textureMaterialId };
    }
    if (active.dataset.assignMaterial) return { kind: "assign" };
    if (active.dataset.makeMaterialUnique) return { kind: "makeUnique" };
    if (active.dataset.deleteMaterial) return { kind: "delete" };
    return undefined;
  }

  #restoreRenderFocus(focus: MaterialRenderFocus | undefined): void {
    if (!focus) return;
    queueMicrotask(() => {
      if (!this.#dialog.open) return;
      if (focus.kind === "list") {
        this.#focusMaterialListItem(focus.materialId);
        return;
      }
      if (focus.kind === "texture") {
        const input = [
          ...this.#detail.querySelectorAll<HTMLInputElement>(
            "[data-material-texture-input]",
          ),
        ].find(
          (candidate) =>
            candidate.dataset.materialTextureInput === focus.materialId,
        );
        input?.focus();
        return;
      }
      if (focus.kind === "assign") {
        this.#detail
          .querySelector<HTMLButtonElement>(
            ".material-detail-actions button:not(:disabled)",
          )
          ?.focus();
        return;
      }
      if (focus.kind === "makeUnique") {
        const rename = this.#detail.querySelector<HTMLInputElement>(
          "[data-rename-material]",
        );
        if (rename) rename.focus();
        else this.#focusDetailHeading();
        return;
      }
      if (window.matchMedia("(max-width: 600px)").matches) {
        this.#focusDetailHeading();
        return;
      }
      if (
        !this.#selectedMaterialId ||
        !this.#focusMaterialListItem(this.#selectedMaterialId)
      ) {
        this.#focusDetailHeading();
      }
    });
  }

  #focusMaterialListItem(materialId: string): boolean {
    const button = [
      ...this.#list.querySelectorAll<HTMLButtonElement>(
        "[data-material-select]",
      ),
    ].find((candidate) => candidate.dataset.materialSelect === materialId);
    button?.focus();
    return Boolean(button);
  }

  #focusDetailHeading(): void {
    this.#detail
      .querySelector<HTMLElement>("[data-material-detail-heading]")
      ?.focus();
  }

  #focusActiveTab(): void {
    this.#detail
      .querySelector<HTMLButtonElement>(
        `[data-material-tab="${this.#editorTab}"]`,
      )
      ?.focus();
  }

  #listItem(material: MaterialSnapshot): MaterialListViewItem {
    return {
      id: material.id,
      name: material.name,
      category: material.category || "general",
      tags: material.tags,
      keywords: collectMaterialKeywords(material),
      support: getMaterialSupportStatus(material),
      material,
      usageCount: this.#usage(material.id),
    };
  }

  #usage(materialId: string): number {
    return this.#usageCounts.get(materialId) ?? 0;
  }

  #selectedMaterial(): MaterialSnapshot | undefined {
    return this.#materials.find((item) => item.id === this.#selectedMaterialId);
  }

  #selectedObject(): MaterialObjectAssignment | undefined {
    return this.#objects.find((item) => item.id === this.#selectedObjectId);
  }

  #categoryLabel(category: string): string {
    const key = CATEGORY_LABELS[category.toLocaleLowerCase()];
    return key ? translate(this.#locale, key) : category;
  }

  #option(value: string, label: string): HTMLOptionElement {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const value = this.#dialog.querySelector<T>(selector);
    if (!value) throw new Error(`Required material UI element not found: ${selector}`);
    return value;
  }
}

function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className?: string,
): HTMLElementTagNameMap[Tag] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  return value;
}

function formatInputValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.round(value * 1000) / 1000);
  }
  return typeof value === "string" ? value : "";
}

function formatPovInputValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function isSupportFilter(
  value: string,
): value is "all" | MaterialSupportStatus {
  return ["all", "direct", "approximate", "stored"].includes(value);
}
