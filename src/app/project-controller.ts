import type { ImportManager } from "../importers";
import type { SceneStore } from "./scene-store";
import type { EditorStore } from "./editor-store";
import type { ImportedAssetStore } from "../three/imported-asset-store";
import type { MaterialImageAssetStore } from "../three/material/image-asset-store";
import { decodeProject, encodeProject } from "./project-format";
import { readAutosave, writeAutosave } from "./autosave";
import { SceneHistory } from "./scene-history";
import type { ProjectAssets } from "./project-assets";
import { inspectHdrHeader } from "../three/hdr-environment";
import { ProjectToolbar } from "../ui/project-toolbar";
import { ProjectOperation } from "../ui/project-operation";
import { throwIfImportAborted } from "../importers/abort";
/** Additional staged CPU/GPU estimate, separate from the 512 MiB source container.
 * The current scene stays alive for rollback. Per-import limits still bound one parser's
 * transient peak; this guard stops accumulation across many individually valid imports.
 */
export const PROJECT_RESTORE_MAX_RESIDENT_BYTES = 512 * 1024 * 1024;
export interface PreparedEnvironment { commit(): void; dispose(): void; }
export interface ProjectOperationOptions { cancellable?: boolean; label?: string; }

export class ProjectController {
  readonly toolbar: ProjectToolbar;
  readonly #operation: ProjectOperation;
  #busy = false;
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saveQueue = Promise.resolve();
  #revision = 0;
  #fileSavedRevision = 0;
  #autosavedRevision = 0;
  #operationVersion = 0;
  readonly #abort = new AbortController();
  readonly #unsubscribe: () => void;
  readonly #unsubscribeHistory: () => void;

  constructor(readonly root: HTMLElement, readonly store: SceneStore, readonly editor: EditorStore,
    readonly manager: ImportManager, readonly assets: ImportedAssetStore, readonly images: MaterialImageAssetStore,
    readonly sources: ProjectAssets, readonly history: SceneHistory,
    readonly prepareEnvironment?: (file: File | null, assetId: string | null) => Promise<PreparedEnvironment>) {
    this.toolbar = new ProjectToolbar(root, {
      save: () => this.save(), open: file => this.open(file), recover: () => this.recover(),
      undo: () => this.undo(), redo: () => this.redo(),
    });
    this.#operation = new ProjectOperation(root);
    this.#unsubscribeHistory = history.subscribe(() => {
      this.toolbar.history(history.canUndo, history.canRedo);
      if (!history.editing && this.#revision > this.#autosavedRevision) this.#schedule();
    });
    let initial = true;
    this.#unsubscribe = store.subscribe(() => {
      if (initial) { initial = false; return; }
      this.#revision += 1;
      this.toolbar.fileStatus("changed");
      this.toolbar.autosaveStatus("changed");
      if (!this.#busy) { this.toolbar.status("changed"); this.#schedule(); }
    });
    document.addEventListener("keydown", event => {
      if (this.#busy && ((!event.ctrlKey && !event.metaKey && ["w", "e", "r", "Delete", "Backspace"].includes(event.key)) || ((event.ctrlKey || event.metaKey) && ["d", "z", "y", "s"].includes(event.key.toLowerCase())))) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      const target = event.target;
      const editing = target instanceof HTMLElement && (!!target.closest("input,textarea,select,[contenteditable=true]") || !!target.closest("dialog[open]"));
      if (this.#busy || editing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) this.redo(); else this.undo(); }
      else if (event.key.toLowerCase() === "y") { event.preventDefault(); this.redo(); }
      else if (event.key.toLowerCase() === "s") { event.preventDefault(); void this.save().catch(e => this.toolbar.status("error", String(e))); }
    }, { signal: this.#abort.signal, capture: true });
    window.addEventListener("beforeunload", event => {
      if (this.#revision > Math.max(this.#fileSavedRevision, this.#autosavedRevision) || this.#busy) { event.preventDefault(); event.returnValue = ""; }
    }, { signal: this.#abort.signal });
    void readAutosave().then(blob => {
      if (blob && !this.#disposed && this.#revision === 0 && this.#operationVersion === 0) {
        this.toolbar.autosaveStatus("available"); this.toolbar.status("available");
      }
    }).catch(error => {
      if (!this.#disposed && this.#revision === 0 && this.#operationVersion === 0) {
        this.toolbar.autosaveStatus("error", { detail: String(error) });
        this.toolbar.status("error", `Autosave: ${String(error)}`);
      }
    });
  }
  get busy(): boolean { return this.#busy; }
  setLocale(locale: string): void { this.toolbar.setLocale(locale); this.#operation.setLocale(locale); }
  undo(): void { if (!this.#busy) this.history.undo(); }
  redo(): void { if (!this.#busy) this.history.redo(); }

  async editAsync<T>(operation: (signal: AbortSignal) => Promise<T>, options: ProjectOperationOptions = {}): Promise<T> {
    return this.#exclusive(async signal => {
      this.history.end();
      const before = this.store.getSnapshot();
      this.history.begin();
      try {
        const result = await operation(signal);
        throwIfImportAborted(signal);
        this.history.end();
        return result;
      } catch (error) {
        // A failed startup has not edited anything. Do not replace the unchanged
        // snapshot and mark both save destinations dirty just to end the group.
        if (this.store.getSnapshot() === before) this.history.end();
        else this.history.cancel();
        throw error;
      }
    }, options);
  }
  async save(): Promise<void> {
    await this.#exclusive(async () => {
      this.history.end();
      this.toolbar.status("saving");
      this.toolbar.fileStatus("saving");
      const revision = this.#revision;
      try {
        const snapshot = this.store.getSnapshot();
        const blob = await encodeProject(snapshot, this.sources, this.images);
        if (this.#disposed) return;
        const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
        const fileName = `${snapshot.name.replace(/[^\p{L}\p{N}._-]/gu, "_") || "scene"}.rv3d`;
        anchor.href = url; anchor.download = fileName;
        try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
        this.#fileSavedRevision = revision;
        this.toolbar.fileStatus(revision === this.#revision ? "saved" : "changed", { fileName, savedAt: Date.now() });
        this.toolbar.status("saved", fileName);
      } catch (error) {
        if (!this.#disposed) this.toolbar.fileStatus("error", { detail: String(error) });
        throw error;
      }
    });
  }
  async recover(): Promise<void> {
    if (this.#busy) return;
    const blob = await readAutosave();
    if (!blob) { this.toolbar.status("unavailable"); return; }
    await this.open(blob);
  }
  async open(blob: Blob): Promise<void> {
    await this.#exclusive(async signal => {
      this.toolbar.status("loading");
      this.history.end();
      const decoded = await decodeProject(blob);
      throwIfImportAborted(signal);
      const preparedImports: string[] = []; const preparedImages: string[] = [];
      const prefix = `project-${crypto.randomUUID()}`;
      const oldModel = this.store.getSnapshot();
      let preparedEnvironment: PreparedEnvironment | undefined;
      let environmentId: string | undefined;
      let publishing = false;
      let stagedBytes = 0;
      const accountStagedBytes = (bytes: number) => {
        stagedBytes += bytes;
        if (!Number.isFinite(stagedBytes) || stagedBytes > PROJECT_RESTORE_MAX_RESIDENT_BYTES) {
          throw new Error("Project decoded resource limit exceeded (512 MiB staged CPU/GPU estimate). / 復元データの推定メモリ上限512 MiBを超えています。");
        }
      };
      try {
        for (const imported of decoded.model.imports) {
          const source = decoded.imports.get(imported.assetId)!;
          const primary = source.files.find(file => (file.webkitRelativePath || file.name) === source.primaryPath)!;
          const loaded = await this.manager.import(primary, source.files, { ...source.options, signal });
          const id = `${prefix}-${preparedImports.length}`;
          this.assets.register(id, loaded.root); preparedImports.push(id);
          throwIfImportAborted(signal);
          accountStagedBytes(this.assets.estimatedBytes(id));
          this.sources.capture(id, primary, source.files, source.options);
          imported.assetId = id;
        }
        const imageMap = new Map<string, string>();
        const numericImages = new Set(decoded.model.materials.flatMap(material => Object.values(material.maps ?? {}).flatMap(map => map ? [map.assetId] : [])));
        for (const [oldId, file] of decoded.images) {
          const descriptor = await this.images.importFile(file, numericImages.has(oldId));
          preparedImages.push(descriptor.assetId);
          throwIfImportAborted(signal);
          accountStagedBytes(this.images.estimatedBytes(descriptor.assetId));
          imageMap.set(oldId, descriptor.assetId);
        }
        const remap = (value: unknown): void => {
          if (!value || typeof value !== "object") return;
          if ("assetId" in value && typeof value.assetId === "string" && imageMap.has(value.assetId)) value.assetId = imageMap.get(value.assetId)!;
          for (const child of Object.values(value)) remap(child);
        };
        remap(decoded.model.materials);
        if (decoded.model.environment && decoded.environment) {
          const dimensions = inspectHdrHeader(new Uint8Array(await decoded.environment.slice(0, 65536).arrayBuffer()));
          // RGBA16F source on CPU and GPU; the separately bounded renderer environment
          // conversion can also allocate transient render targets during publication.
          accountStagedBytes(dimensions.width * dimensions.height * 16);
          environmentId = `${prefix}-environment`;
          decoded.model.environment.assetId = environmentId;
          this.sources.environments.set(environmentId, decoded.environment);
        }
        preparedEnvironment = await this.prepareEnvironment?.(decoded.environment ?? null, environmentId ?? null);
        throwIfImportAborted(signal);
        if (this.#disposed) throw new Error("Project restore was cancelled.");
        this.history.begin(); // Pins the old scene until publication succeeds.
        publishing = true;
        preparedEnvironment?.commit();
        this.store.replace(decoded.model);
        this.history.clear();
        this.editor.setSelectedObjectId(decoded.model.objects[0]?.id ?? decoded.model.imports[0]?.id ?? null);
        this.toolbar.status("recovered");
      } catch (error) {
        if (publishing) { this.store.replace(oldModel); this.history.cancel(); }
        for (const id of preparedImports) { this.assets.delete(id); this.sources.imports.delete(id); }
        for (const id of preparedImages) this.images.delete(id);
        if (environmentId) this.sources.environments.delete(environmentId);
        throw error;
      } finally { preparedEnvironment?.dispose(); }
    }, { cancellable: true, label: blob instanceof File ? blob.name : ".rv3d" });
  }
  dispose(): void {
    this.#disposed = true; clearTimeout(this.#timer); this.#abort.abort();
    this.#unsubscribe(); this.#unsubscribeHistory(); this.#operation.dispose(); this.toolbar.dispose();
  }
  async #exclusive<T>(operation: (signal: AbortSignal) => Promise<T>, options: ProjectOperationOptions = {}): Promise<T> {
    if (this.#disposed || this.#busy) throw new Error("Another project operation is in progress.");
    this.#busy = true; this.#operationVersion += 1; clearTimeout(this.#timer);
    const cancellation = new AbortController();
    const signal = cancellation.signal;
    const cancelOnDispose = () => cancellation.abort(this.#abort.signal.reason);
    this.#abort.signal.addEventListener("abort", cancelOnDispose, { once: true });
    // showModal() dialogs escape inherited inertness in the top layer. Mark each
    // app dialog explicitly so file decode/restore cannot race modal edits.
    const lockedElements = new Set<HTMLElement>([
      ...[...this.root.querySelectorAll<HTMLElement>(".app-shell, dialog")].filter(element => element !== this.#operation.element),
      this.toolbar.element,
    ]);
    const priorInert = [...lockedElements].map(element => ({ element, inert: element.inert }));
    try {
      // Capture focus before locking it; the progress dialog escapes modal/inert
      // regions and remains keyboard-accessible even above an existing dialog.
      if (options.cancellable) this.#operation.show(options.label ?? ".rv3d", () => {
        cancellation.abort(new DOMException("Loading cancelled. / 読み込みを取り消しました。", "AbortError"));
      });
      for (const { element } of priorInert) element.inert = true;
      if (options.cancellable) this.toolbar.status("busy", options.label);
      return await operation(signal);
    } catch (error) {
      if (!this.#disposed) this.toolbar.status(signal.aborted ? "cancelled" : "error", signal.aborted ? "" : String(error));
      throw error;
    }
    finally {
      this.#abort.signal.removeEventListener("abort", cancelOnDispose);
      this.#busy = false;
      for (const { element, inert } of priorInert) element.inert = inert;
      if (options.cancellable) this.#operation.hide();
      if (!this.#disposed && this.#revision > this.#autosavedRevision) this.#schedule();
    }
  }
  #schedule(): void {
    if (this.#disposed || this.#busy || this.history.editing) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      const revision = this.#revision;
      // Serialize encodes and IDB writes so a slower old save cannot replace a newer one.
      this.#saveQueue = this.#saveQueue.then(async () => {
        if (this.#disposed || this.#busy || this.history.editing || revision !== this.#revision) return;
        const operationVersion = this.#operationVersion;
        this.toolbar.autosaveStatus("saving");
        this.toolbar.status("saving");
        const blob = await encodeProject(this.store.getSnapshot(), this.sources, this.images);
        if (this.#disposed || this.#busy || this.history.editing || revision !== this.#revision) return;
        await writeAutosave(blob);
        if (this.#disposed) return;
        this.#autosavedRevision = revision;
        this.toolbar.autosaveStatus(revision === this.#revision ? "saved" : "changed", { savedAt: Date.now() });
        if (!this.#busy && revision === this.#revision && operationVersion === this.#operationVersion) this.toolbar.status("saved");
      }).catch(error => {
        if (!this.#disposed) {
          this.toolbar.autosaveStatus("error", { detail: String(error) });
          if (!this.#busy) this.toolbar.status("error", `Autosave: ${String(error)}`);
        }
      });
    }, 800);
  }
}
