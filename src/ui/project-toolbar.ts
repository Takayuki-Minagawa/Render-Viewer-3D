export interface ProjectActions {
  save(): Promise<void>; open(file: File): Promise<void>; recover(): Promise<void>;
  undo(): void; redo(): void;
}
export class ProjectToolbar {
  readonly element = document.createElement("div");
  readonly #status = document.createElement("span");
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
    const run = (operation: () => Promise<void>) => { void operation().catch(e => this.status("error", e instanceof Error ? e.message : String(e))); };
    for (const [key, callback] of Object.entries({ save: () => run(actions.save), open: () => this.#input.click(), recover: () => run(actions.recover), undo: actions.undo, redo: actions.redo })) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.projectAction = key;
      button.addEventListener("click", callback, { signal: this.#abort.signal });
      this.#buttons.set(key, button); this.element.append(button);
    }
    this.#input.addEventListener("change", () => { const file = this.#input.files?.[0]; this.#input.value = ""; if (file) run(() => actions.open(file)); }, { signal: this.#abort.signal });
    this.#status.setAttribute("role", "status"); this.#status.dataset.projectStatus = "";
    this.element.append(this.#input, this.#status); parent.prepend(this.element); this.setLocale("ja");
  }
  setLocale(locale: string): void {
    this.#locale = locale;
    const labels = locale === "en" ? { save: "Save project", open: "Open project", recover: "Recover autosave", undo: "Undo", redo: "Redo" } : { save: "プロジェクト保存", open: "開く", recover: "自動保存から復元", undo: "元に戻す", redo: "やり直す" };
    for (const [key, button] of this.#buttons) button.textContent = labels[key as keyof typeof labels];
    this.status(this.#statusKey, this.#detail);
  }
  status(key: string, detail = ""): void {
    this.#statusKey = key; this.#detail = detail;
    const labels: Record<string, string> = this.#locale === "en" ? { ready: "Ready", changed: "Unsaved changes", saving: "Saving…", saved: "Saved", loading: "Opening…", recovered: "Recovered", available: "Autosave available — Recover to open", error: "Failed", unavailable: "No autosave", busy: "Processing…" } : { ready: "準備完了", changed: "未保存の変更", saving: "保存中…", saved: "保存済み", loading: "読み込み中…", recovered: "復元しました", available: "自動保存あり：復元ボタンで開く", error: "失敗", unavailable: "自動保存はありません", busy: "処理中…" };
    this.#status.textContent = `${labels[key] ?? key}${detail ? `: ${detail}` : ""}`;
  }
  history(canUndo: boolean, canRedo: boolean): void {
    this.#buttons.get("undo")!.disabled = !canUndo; this.#buttons.get("redo")!.disabled = !canRedo;
  }
  dispose(): void { this.#abort.abort(); this.element.remove(); }
}
