import { translate, type AppLocale, type MessageKey } from "./i18n";
import { materialKindMessageKey } from "./material-detail-state";
import type { MaterialEditorTab, MaterialObjectAssignment } from "./material-library-view-base";
import type { MaterialSupportStatus } from "./material-library-state";
import { MATERIAL_CAPABILITIES } from "../model/material/material-capabilities";
import { SUPPORT_LABELS, SUPPORT_DESCRIPTIONS, capabilityCategories, capabilityCategoryLabel,
  fidelityToStatus, filterCapabilities, formatCapabilityValue, getMaterialSupportStatus,
  resolveCapabilityValue, type CapabilitySnapshot, type MaterialSnapshot } from "./material-capability-ui";
import { renderMaterialBasicEditor } from "./material-basic-editor";
const MATERIAL_TAB_PANEL_ID = "material-editor-panel";
interface DetailContext {
  locale: AppLocale; editorTab: MaterialEditorTab; capabilityQuery: string;
  capabilitySupport: "all" | MaterialSupportStatus;
  object: MaterialObjectAssignment | undefined; usage: number; assigned: boolean;
}
/** Builds material detail actions/tabs and capability content independently of selection and focus. */
export class MaterialDetailView {
  #locale: AppLocale = "ja";
  #editorTab: MaterialEditorTab = "basic";
  #capabilityQuery = "";
  #capabilitySupport: "all" | MaterialSupportStatus = "all";
  build(material: MaterialSnapshot, context: DetailContext): HTMLElement[] {
    const { object, usage, assigned } = context;
    this.#locale = context.locale;
    this.#editorTab = context.editorTab;
    this.#capabilityQuery = context.capabilityQuery;
    this.#capabilitySupport = context.capabilitySupport;
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
    return [header, actions, notice, tabs, body];
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

  #option(value: string, label: string): HTMLOptionElement {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
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

  #action(label: MessageKey, className: string): HTMLButtonElement {
    const button = textElement("button", translate(this.#locale, label));
    button.className = className;
    button.setAttribute("type", "button");
    return button;
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

function materialTabId(tab: MaterialEditorTab): string {
  return `material-editor-tab-${tab}`;
}
