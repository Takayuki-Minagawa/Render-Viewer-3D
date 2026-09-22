import type { CameraModel, DeepReadonly, SceneModel, SceneSnapshot, Vec3Model } from "./scene-model";

export const REVIEW_ITEM_LIMIT = 200;
export const REVIEW_NAME_LIMIT = 120;
export const REVIEW_TEXT_LIMIT = 1000;

/** Identifies a static surface independently from disposable runtime asset ids. */
export interface ReviewAnchor {
  rootId: string;
  nodeId?: string;
  localPosition: Vec3Model;
  geometryKey: string;
}
export interface ReviewClipping { axis: "off" | "x" | "y" | "z"; offset: number; reverse: boolean; cap: boolean; capColor: string; }
export interface ReviewVisibility {
  rootId: string;
  visible: boolean;
  isolatedNodeId?: string | null;
  nodes?: Record<string, boolean>;
  hierarchyKey?: string;
}
export interface ReviewView { id: string; name: string; camera: CameraModel; clipping: ReviewClipping; visibility: ReviewVisibility[]; }
export interface ReviewAnnotation { id: string; name: string; text: string; anchor: ReviewAnchor; }
export type ReviewMeasurement = {
  id: string; name: string; kind: "distance" | "angle"; anchors: ReviewAnchor[];
} | {
  id: string; name: string; kind: "bounds"; rootId: string; nodeId?: string;
};
export interface ReviewModel { version: 1; views: ReviewView[]; annotations: ReviewAnnotation[]; measurements: ReviewMeasurement[]; }
export interface ReviewBounds { min: Vec3Model; max: Vec3Model; }

export function createReviewModel(): ReviewModel { return { version: 1, views: [], annotations: [], measurements: [] }; }
export function reviewName(value: string): string {
  const name = value.trim();
  if (!name || name.length > REVIEW_NAME_LIMIT) throw new Error(`Name must contain 1–${REVIEW_NAME_LIMIT} characters. / 名称は1〜${REVIEW_NAME_LIMIT}文字です。`);
  return name;
}
export function reviewText(value: string): string {
  const text = value.trim();
  if (!text || text.length > REVIEW_TEXT_LIMIT) throw new Error(`Annotation must contain 1–${REVIEW_TEXT_LIMIT} characters. / 注記は1〜${REVIEW_TEXT_LIMIT}文字です。`);
  return text;
}
export function captureReviewVisibility(model: SceneSnapshot): ReviewVisibility[] {
  return [...model.objects.map(object => ({ rootId: object.id, visible: object.visible })), ...model.imports.map(object => ({
    rootId: object.id, visible: object.visible, isolatedNodeId: object.isolatedNodeId ?? null, hierarchyKey: hierarchyKey(object.hierarchy),
    nodes: Object.fromEntries(Object.entries(object.nodeOverrides ?? {}).flatMap(([id, override]) => override.visible === undefined ? [] : [[id, override.visible]])),
  }))];
}
/** Visibility is one undoable edit. Camera navigation remains outside history. */
export function applyReviewVisibility(model: SceneModel, visibility: readonly DeepReadonly<ReviewVisibility>[]): void {
  for (const state of visibility) {
    const primitive = model.objects.find(object => object.id === state.rootId);
    if (primitive) { primitive.visible = state.visible; continue; }
    const imported = model.imports.find(object => object.id === state.rootId);
    if (!imported) continue;
    imported.visible = state.visible;
    // A view must not silently isolate a different part after an importer changes paths.
    if (state.hierarchyKey !== hierarchyKey(imported.hierarchy)) continue;
    const nodeIds = new Set<string>();
    const visit = (nodes: typeof imported.hierarchy) => { for (const node of nodes) { nodeIds.add(node.id); visit(node.children); } };
    visit(imported.hierarchy);
    imported.isolatedNodeId = state.isolatedNodeId && nodeIds.has(state.isolatedNodeId) ? state.isolatedNodeId : null;
    for (const [id, override] of Object.entries(imported.nodeOverrides ?? {})) {
      delete override.visible;
      if (!Object.keys(override).length) delete imported.nodeOverrides![id];
    }
    for (const [id, visible] of Object.entries(state.nodes ?? {})) if (nodeIds.has(id)) {
      imported.nodeOverrides ??= {};
      imported.nodeOverrides[id] ??= {};
      imported.nodeOverrides[id]!.visible = visible;
    }
  }
}
function hierarchyKey(hierarchy: SceneSnapshot["imports"][number]["hierarchy"]): string {
  let hash = 2166136261;
  const visit = (nodes: typeof hierarchy) => { for (const node of nodes) {
    const value = JSON.stringify([node.id, node.name, node.objectType]);
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    visit(node.children);
  } };
  visit(hierarchy); return (hash >>> 0).toString(16);
}
export function measureDistance(a: Vec3Model, b: Vec3Model): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function measureAngle(a: Vec3Model, vertex: Vec3Model, b: Vec3Model): number | null {
  const left = measureDistance(a, vertex), right = measureDistance(b, vertex);
  if (left < 1e-12 || right < 1e-12) return null;
  const dot = ((a.x - vertex.x) * (b.x - vertex.x) + (a.y - vertex.y) * (b.y - vertex.y) + (a.z - vertex.z) * (b.z - vertex.z)) / left / right;
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}
export function boundsDimensions(bounds: ReviewBounds): Vec3Model { return { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y, z: bounds.max.z - bounds.min.z }; }
