import "./material-library-layout.css";
import {
  createMaterialDetailRenderKey,
  materialKindMessageKey,
  resolveMaterialTabKey,
} from "./material-detail-state";
import { MATERIAL_CAPABILITIES } from "../model/material/material-capabilities";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import {
  DEFAULT_MATERIAL_LIBRARY_FILTERS,
  countMaterialUsage,
  filterMaterialLibraryItems,
  type MaterialLibraryFilters,
  type MaterialLibraryItem,
  type MaterialSupportStatus,
} from "./material-library-state";

import {
  CATEGORY_LABELS,
  SUPPORT_DESCRIPTIONS,
  SUPPORT_LABELS,
  capabilityCategories,
  capabilityCategoryLabel,
  collectMaterialKeywords,
  fidelityToStatus,
  filterCapabilities,
  formatCapabilityValue,
  getMaterialSupportStatus,
  resolveCapabilityValue,
  type CapabilitySnapshot,
  type MaterialSnapshot,
} from "./material-capability-ui";

import {
  renderMaterialBasicEditor,
  type MaterialPreviewField,
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

interface MaterialListViewItem extends MaterialLibraryItem {
  readonly material: MaterialSnapshot;
  readonly usageCount: number;
}

type MaterialRenderFocus =
  | { readonly kind: "list"; readonly materialId: string }
  | { readonly kind: "assign" }
  | { readonly kind: "delete" };

const MATERIAL_TAB_PANEL_ID = "material-editor-panel";

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

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#dialog = this.#createDialog();
    this.#root.querySelector(".app-shell")?.append(this.#dialog);
    this.#list = this.#query("[data-material-list]");
    this.#detail = this.#query("[data-material-detail]");
    this.#categoryFilter = this.#query("[data-material-category-filter]");
    this.#presetSelect = this.#query("[data-material-preset-select]");
    this.#resultCount = this.#query("[data-material-result-count]");
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
    const renderFocus = this.#captureRenderFocus();
    const localeChanged = locale !== this.#locale;
    const objectChanged = selectedObjectId !== this.#selectedObjectId;
    this.#materials = materials;
    this.#objects = objects;
    this.#selectedObjectId = selectedObjectId;
    this.#locale = locale;
    const assigned = this.#selectedObject()?.materialId ?? null;
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

  open(materialId?: string): void {
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
      target.dataset.materialPovId;
    if (!materialId) return false;
    const material = this.#materials.find((item) => item.id === materialId);
    if (!material) return false;

    if (target.dataset.renameMaterial) {
      target.value = material.name;
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
    this.#resultCount.textContent = `${visible.length} / ${all.length}`;
    if (!visible.length) {
      const empty = element("div", "material-list-empty");
      empty.append(
        textElement("strong", translate(this.#locale, "material.noResultsTitle")),
        textElement("p", translate(this.#locale, "material.noResultsBody")),
      );
      this.#list.replaceChildren(empty);
      return;
    }
    this.#list.replaceChildren(
      ...visible.map((item) => {
        const button = element("button", "material-list-item");
        button.setAttribute("type", "button");
        button.dataset.materialSelect = item.id;
        button.setAttribute("aria-current", String(item.id === this.#selectedMaterialId));
        const copy = element("span", "material-list-copy");
        copy.append(
          textElement("strong", item.name),
          textElement(
            "small",
            `${this.#categoryLabel(item.category)} · ${translate(
              this.#locale,
              "material.usedBy",
            )} ${item.usageCount}`,
          ),
        );
        button.append(
          this.#swatch(item.material.preview.baseColor),
          copy,
          this.#supportBadge(item.support),
        );
        return button;
      }),
    );
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
    if (detailKey === this.#renderedDetailKey) {
      this.#syncInputs(material);
      return;
    }
    const header = element("header", "material-detail-header");
    const back = textElement("button", `← ${translate(this.#locale, "material.back")}`);
    back.className = "material-back-button";
    back.setAttribute("type", "button");
    back.dataset.materialBack = "";
    const headingWrap = document.createElement("div");
    const heading = textElement("h3", material.name);
    heading.dataset.materialDetailHeading = "";
    heading.tabIndex = -1;
    const meta = element("div", "material-detail-meta");
    const presetBadge = this.#metaBadge(
      translate(this.#locale, materialKindMessageKey(material.presetId)),
    );
    presetBadge.dataset.materialPresetBadge = "";
    meta.append(
      this.#supportBadge(getMaterialSupportStatus(material)),
      presetBadge,
    );
    headingWrap.append(heading, meta);
    header.append(back, headingWrap);

    const actions = element("div", "material-detail-actions");
    const assign = this.#action(
      assigned ? "material.assigned" : "material.assign",
      "primary-action",
    );
    assign.dataset.assignMaterial = material.id;
    assign.disabled = !object || assigned;
    const unique = this.#action("material.makeUnique", "secondary-action");
    unique.dataset.makeMaterialUnique = object?.id ?? "";
    unique.disabled = !assigned || usage <= 1;
    unique.setAttribute("aria-describedby", "material-usage-note");
    if (assigned && usage <= 1) {
      unique.title = translate(this.#locale, "material.singleUseNotice");
    }
    const duplicate = this.#action("material.duplicate", "secondary-action");
    duplicate.dataset.duplicateMaterial = material.id;
    const remove = this.#action("material.delete", "danger-action");
    remove.dataset.deleteMaterial = material.id;
    remove.disabled = usage > 0;
    if (usage) remove.title = translate(this.#locale, "material.deleteInUse");
    actions.append(assign, unique, duplicate, remove);

    const usageNoticeKey: MessageKey =
      usage > 1
        ? "material.sharedChangeNotice"
        : usage === 1
          ? "material.singleUseNotice"
          : "material.unusedNotice";
    const usageUnitKey: MessageKey =
      usage === 1 ? "material.object" : "material.objects";
    const notice = textElement(
      "p",
      `${translate(this.#locale, "material.usedBy")} ${usage} ${translate(
        this.#locale,
        usageUnitKey,
      )}${this.#locale === "ja" ? "。" : "."} ${translate(
        this.#locale,
        usageNoticeKey,
      )}`,
    );
    notice.id = "material-usage-note";
    notice.className = "material-shared-notice";

    const tabs = element("div", "material-editor-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute(
      "aria-label",
      translate(this.#locale, "material.libraryTitle"),
    );
    for (const tab of ["basic", "advanced"] as const) {
      const button = textElement(
        "button",
        translate(
          this.#locale,
          tab === "basic" ? "material.basic" : "material.advanced",
        ),
      );
      button.setAttribute("type", "button");
      button.setAttribute("role", "tab");
      button.id = materialTabId(tab);
      button.dataset.materialTab = tab;
      button.setAttribute("aria-controls", MATERIAL_TAB_PANEL_ID);
      button.setAttribute("aria-selected", String(tab === this.#editorTab));
      button.tabIndex = tab === this.#editorTab ? 0 : -1;
      button.classList.toggle("is-active", tab === this.#editorTab);
      tabs.append(button);
    }
    const body = element("div", "material-editor-body");
    body.id = MATERIAL_TAB_PANEL_ID;
    body.setAttribute("role", "tabpanel");
    body.setAttribute("aria-labelledby", materialTabId(this.#editorTab));
    body.append(
      this.#editorTab === "basic"
        ? renderMaterialBasicEditor(material, this.#locale)
        : this.#advancedEditor(material),
    );
    this.#detail.replaceChildren(header, actions, notice, tabs, body);
    this.#renderedDetailKey = detailKey;
    this.#syncInputs(material);
  }

  #advancedEditor(material: MaterialSnapshot): HTMLElement {
    const editor = element("div", "material-advanced-editor");
    const intro = element("div", "material-capability-intro");
    intro.append(
      textElement("h4", translate(this.#locale, "material.capabilityTitle")),
      textElement("p", translate(this.#locale, "material.capabilityDescription")),
    );
    const filters = element("div", "material-capability-filters");
    const searchLabel = document.createElement("label");
    searchLabel.append(
      textElement(
        "span",
        this.#locale === "ja" ? "概念を検索" : "Search concepts",
      ),
    );
    const search = document.createElement("input");
    search.type = "search";
    search.autocomplete = "off";
    search.value = this.#capabilityQuery;
    search.placeholder = translate(this.#locale, "material.keyword");
    search.dataset.materialCapabilitySearch = "";
    searchLabel.append(search);
    const supportLabel = document.createElement("label");
    supportLabel.append(textElement("span", translate(this.#locale, "material.supportLabel")));
    const support = document.createElement("select");
    support.dataset.materialCapabilitySupport = "";
    for (const value of ["all", "direct", "approximate", "stored"] as const) {
      support.append(
        this.#option(
          value,
          translate(
            this.#locale,
            value === "all" ? "material.filterAll" : SUPPORT_LABELS[value],
          ),
        ),
      );
    }
    support.value = this.#capabilitySupport;
    supportLabel.append(support);
    filters.append(searchLabel, supportLabel);

    const visible = filterCapabilities(
      MATERIAL_CAPABILITIES,
      this.#capabilityQuery,
      this.#capabilitySupport,
      this.#locale,
    );
    const groups = element("div", "material-capability-groups");
    for (const category of capabilityCategories()) {
      const entries = visible.filter((entry) => entry.category === category);
      if (!entries.length) continue;
      const details = element("details", "material-capability-group");
      details.setAttribute("open", "");
      const summary = document.createElement("summary");
      summary.append(
        textElement("strong", capabilityCategoryLabel(category, this.#locale)),
        textElement("span", String(entries.length)),
      );
      const list = element("div", "material-capability-list");
      list.append(...entries.map((entry) => this.#capabilityRow(material, entry)));
      details.append(summary, list);
      groups.append(details);
    }
    if (!visible.length) {
      const empty = textElement("p", translate(this.#locale, "material.noResultsBody"));
      empty.className = "material-capability-empty";
      groups.append(empty);
    }
    editor.append(intro, filters, groups);
    return editor;
  }

  #capabilityRow(
    material: MaterialSnapshot,
    capability: CapabilitySnapshot,
  ): HTMLElement {
    const row = element("article", "material-capability-row");
    const copy = document.createElement("div");
    const title = textElement("strong", capability.label[this.#locale]);
    const keyword = textElement(
      "code",
      `${this.#locale === "ja" ? "概念ID" : "Concept ID"}: ${capability.id}`,
    );
    const help = textElement("small", capability.help[this.#locale]);
    copy.append(title, keyword, help);
    const status = fidelityToStatus(capability.fidelity);
    const value = resolveCapabilityValue(material, capability.path);
    const valueCell = element("div", "material-capability-value");
    const editable =
      typeof value === "number" &&
      Number.isFinite(value) &&
      !capability.path.includes("*") &&
      !capability.path.includes(":");
    if (editable) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.value = String(value);
      input.setAttribute(
        "aria-label",
        `${capability.label[this.#locale]}, ${translate(this.#locale, "material.value")}`,
      );
      if (capability.path.startsWith("preview.")) {
        input.dataset.materialPreviewId = material.id;
        input.dataset.materialPreviewField = capability.path.slice("preview.".length);
      } else {
        input.dataset.materialPovId = material.id;
        input.dataset.materialPovPath = capability.path;
      }
      valueCell.append(input);
    } else {
      valueCell.append(
        textElement(
          "span",
          formatCapabilityValue(value, this.#locale),
        ),
      );
    }
    const source = textElement("a", this.#locale === "ja" ? "公式資料" : "Reference");
    source.href = capability.sourceUrl;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.className = "material-capability-source";
    copy.append(source);
    row.append(copy, this.#supportBadge(status), valueCell);
    return row;
  }

  #syncInputs(material: MaterialSnapshot): void {
    for (const input of this.#detail.querySelectorAll<HTMLInputElement>(
      "[data-material-preview-field]",
    )) {
      if (input === document.activeElement) continue;
      const key = input.dataset.materialPreviewField as MaterialPreviewField;
      this.#syncPreviewInput(input, material, key);
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
    if (active.dataset.assignMaterial) return { kind: "assign" };
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
      if (focus.kind === "assign") {
        this.#detail
          .querySelector<HTMLButtonElement>(
            ".material-detail-actions button:not(:disabled)",
          )
          ?.focus();
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
    return countMaterialUsage(
      materialId,
      this.#objects.map((object) => object.materialId),
    );
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

  #supportBadge(status: MaterialSupportStatus): HTMLElement {
    const badge = textElement("span", translate(this.#locale, SUPPORT_LABELS[status]));
    badge.className = `material-support-badge is-${status}`;
    badge.title = translate(this.#locale, SUPPORT_DESCRIPTIONS[status]);
    return badge;
  }

  #metaBadge(value: string): HTMLElement {
    const badge = textElement("span", value);
    badge.className = "material-meta-badge";
    return badge;
  }

  #swatch(color: string): HTMLElement {
    const swatch = element("span", "material-swatch");
    swatch.setAttribute("aria-hidden", "true");
    const fill = document.createElement("i");
    fill.style.backgroundColor = color;
    swatch.append(fill);
    return swatch;
  }

  #action(label: MessageKey, className: string): HTMLButtonElement {
    const button = textElement("button", translate(this.#locale, label));
    button.className = className;
    button.setAttribute("type", "button");
    return button;
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

function textElement<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  text: string,
): HTMLElementTagNameMap[Tag] {
  const value = document.createElement(tag);
  value.textContent = text;
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

function materialTabId(tab: MaterialEditorTab): string {
  return `material-editor-tab-${tab}`;
}

function isSupportFilter(
  value: string,
): value is "all" | MaterialSupportStatus {
  return ["all", "direct", "approximate", "stored"].includes(value);
}
