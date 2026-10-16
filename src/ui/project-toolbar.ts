export interface ProjectActions {
  save(): Promise<void>; open(file: File): Promise<void>; recover(): Promise<void>;
  undo(): void; redo(): void;
}
interface SaveDestinationState {
  state: string;
  savedAt?: number;
  fileName?: string;
  detail?: string;
}
export class ProjectToolbar {
  readonly element = document.createElement("div");
  readonly #status = document.createElement("span");
  readonly #fileStatus = document.createElement("span");
  readonly #autosaveStatus = document.createElement("span");
  #file: SaveDestinationState = { state: "ready" };
  #autosave: SaveDestinationState = { state: "ready" };
  readonly #buttons = new Map<string, HTMLButtonElement>();
  readonly #input = document.createElement("input");
  #locale = "ja";
  readonly #abort = new AbortController();
  #statusKey = "ready";
  #detail = "";
  constructor(parent: HTMLElement, actions: ProjectActions) {
    this.element.className = "project-toolbar";
    this.element.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid var(--border-color,#465066);font-size:12px";
    this.element.setAttribute("role", "toolbar");
    this.#input.type = "file"; this.#input.accept = ".rv3d"; this.#input.hidden = true; this.#input.dataset.projectFile = "";
    const run = (operation: () => Promise<void>) => { void operation().catch(e => this.status(e?.name === "AbortError" ? "cancelled" : "error", e?.name === "AbortError" ? "" : e instanceof Error ? e.message : String(e))); };
    for (const [key, callback] of Object.entries({ save: () => run(actions.save), open: () => this.#input.click(), recover: () => run(actions.recover), undo: actions.undo, redo: actions.redo })) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.projectAction = key;
      button.addEventListener("click", callback, { signal: this.#abort.signal });
      this.#buttons.set(key, button); this.element.append(button);
    }
    this.#input.addEventListener("change", () => { const file = this.#input.files?.[0]; this.#input.value = ""; if (file) run(() => actions.open(file)); }, { signal: this.#abort.signal });
    this.#status.setAttribute("role", "status"); this.#status.dataset.projectStatus = "";
    this.#fileStatus.dataset.projectFileStatus = "";
    this.#autosaveStatus.dataset.projectAutosaveStatus = "";
    for (const status of [this.#fileStatus, this.#autosaveStatus]) status.setAttribute("role", "status");
    this.element.append(this.#input, this.#status, this.#fileStatus, this.#autosaveStatus); parent.prepend(this.element); this.setLocale("ja");
  }
  setLocale(locale: string): void {
    this.#locale = locale;
    const labels = locale === "en" ? { save: "Save project", open: "Open project", recover: "Recover autosave", undo: "Undo", redo: "Redo" } : { save: "プロジェクト保存", open: "開く", recover: "自動保存から復元", undo: "元に戻す", redo: "やり直す" };
    for (const [key, button] of this.#buttons) button.textContent = labels[key as keyof typeof labels];
    this.status(this.#statusKey, this.#detail);
    this.#renderDestinations();
  }
  status(key: string, detail = ""): void {
    this.#statusKey = key; this.#detail = detail;
    const labels: Record<string, string> = this.#locale === "en" ? { ready: "Ready", changed: "Unsaved changes", saving: "Saving…", saved: "Saved", loading: "Opening…", recovered: "Recovered", available: "Autosave available — Recover to open", error: "Failed", unavailable: "No autosave", busy: "Processing…", cancelled: "Cancelled — previous scene retained" } : { ready: "準備完了", changed: "未保存の変更", saving: "保存中…", saved: "保存済み", loading: "読み込み中…", recovered: "復元しました", available: "自動保存あり：復元ボタンで開く", error: "失敗", unavailable: "自動保存はありません", busy: "処理中…", cancelled: "取り消しました：元のシーンを維持しています" };
    this.#status.textContent = `${labels[key] ?? key}${detail ? `: ${detail}` : ""}`;
  }
  fileStatus(state: string, details: Omit<SaveDestinationState, "state"> = {}): void {
    this.#file = { ...this.#file, detail: undefined, ...details, state };
    this.#renderDestinations();
  }
  autosaveStatus(state: string, details: Omit<SaveDestinationState, "state"> = {}): void {
    this.#autosave = { ...this.#autosave, detail: undefined, ...details, state };
    this.#renderDestinations();
  }
  #renderDestinations(): void {
    const english = this.#locale === "en";
    const states: Record<string, string> = english
      ? { ready: "Not saved", changed: "Changes pending", saving: "Saving…", saved: "Saved", error: "Failed", available: "Saved data available" }
      : { ready: "未保存", changed: "未保存の変更あり", saving: "保存中…", saved: "保存済み", error: "失敗", available: "保存データあり" };
    for (const [element, record, destination] of [
      [this.#fileStatus, this.#file, english ? "File export" : "ファイル出力"],
      [this.#autosaveStatus, this.#autosave, english ? "Browser autosave" : "ブラウザ自動保存"],
    ] as const) {
      element.dataset.state = record.state;
      if (record.savedAt !== undefined) element.dataset.savedAt = new Date(record.savedAt).toISOString();
      if (record.fileName) element.dataset.fileName = record.fileName;
      const saved = record.savedAt === undefined ? "" : ` (${english ? "last completed" : "最終完了"}: ${new Date(record.savedAt).toLocaleString(english ? "en-US" : "ja-JP")})`;
      element.textContent = `${destination}: ${states[record.state] ?? record.state}${record.fileName ? ` — ${record.fileName}` : ""}${saved}${record.detail ? ` — ${record.detail}` : ""}`;
    }
  }
  history(canUndo: boolean, canRedo: boolean): void {
    this.#buttons.get("undo")!.disabled = !canUndo; this.#buttons.get("redo")!.disabled = !canRedo;
  }
  dispose(): void { this.#abort.abort(); this.element.remove(); }
}
