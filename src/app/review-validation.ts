import { REVIEW_ITEM_LIMIT, REVIEW_NAME_LIMIT, REVIEW_TEXT_LIMIT } from "../model/review-model";

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid review object.");
  return value as RecordValue;
}
function string(value: unknown, max = REVIEW_NAME_LIMIT): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("Invalid review text.");
  return value;
}
function number(value: unknown, min = -1e9, max = 1e9): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid review number.");
  return value;
}
function boolean(value: unknown): void { if (typeof value !== "boolean") throw new Error("Invalid review boolean."); }
function array(value: unknown, max = REVIEW_ITEM_LIMIT): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Review item limit exceeded.");
  return value;
}
function vector(value: unknown, min = -1e9, max = 1e9): void { const v = object(value); number(v.x, min, max); number(v.y, min, max); number(v.z, min, max); }
function anchor(value: unknown): void {
  const a = object(value); string(a.rootId, 4096); if (a.nodeId !== undefined) string(a.nodeId, 4096);
  string(a.geometryKey, 512); vector(a.localPosition);
}
function camera(value: unknown): void {
  const c = object(value); vector(c.position); vector(c.target); number(c.fov, 1, 179);
  const near = number(c.near, 1e-6); number(c.far, near + 1e-6);
  if (c.projection !== undefined && c.projection !== "perspective" && c.projection !== "orthographic") throw new Error("Invalid review projection.");
  if (c.orthographicHeight !== undefined) number(c.orthographicHeight, 1e-6);
  if (c.up !== undefined) { vector(c.up, -1, 1); const up = object(c.up); if (Number(up.x) ** 2 + Number(up.y) ** 2 + Number(up.z) ** 2 < 1e-12) throw new Error("Invalid review camera up."); }
}
/** Missing objects are deliberately allowed: orphaned notes remain editable and undoable. */
export function validateReviewModel(value: unknown): void {
  const review = object(value);
  if (review.version !== 1) throw new Error("Unsupported review version.");
  const ids = new Set<string>();
  const item = (value: unknown) => {
    const v = object(value), id = string(v.id, 4096); string(v.name);
    if (ids.has(id)) throw new Error("Duplicate review id."); ids.add(id); return v;
  };
  for (const entry of array(review.views)) {
    const view = item(entry); camera(view.camera);
    const clip = object(view.clipping);
    if (!["off", "x", "y", "z"].includes(String(clip.axis))) throw new Error("Invalid review clipping axis.");
    number(clip.offset); boolean(clip.reverse); boolean(clip.cap);
    if (typeof clip.capColor !== "string" || !/^#[\da-f]{6}$/i.test(clip.capColor)) throw new Error("Invalid review cap color.");
    const roots = new Set<string>();
    for (const state of array(view.visibility, 10000)) {
      const v = object(state), id = string(v.rootId, 4096); if (roots.has(id)) throw new Error("Duplicate review visibility id."); roots.add(id);
      boolean(v.visible); if (v.isolatedNodeId != null) string(v.isolatedNodeId, 4096);
      if (v.hierarchyKey !== undefined) string(v.hierarchyKey, 128);
      if (v.nodes !== undefined) {
        const entries = Object.entries(object(v.nodes)); if (entries.length > 10000) throw new Error("Review visibility node limit exceeded.");
        for (const [key, visible] of entries) { string(key, 4096); boolean(visible); }
      }
    }
  }
  for (const entry of array(review.annotations)) { const annotation = item(entry); string(annotation.text, REVIEW_TEXT_LIMIT); anchor(annotation.anchor); }
  for (const entry of array(review.measurements)) {
    const measurement = item(entry);
    if (measurement.kind === "bounds") { string(measurement.rootId, 4096); if (measurement.nodeId !== undefined) string(measurement.nodeId, 4096); }
    else if (measurement.kind === "distance" || measurement.kind === "angle") {
      const anchors = array(measurement.anchors, 3);
      if (anchors.length !== (measurement.kind === "distance" ? 2 : 3)) throw new Error("Invalid measurement point count.");
      anchors.forEach(anchor);
    } else throw new Error("Invalid measurement kind.");
  }
}
