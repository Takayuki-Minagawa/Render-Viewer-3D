import type { ReviewController } from "../app/review-controller";
import { REVIEW_NAME_LIMIT, REVIEW_TEXT_LIMIT } from "../model/review-model";

const labels = {
  ja: { title: "レビュー・計測", name: "名称", note: "注記本文", views: "保存した視点", saveView: "視点を登録", updateView: "現在の状態で更新", apply: "呼出し", remove: "削除", annotation: "注記を配置", distance: "2点距離", angle: "3点角度", bounds: "選択の外形寸法", snap: "近くの三角形頂点にsnap", unit: "単位", items: "注記・計測", update: "名称・本文を更新", reattach: "注記を再取付", cancel: "取消 (Esc)", none: "選択してください", unresolved: "参照切れ・非表示", pending: "面上の点を選択", pickAnnotation: "面上を1回クリック", pickDistance: "2点を順にクリック", pickAngle: "始点・角の頂点・終点の順にクリック", noteLimits: "三角形表面の近似計測。外形はワールド座標軸。静的meshのみ。注記はPNGに含まれません。", ready: "", defaultName: "確認事項" },
  en: { title: "Review & measurements", name: "Name", note: "Annotation text", views: "Saved views", saveView: "Save view", updateView: "Replace with current view", apply: "Recall", remove: "Delete", annotation: "Place annotation", distance: "Distance (2 points)", angle: "Angle (3 points)", bounds: "Selected bounds", snap: "Snap to nearby triangle vertices", unit: "Unit", items: "Annotations & measurements", update: "Update name / text", reattach: "Reattach annotation", cancel: "Cancel (Esc)", none: "Select an item", unresolved: "Unresolved / hidden", pending: "Pick surface points", pickAnnotation: "Click a surface once", pickDistance: "Click two points in order", pickAngle: "Click start, angle vertex, end", noteLimits: "Approximate mesh measurements; world-axis bounds. Static meshes only. PNG excludes annotations.", ready: "", defaultName: "Review item" },
};
type ListKind = "views" | "annotations" | "measurements";
export class ReviewPanel {
  readonly element = document.createElement("details");
  readonly #abort = new AbortController();
  readonly #unsubscribe: () => void;
  #locale: "ja" | "en" = "ja";
  #viewsSignature = "";
  #itemsSignature = "";
  #error = "";
  constructor(container: HTMLElement, private readonly controller: ReviewController) {
    this.element.className = "review-panel";
    this.element.innerHTML = `<style>.review-panel{flex:0 1 auto;min-height:34px;max-height:50vh;overflow:auto;padding:10px 12px;border-top:1px solid var(--border-color,#42516a);font:12px/1.5 system-ui}.review-panel summary{font-weight:600;cursor:pointer}.review-body{display:grid;gap:8px;padding-top:8px}.review-body label{display:grid;gap:3px}.review-body input,.review-body textarea,.review-body select{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:var(--input-bg,#192332);border:1px solid #607086;border-radius:4px;padding:4px}.review-body button{font:inherit;padding:4px;margin:2px}.review-body .review-row{display:flex;flex-wrap:wrap;gap:3px}.review-body label.review-check{display:flex;align-items:center}.review-body input[type=checkbox]{width:auto}.review-body textarea{resize:vertical;min-height:45px}.review-body output{overflow-wrap:anywhere;white-space:pre-wrap}.review-body small{opacity:.8}</style>
      <summary data-review-label="title"></summary><div class="review-body">
      <label><span data-review-label="name"></span><input data-review="name" maxlength="${REVIEW_NAME_LIMIT}"></label>
      <label><span data-review-label="note"></span><textarea data-review="text" maxlength="${REVIEW_TEXT_LIMIT}"></textarea></label>
      <label><span data-review-label="views"></span><select data-review="views"></select></label>
      <div class="review-row">${["saveView", "apply", "updateView"].map(id => `<button type="button" data-review="${id}" data-review-label="${id}"></button>`).join("")}<button type="button" data-review="removeView" data-review-label="remove"></button></div>
      <div class="review-row">${["annotation", "distance", "angle", "bounds"].map(id => `<button type="button" data-review="${id}" data-review-label="${id}"></button>`).join("")}</div>
      <label class="review-check"><input data-review="snap" type="checkbox"><span data-review-label="snap"></span></label>
      <label><span data-review-label="unit"></span><select data-review="unit"><option>mm</option><option>cm</option><option>m</option></select></label>
      <button type="button" data-review="cancel" data-review-label="cancel"></button>
      <label><span data-review-label="items"></span><select data-review="items"></select></label><output data-review="value"></output>
      <div class="review-row"><button type="button" data-review="update" data-review-label="update"></button><button type="button" data-review="reattach" data-review-label="reattach"></button><button type="button" data-review="removeItem" data-review-label="remove"></button></div>
      <output data-review="status" role="status" aria-live="polite"></output><small data-review-label="noteLimits"></small></div>`;
    container.append(this.element); this.setLocale("ja");
    const on = (id: string, event: string, callback: () => void) => this.#get(id).addEventListener(event, () => {
      this.#error = "";
      try { callback(); } catch (error) { this.#error = error instanceof Error ? error.message : String(error); }
      this.#render();
    }, { signal: this.#abort.signal });
    const name = () => this.#get<HTMLInputElement>("name").value || labels[this.#locale].defaultName;
    const text = () => this.#get<HTMLTextAreaElement>("text").value;
    on("saveView", "click", () => controller.saveView(name()));
    on("apply", "click", () => controller.applyView(this.#get<HTMLSelectElement>("views").value));
    on("updateView", "click", () => { const id = this.#get<HTMLSelectElement>("views").value; if (id) controller.saveView(name(), id); });
    on("removeView", "click", () => controller.remove("views", this.#get<HTMLSelectElement>("views").value));
    on("views", "change", () => { const view = controller.state.model.review.views.find(view => view.id === this.#get<HTMLSelectElement>("views").value); if (view) this.#get<HTMLInputElement>("name").value = view.name; });
    for (const mode of ["annotation", "distance", "angle"] as const) on(mode, "click", () => controller.start(mode, name(), text()));
    on("bounds", "click", () => controller.addBounds(name()));
    on("snap", "change", () => controller.setSnap(this.#get<HTMLInputElement>("snap").checked));
    on("unit", "change", () => controller.setUnit(this.#get<HTMLSelectElement>("unit").value as "mm" | "cm" | "m"));
    on("cancel", "click", () => controller.cancel());
    on("items", "change", () => {
      const item = this.#selected(); if (!item) return;
      const model = controller.state.model.review[item.kind].find(value => value.id === item.id);
      if (model) { this.#get<HTMLInputElement>("name").value = model.name; this.#get<HTMLTextAreaElement>("text").value = "text" in model ? model.text : ""; }
    });
    on("update", "click", () => { const item = this.#selected(); if (item) controller.rename(item.kind, item.id, name(), item.kind === "annotations" ? text() : undefined); });
    on("removeItem", "click", () => { const item = this.#selected(); if (item) controller.remove(item.kind, item.id); });
    on("reattach", "click", () => { const item = this.#selected(); if (item?.kind === "annotations") controller.reattach(item.id); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && controller.state.mode) { controller.cancel(); event.preventDefault(); } }, { signal: this.#abort.signal });
    this.#unsubscribe = controller.subscribe(() => this.#render());
  }
  setLocale(locale: "ja" | "en"): void {
    this.#locale = locale;
    const t = labels[locale];
    this.element.querySelectorAll<HTMLElement>("[data-review-label]").forEach(node => { node.textContent = t[node.dataset.reviewLabel as keyof typeof t]; });
    this.#viewsSignature = ""; this.#itemsSignature = ""; this.#render();
  }
  dispose(): void { this.#abort.abort(); this.#unsubscribe(); this.element.remove(); }
  #get<T extends HTMLElement = HTMLElement>(name: string): T { return this.element.querySelector<T>(`[data-review="${name}"]`)!; }
  #selected(): { kind: Exclude<ListKind, "views">; id: string } | null {
    const value = this.#get<HTMLSelectElement>("items").value;
    if (!value) return null;
    const [kind, ...rest] = value.split(":"); return { kind: kind as Exclude<ListKind, "views">, id: rest.join(":") };
  }
  #options(id: string, entries: { id: string; name: string }[]): void {
    const select = this.#get<HTMLSelectElement>(id), value = select.value;
    select.replaceChildren();
    for (const entry of [{ id: "", name: labels[this.#locale].none }, ...entries]) { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.name; select.append(option); }
    select.value = entries.some(entry => entry.id === value) ? value : "";
  }
  #render(): void {
    const state = this.controller.state, t = labels[this.#locale], model = state.model.review;
    const viewsSignature = JSON.stringify(model.views.map(view => [view.id, view.name]));
    if (viewsSignature !== this.#viewsSignature) { this.#viewsSignature = viewsSignature; this.#options("views", model.views.map(view => ({ id: view.id, name: view.name }))); }
    const displays = this.controller.displayItems();
    const items = displays.map(item => ({ id: `${item.kind === "annotation" ? "annotations" : "measurements"}:${item.id}`, name: `${item.name}${item.unresolved ? ` (${t.unresolved})` : ""}` }));
    const itemsSignature = JSON.stringify(items);
    if (itemsSignature !== this.#itemsSignature) { this.#itemsSignature = itemsSignature; this.#options("items", items); }
    const selected = this.#selected(), display = selected && displays.find(item => item.id === selected.id);
    this.#get("value").textContent = display ? display.unresolved ? t.unresolved : display.text : "";
    this.#get<HTMLInputElement>("snap").checked = state.snap;
    this.#get<HTMLSelectElement>("unit").value = state.unit;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("button")) button.disabled = state.busy;
    for (const id of ["apply", "updateView", "removeView"]) this.#get<HTMLButtonElement>(id).disabled = state.busy || !this.#get<HTMLSelectElement>("views").value;
    for (const id of ["update", "removeItem"]) this.#get<HTMLButtonElement>(id).disabled = state.busy || !selected;
    this.#get<HTMLButtonElement>("reattach").disabled = state.busy || selected?.kind !== "annotations";
    this.#get<HTMLButtonElement>("cancel").disabled = !state.mode;
    const instruction = state.mode === "distance" ? t.pickDistance : state.mode === "angle" ? t.pickAngle : t.pickAnnotation;
    this.#get("status").textContent = this.#error || state.message || (state.mode ? `${instruction} (${state.pending.length} / ${state.mode === "angle" ? 3 : state.mode === "distance" ? 2 : 1})` : t.ready);
  }
}
