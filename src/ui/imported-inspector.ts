import type { SceneSnapshot } from "../model/scene-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import { PrimitiveInspector } from "./primitive-inspector";
type ImportedModel = SceneSnapshot["imports"][number];
export class ImportedInspector {
  readonly #primitiveInspector = new PrimitiveInspector();
  createImportedMetadataSection(
    imported: ImportedModel,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.#primitiveInspector.createSection("inspector.metadata", locale);
    const metadata = imported.metadata;
    const entries: [MessageKey, string][] = [
      ["inspector.fileName", metadata.fileName],
      ["inspector.format", metadata.format],
      ["inspector.objectCount", metadata.objectCount.toLocaleString()],
      ["inspector.triangleCount", metadata.triangleCount.toLocaleString()],
      ["inspector.materialCount", metadata.materialCount.toLocaleString()],
      ["inspector.fileSize", this.#formatFileSize(metadata.sizeBytes)],
      ["inspector.unit", metadata.unit ?? metadata.sourceUnit ?? "-"],
    ];
    if (metadata.animationCount !== undefined) {
      entries.push([
        "inspector.animationCount",
        metadata.animationCount.toLocaleString(),
      ]);
    }
    const list = document.createElement("dl");
    list.className = "import-metadata-list";
    for (const [key, value] of entries) {
      const term = document.createElement("dt");
      term.textContent = translate(locale, key);
      const description = document.createElement("dd");
      description.textContent = value;
      list.append(term, description);
    }
    section.append(list);
    return section;
  }

  createImportedWarningsSection(
    imported: ImportedModel,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.#primitiveInspector.createSection("inspector.importWarnings", locale);
    if (imported.warnings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "import-warning-empty";
      empty.textContent = translate(locale, "inspector.noImportWarnings");
      section.append(empty);
      return section;
    }
    const list = document.createElement("ul");
    list.className = "import-warning-list";
    for (const warning of imported.warnings) {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = warning.code;
      const message = document.createElement("span");
      message.textContent = warning.message;
      item.append(code, message);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  createImportedMaterialSection(
    imported: ImportedModel,
    materials: SceneSnapshot["materials"],
    locale: AppLocale,
  ): HTMLElement {
    const section = this.#primitiveInspector.createSection("inspector.material", locale);
    const modes = document.createElement("fieldset");
    modes.className = "import-material-modes";
    const legend = document.createElement("legend");
    legend.textContent = translate(locale, "inspector.materialMode");
    modes.append(legend);
    for (const mode of ["imported", "custom"] as const) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "import-material-mode";
      input.value = mode;
      input.dataset.importMaterialMode = imported.id;
      input.checked = imported.materialMode === mode;
      input.disabled = mode === "custom" && materials.length === 0;
      const text = document.createElement("span");
      text.textContent = translate(
        locale,
        mode === "imported"
          ? "inspector.materialImported"
          : "inspector.materialCustom",
      );
      label.append(input, text);
      modes.append(label);
    }
    const materialLabel = document.createElement("label");
    materialLabel.className = "field-label import-material-select";
    const materialText = document.createElement("span");
    materialText.textContent = translate(locale, "inspector.customMaterial");
    const select = document.createElement("select");
    select.dataset.importMaterialSelect = imported.id;
    select.dataset.importCurrentMode = imported.materialMode;
    select.disabled = materials.length === 0;
    for (const material of materials) {
      const option = document.createElement("option");
      option.value = material.id;
      option.textContent = material.name;
      select.append(option);
    }
    const selectedMaterialId = materials.some(
      ({ id }) => id === imported.customMaterialId,
    )
      ? imported.customMaterialId
      : materials[0]?.id;
    if (selectedMaterialId) select.value = selectedMaterialId;
    materialLabel.append(materialText, select);
    const help = document.createElement("p");
    help.className = "import-material-help";
    help.textContent = translate(locale, "inspector.materialModeHelp");
    section.append(modes, materialLabel, help);
    if (selectedMaterialId) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "import-material-open";
      open.dataset.openMaterialLibrary = selectedMaterialId;
      open.textContent = translate(locale, "inspector.materialOpen");
      section.append(open);
    }
    return section;
  }

  createImportedActionSection(
    imported: ImportedModel,
    locale: AppLocale,
  ): HTMLElement {
    const section = this.#primitiveInspector.createSection("inspector.actions", locale);
    const actions = document.createElement("div");
    actions.className = "object-actions is-delete-only";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-action";
    remove.dataset.deleteObject = imported.id;
    remove.textContent = translate(locale, "inspector.delete");
    remove.setAttribute(
      "aria-label",
      `${translate(locale, "inspector.delete")}: ${imported.name}`,
    );
    actions.append(remove);
    section.append(actions);
    return section;
  }

  #formatFileSize(sizeBytes: number): string {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "—";
    if (sizeBytes < 1_000) return `${sizeBytes} B`;
    if (sizeBytes < 1_000_000) return `${(sizeBytes / 1_000).toFixed(1)} KB`;
    if (sizeBytes < 1_000_000_000) {
      return `${(sizeBytes / 1_000_000).toFixed(1)} MB`;
    }
    return `${(sizeBytes / 1_000_000_000).toFixed(1)} GB`;
  }

}
