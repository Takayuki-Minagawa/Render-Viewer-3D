import { IMPORT_FILE_INPUT_ACCEPT, importerRegistry, type ImportOptions } from "../importers";
import { createImporterDisplayItems, createImportOptions, hasDraggedFiles, importErrorDetail } from "./import-ui-state";
import { translate, type AppLocale, type MessageKey } from "./i18n";
import type { AppActions } from "./app-shell";

type ImportNotice =
  | { kind: "idle" }
  | { kind: "busy"; fileNames: string }
  | { kind: "success"; fileNames: string }
  | { kind: "error"; detail: string };

export type ImportActionResult =
  | { kind: "success" }
  | { kind: "error"; error: unknown }
  | { kind: "disposed" };

export async function runImportActionSafely(
  action: () => Promise<void>,
  isActive: () => boolean,
): Promise<ImportActionResult> {
  try {
    await action();
    return isActive() ? { kind: "success" } : { kind: "disposed" };
  } catch (error) {
    return isActive()
      ? { kind: "error", error }
      : { kind: "disposed" };
  }
}

export class ImportDialogController {
  readonly #root: HTMLElement;
  readonly viewportElement: HTMLElement;
  readonly #importButton: HTMLButtonElement;
  readonly #importDialog: HTMLDialogElement;
  readonly #importFileInput: HTMLInputElement;
  readonly #importStatus: HTMLElement;
  readonly #dropOverlay: HTMLElement;
  #importBusy = false;
  #disposed = false;
  #importNotice: ImportNotice = { kind: "idle" };
  #locale: AppLocale = "ja";
  constructor(root: HTMLElement, viewport: HTMLElement) {
    this.#root = root;
    this.viewportElement = viewport;
    this.#importButton = this.#query("[data-action='import']");
    this.#importDialog = this.#query("[data-import-dialog]");
    this.#importFileInput = this.#query("[data-import-file-input]");
    this.#importStatus = this.#query("[data-import-status]");
    this.#dropOverlay = this.#query("[data-drop-overlay]");
    this.#importFileInput.accept = IMPORT_FILE_INPUT_ACCEPT;
  }
  get isOpen(): boolean { return this.#importDialog.open; }
  setLocale(locale: AppLocale): void {
    this.#locale = locale;
    this.#renderImporterList();
    this.#renderImportNotice();
  }
  dispose(): void { this.#disposed = true; }
  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required import element not found: ${selector}`);
    return element;
  }
  bind(
    actions: Pick<AppActions, "importFiles">,
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

  async #runImport(files: readonly File[], actions: Pick<AppActions, "importFiles">): Promise<void> {
    if (this.#disposed || this.#importBusy || files.length === 0) return;
    const fileNames = this.#summarizeFileNames(files);
    this.#importBusy = true;
    this.#importNotice = { kind: "busy", fileNames };
    this.#setImportControlsDisabled(true);
    this.#renderImportNotice();
    try {
      const result = await runImportActionSafely(
        () => actions.importFiles(files, this.#readImportOptions()),
        () => !this.#disposed,
      );
      if (result.kind === "success") {
        this.#importNotice = { kind: "success", fileNames };
      } else if (result.kind === "error") {
        console.error("Model import failed.", result.error);
        this.#importNotice = {
          kind: "error",
          detail: importErrorDetail(result.error),
        };
      }
    } finally {
      this.#importBusy = false;
      if (!this.#disposed) {
        this.#setImportControlsDisabled(false);
        this.#renderImportNotice();
      }
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
      this.#locale,
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
          this.#locale,
          "import.experimental",
        );
        row.append(badge);
      }
      fragment.append(row);
    }
    list.replaceChildren(fragment);
  }

}
