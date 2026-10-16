/** An accessible cancellation surface outside every inert editing region. */
export class ProjectOperation {
  readonly element = document.createElement("dialog");
  readonly #title = document.createElement("strong");
  readonly #status = document.createElement("p");
  readonly #cancel = document.createElement("button");
  readonly #abort = new AbortController();
  #timer: ReturnType<typeof setInterval> | undefined;
  #onCancel: (() => void) | undefined;
  #previousFocus: HTMLElement | null = null;
  #locale = "ja";
  #label = "";
  #started = 0;
  #cancelling = false;

  constructor(parent: HTMLElement) {
    this.element.dataset.projectOperation = "";
    this.element.className = "project-operation";
    this.element.style.cssText = "max-width:min(32rem,calc(100vw - 32px));padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)";
    this.#status.dataset.projectOperationStatus = "";
    this.#status.setAttribute("role", "status");
    this.#cancel.type = "button";
    this.#cancel.dataset.projectCancel = "";
    this.#cancel.style.cssText = "padding:8px 16px;background:var(--surface-raised);color:var(--text);border:1px solid var(--border);border-radius:5px";
    this.#cancel.addEventListener("click", () => this.#requestCancel(), { signal: this.#abort.signal });
    this.element.addEventListener("cancel", event => { event.preventDefault(); this.#requestCancel(); }, { signal: this.#abort.signal });
    this.element.append(this.#title, this.#status, this.#cancel);
    parent.append(this.element);
    this.#render();
  }
  setLocale(locale: string): void { this.#locale = locale; this.#render(); }
  show(label: string, cancel: () => void): void {
    this.#label = label;
    this.#started = Date.now();
    this.#cancelling = false;
    this.#cancel.disabled = false;
    this.#onCancel = cancel;
    this.#previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.#render();
    if (typeof this.element.showModal === "function") this.element.showModal();
    else this.element.setAttribute("open", "");
    this.#cancel.focus();
    this.#timer = setInterval(() => this.#render(), 1000);
  }
  hide(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#onCancel = undefined;
    if (typeof this.element.close === "function") this.element.close();
    else this.element.removeAttribute("open");
    if (this.#previousFocus?.isConnected && !this.#previousFocus.closest("[inert]")) this.#previousFocus.focus();
    this.#previousFocus = null;
  }
  dispose(): void { this.hide(); this.#abort.abort(); this.element.remove(); }
  #requestCancel(): void {
    if (!this.#onCancel || this.#cancelling) return;
    this.#cancelling = true;
    this.#cancel.disabled = true;
    this.#render();
    this.#onCancel();
  }
  #render(): void {
    const english = this.#locale === "en";
    const title = english ? "Loading model / project" : "モデル・プロジェクトを読み込み中";
    this.#title.textContent = title;
    this.element.setAttribute("aria-label", title);
    this.#cancel.textContent = english ? "Cancel loading" : "読み込みを取り消す";
    const elapsed = this.#started ? Math.floor((Date.now() - this.#started) / 1000) : 0;
    this.#status.textContent = this.#cancelling
      ? (english ? "Cancelling… Previous scene will be kept." : "取消処理中… 元のシーンを維持します。")
      : `${this.#label} — ${english ? "Loading / preparing" : "読込・準備中"} (${elapsed}${english ? " s elapsed" : "秒経過"})`;
  }
}
