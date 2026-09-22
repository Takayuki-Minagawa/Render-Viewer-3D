import type { SceneStore } from "./scene-store";
import type { DeepReadonly, SceneSnapshot, Vec3Model } from "../model/scene-model";
import { applyReviewVisibility, boundsDimensions, captureReviewVisibility, measureAngle, measureDistance, REVIEW_ITEM_LIMIT, reviewName, reviewText,
  type ReviewAnchor, type ReviewBounds, type ReviewClipping, type ReviewMeasurement } from "../model/review-model";

export interface ReviewViewport {
  getClipping(): ReviewClipping;
  setClipping(clipping: ReviewClipping): void;
  resolveAnchor(anchor: DeepReadonly<ReviewAnchor>): Vec3Model | null;
  isAnchorVisible?(anchor: DeepReadonly<ReviewAnchor>): boolean;
  getBounds(rootId: string, nodeId?: string): ReviewBounds | null;
  projectPoint(point: Vec3Model): { x: number; y: number; visible: boolean };
  setPicking(active: boolean, snap: boolean): void;
  requestRender(): void;
  getSelectedRootId(): string | null;
  getSelectedNodeId?(): string | null;
}
export type ReviewPickMode = "annotation" | "distance" | "angle" | "reattach" | null;
export interface ReviewDisplayItem { id: string; name: string; text: string; points: Vec3Model[]; anchors?: readonly DeepReadonly<ReviewAnchor>[]; unresolved: boolean; kind: "annotation" | "distance" | "angle" | "bounds"; }
export interface ReviewControllerState {
  model: SceneSnapshot;
  mode: ReviewPickMode;
  pending: readonly DeepReadonly<ReviewAnchor>[];
  preview: DeepReadonly<ReviewAnchor> | null;
  snap: boolean;
  unit: "mm" | "cm" | "m";
  message: string;
  busy: boolean;
}
export class ReviewController {
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<() => void>();
  #mode: ReviewPickMode = null;
  #pending: ReviewAnchor[] = [];
  #preview: ReviewAnchor | null = null;
  #name = "";
  #text = "";
  #reattachId: string | null = null;
  #snap = false;
  #unit: "mm" | "cm" | "m" = "mm";
  #message = "";
  #disposed = false;
  constructor(readonly store: SceneStore, readonly viewport: ReviewViewport, private readonly options: { canEdit?: () => boolean } = {}) {
    let previousReview = store.getSnapshot().review;
    this.#unsubscribe = store.subscribe(model => {
      // Opening a project or undoing a review edit must not carry a half-picked tool across scenes.
      if (model.review !== previousReview && this.#mode) this.cancel();
      previousReview = model.review;
      this.#emit(); viewport.requestRender();
    });
  }
  get state(): ReviewControllerState { return { model: this.store.getSnapshot(), mode: this.#mode, pending: this.#pending, preview: this.#preview, snap: this.#snap, unit: this.#unit, message: this.#message, busy: this.options.canEdit?.() === false }; }
  subscribe(listener: () => void): () => void { this.#listeners.add(listener); listener(); return () => this.#listeners.delete(listener); }
  /** Called after actual renders; does not request another frame. */
  refresh(): void { if (!this.#disposed) this.#emit(); }
  preview(anchor: ReviewAnchor | null): void { this.#preview = this.#mode ? anchor : null; this.#emit(); }
  setUnit(unit: "mm" | "cm" | "m"): void { this.#unit = unit; this.#emit(); }
  setSnap(enabled: boolean): void { this.#snap = enabled; this.viewport.setPicking(this.#mode !== null, enabled); this.#emit(); }
  start(mode: Exclude<ReviewPickMode, null | "reattach">, name: string, text = ""): void {
    this.#editable();
    this.#limit(this.store.getSnapshot().review[mode === "annotation" ? "annotations" : "measurements"].length);
    this.#name = reviewName(name); this.#text = mode === "annotation" ? reviewText(text) : "";
    this.#pending = []; this.#reattachId = null; this.#mode = mode; this.#message = "";
    this.viewport.setPicking(true, this.#snap); this.#emit();
  }
  reattach(id: string): void {
    this.#editable();
    if (!this.store.getSnapshot().review.annotations.some(note => note.id === id)) return;
    this.#mode = "reattach"; this.#reattachId = id; this.#pending = []; this.#message = "";
    this.viewport.setPicking(true, this.#snap); this.#emit();
  }
  cancel(): void {
    this.#mode = null; this.#pending = []; this.#preview = null; this.#reattachId = null; this.#message = "";
    this.viewport.setPicking(false, this.#snap); this.#emit(); this.viewport.requestRender();
  }
  /** Consumes clicks while a review tool is active, including unsupported surfaces. */
  pick(anchor: ReviewAnchor | null): boolean {
    if (!this.#mode) return false;
    if (this.options.canEdit?.() === false) { this.cancel(); return true; }
    if (!anchor || !this.viewport.resolveAnchor(anchor)) {
      this.#message = "静的なmeshの表示面を選択してください。 / Select a visible static mesh surface."; this.#emit(); return true;
    }
    try {
      if (this.#pending.some(point => !this.viewport.resolveAnchor(point))) {
        this.cancel(); this.#message = "形状が変わりました。計測を開始し直してください。 / Geometry changed. Start the measurement again."; this.#emit(); return true;
      }
      if (this.#mode === "reattach") {
        const id = this.#reattachId;
        this.store.update(draft => { const note = draft.review.annotations.find(note => note.id === id); if (note) note.anchor = structuredClone(anchor); });
        this.cancel(); return true;
      }
      if (this.#mode === "annotation") {
        this.#limit(this.store.getSnapshot().review.annotations.length);
        this.store.update(draft => { draft.review.annotations.push({ id: this.#id(), name: this.#name, text: this.#text, anchor: structuredClone(anchor) }); });
        this.cancel(); return true;
      }
      const point = this.viewport.resolveAnchor(anchor)!;
      const previous = this.#pending.at(-1);
      const last = previous && this.viewport.resolveAnchor(previous);
      if (last && measureDistance(last, point) < 1e-12) {
        this.#message = "異なる位置を選択してください。 / Pick a different point."; this.#emit(); return true;
      }
      this.#pending.push(structuredClone(anchor));
      const count = this.#mode === "angle" ? 3 : 2;
      if (this.#pending.length === count) {
        this.#limit(this.store.getSnapshot().review.measurements.length);
        const measurement: ReviewMeasurement = { id: this.#id(), name: this.#name, kind: this.#mode, anchors: structuredClone(this.#pending) };
        this.store.update(draft => { draft.review.measurements.push(measurement); }); this.cancel();
      } else { this.#emit(); this.viewport.requestRender(); }
    } catch (error) { this.#message = error instanceof Error ? error.message : String(error); this.#emit(); }
    return true;
  }
  addBounds(name: string): void {
    this.#editable(); const rootId = this.viewport.getSelectedRootId();
    const nodeId = this.viewport.getSelectedNodeId?.() ?? undefined;
    if (!rootId || !this.viewport.getBounds(rootId, nodeId)) throw new Error("計測する静的な部品を選択してください。 / Select a static part to measure.");
    this.#limit(this.store.getSnapshot().review.measurements.length);
    const normalized = reviewName(name);
    this.store.update(draft => { draft.review.measurements.push({ id: this.#id(), name: normalized, kind: "bounds", rootId, ...(nodeId ? { nodeId } : {}) }); });
  }
  saveView(name: string, updateId?: string): void {
    this.#editable(); const model = this.store.getSnapshot(), normalized = reviewName(name);
    if (!updateId) this.#limit(model.review.views.length);
    const view = { id: updateId ?? this.#id(), name: normalized, camera: structuredClone(model.camera), clipping: this.viewport.getClipping(), visibility: captureReviewVisibility(model) };
    this.store.update(draft => {
      const index = updateId ? draft.review.views.findIndex(item => item.id === updateId) : -1;
      if (updateId && index < 0) return;
      if (index < 0) draft.review.views.push(view); else draft.review.views[index] = view;
    });
  }
  applyView(id: string): void {
    this.#editable(); const view = this.store.getSnapshot().review.views.find(view => view.id === id); if (!view) return;
    this.cancel();
    this.viewport.setClipping(structuredClone(view.clipping));
    this.store.update(draft => { draft.camera = structuredClone(view.camera); }, { history: false });
    this.store.update(draft => { applyReviewVisibility(draft, view.visibility); });
  }
  rename(kind: "views" | "annotations" | "measurements", id: string, name: string, text?: string): void {
    this.#editable(); const normalized = reviewName(name); const body = text === undefined ? undefined : reviewText(text);
    this.store.update(draft => {
      const item = draft.review[kind].find(item => item.id === id); if (!item) return;
      item.name = normalized;
      if (kind === "annotations" && body !== undefined && "text" in item) item.text = body;
    });
  }
  remove(kind: "views" | "annotations" | "measurements", id: string): void {
    this.#editable();
    this.store.update(draft => { const index = draft.review[kind].findIndex(item => item.id === id); if (index >= 0) draft.review[kind].splice(index, 1); });
  }
  displayItems(): ReviewDisplayItem[] {
    const review = this.store.getSnapshot().review;
    const notes = review.annotations.map(note => {
      const point = this.viewport.resolveAnchor(note.anchor);
      return { id: note.id, name: note.name, text: note.text, kind: "annotation" as const, points: point ? [point] : [], anchors: [note.anchor], unresolved: !point };
    });
    const measurements: ReviewDisplayItem[] = review.measurements.map(measurement => {
      if (measurement.kind === "bounds") {
        const bounds = this.viewport.getBounds(measurement.rootId, measurement.nodeId);
        const dimensions = bounds && boundsDimensions(bounds);
        return { id: measurement.id, name: measurement.name, kind: measurement.kind, unresolved: !bounds,
          points: bounds ? [{ x: (bounds.min.x + bounds.max.x) / 2, y: bounds.max.y, z: (bounds.min.z + bounds.max.z) / 2 }] : [],
          text: dimensions ? `X ${this.formatLength(dimensions.x)} · Y ${this.formatLength(dimensions.y)} · Z ${this.formatLength(dimensions.z)}` : "" };
      }
      const resolved = measurement.anchors.map(anchor => this.viewport.resolveAnchor(anchor));
      const points = resolved.filter((point): point is Vec3Model => point !== null);
      const unresolved = points.length !== measurement.anchors.length;
      const value = unresolved ? null : measurement.kind === "distance" ? measureDistance(points[0]!, points[1]!) : measureAngle(points[0]!, points[1]!, points[2]!);
      return { id: measurement.id, name: measurement.name, kind: measurement.kind, points, anchors: measurement.anchors, unresolved: unresolved || value === null,
        text: value === null ? "" : measurement.kind === "distance" ? this.formatLength(value) : `${Number(value.toPrecision(7))}°` };
    });
    return [...notes, ...measurements];
  }
  formatLength(meters: number): string { return `${Number((meters * (this.#unit === "mm" ? 1000 : this.#unit === "cm" ? 100 : 1)).toPrecision(7))} ${this.#unit}`; }
  dispose(): void { this.cancel(); this.#disposed = true; this.#unsubscribe(); this.#listeners.clear(); }
  #id(): string { return `review-${crypto.randomUUID()}`; }
  #editable(): void { if (this.#disposed || this.options.canEdit?.() === false) throw new Error("処理の完了を待ってください。 / Wait for the current operation to finish."); }
  #limit(length: number): void { if (length >= REVIEW_ITEM_LIMIT) throw new Error(`最大${REVIEW_ITEM_LIMIT}件です。 / Maximum ${REVIEW_ITEM_LIMIT} entries.`); }
  #emit(): void { for (const listener of this.#listeners) listener(); }
}
