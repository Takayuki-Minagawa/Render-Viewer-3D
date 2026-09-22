import * as THREE from "three";
import type { ReviewAnchor, ReviewBounds } from "../model/review-model";
import type { DeepReadonly, Vec3Model } from "../model/scene-model";

const fingerprints = new WeakMap<THREE.BufferGeometry, { positions: unknown; index: unknown; version: number; indexVersion: number; key: string }>();
const boundsCache = new WeakMap<THREE.Mesh, { positions: unknown; version: number; index: unknown; indexVersion: number; rangesKey: string; matrix: number[]; bounds: THREE.Box3 }>();
const plain = (v: THREE.Vector3): Vec3Model => ({ x: v.x, y: v.y, z: v.z });

function staticMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh) && !(object instanceof THREE.InstancedMesh)
    && !Object.values(object.geometry.morphAttributes).some(values => Array.isArray(values) && values.length > 0);
}
function hashText(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
/** Cache follows attribute identities and versions; BVH must preserve the geometry index. */
function geometryKey(mesh: THREE.Mesh): string {
  const geometry = mesh.geometry, position = geometry.getAttribute("position"), index = geometry.getIndex();
  if (!position) return "missing";
  const version = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version;
  const old = fingerprints.get(geometry);
  if (old?.positions === position && old.index === index && old.version === version && old.indexVersion === (index?.version ?? -1)) return old.key;
  let hash = 2166136261;
  const number = new Float64Array(1), bytes = new Uint8Array(number.buffer);
  const add = (value: number) => { number[0] = value; for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619); };
  for (let i = 0; i < position.count; i++) { add(position.getX(i)); add(position.getY(i)); add(position.getZ(i)); }
  if (index) for (let i = 0; i < index.count; i++) add(index.getX(i));
  const key = `${position.count}:${index?.count ?? 0}:${(hash >>> 0).toString(16)}`;
  fingerprints.set(geometry, { positions: position, index, version, indexVersion: index?.version ?? -1, key });
  return key;
}
function bindingKey(mesh: THREE.Mesh, rootId: string): string {
  const lineage: string[] = [];
  // Primitive root transforms are editable and must not invalidate an anchor.
  if (mesh.userData.importedNodeId) for (let object: THREE.Object3D | null = mesh; object && object.userData.importedAssetId === undefined; object = object.parent) {
    object.updateMatrix();
    lineage.push(JSON.stringify([object.name, object.type, object.matrix.elements]));
  }
  return `surface-v1:${geometryKey(mesh)}:${hashText(`${rootId}:${lineage.join("/")}`)}`;
}
function animated(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.animations.length) return true;
  return false;
}
function target(root: THREE.Object3D, nodeId?: string): THREE.Object3D | null {
  if (!nodeId) return root;
  let result: THREE.Object3D | null = null;
  root.traverse(object => { if (object.userData.importedNodeId === nodeId) result = object; });
  return result;
}
export function reviewObjectVisible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
export function createReviewAnchor(intersection: THREE.Intersection | undefined): ReviewAnchor | null {
  if (!intersection || !staticMesh(intersection.object) || animated(intersection.object)) return null;
  const mesh = intersection.object, rootId = mesh.userData.sceneModelId;
  if (typeof rootId !== "string" || !reviewObjectVisible(mesh)) return null;
  mesh.updateWorldMatrix(true, false);
  const nodeId = mesh.userData.importedNodeId as string | undefined;
  const localPosition = plain(mesh.worldToLocal(intersection.point.clone()));
  if (!Object.values(localPosition).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) return null;
  return { rootId, ...(nodeId ? { nodeId } : {}), localPosition, geometryKey: bindingKey(mesh, rootId) };
}
/** Returns null on missing/replaced geometry and unsupported animated surfaces. */
export function resolveReviewAnchor(root: THREE.Object3D | undefined, anchor: DeepReadonly<ReviewAnchor>): Vec3Model | null {
  if (!root) return null;
  const mesh = target(root, anchor.nodeId);
  if (!mesh || !staticMesh(mesh) || animated(mesh) || bindingKey(mesh, anchor.rootId) !== anchor.geometryKey) return null;
  mesh.updateWorldMatrix(true, false);
  const world = plain(mesh.localToWorld(new THREE.Vector3(anchor.localPosition.x, anchor.localPosition.y, anchor.localPosition.z)));
  return Object.values(world).every(Number.isFinite) ? world : null;
}
export function reviewAnchorVisible(root: THREE.Object3D | undefined, anchor: DeepReadonly<ReviewAnchor>): boolean {
  const object = root ? target(root, anchor.nodeId) : null;
  return !!object && reviewObjectVisible(object);
}
/** World-axis aligned bounds, excluding hidden nodes and helper objects. */
export function reviewBounds(root: THREE.Object3D | undefined, nodeId?: string): ReviewBounds | null {
  if (!root) return null;
  const object = target(root, nodeId); if (!object || !reviewObjectVisible(object)) return null;
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  object.traverseVisible(node => {
    if (!staticMesh(node)) return;
    const position = node.geometry.getAttribute("position");
    if (!position) return;
    const version = position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version;
    const index = node.geometry.index, count = index?.count ?? position.count;
    const start = Math.max(0, node.geometry.drawRange.start), end = Math.min(count, start + node.geometry.drawRange.count);
    const ranges: { start: number; end: number }[] = [];
    if (Array.isArray(node.material)) {
      for (const group of node.geometry.groups) if (node.material[group.materialIndex ?? 0]?.visible) ranges.push({ start: Math.max(start, group.start), end: Math.min(end, group.start + group.count) });
    } else if (node.material.visible) ranges.push({ start, end });
    const rangesKey = JSON.stringify(ranges), indexVersion = index?.version ?? -1;
    const cached = boundsCache.get(node);
    if (cached?.positions === position && cached.version === version && cached.index === index && cached.indexVersion === indexVersion && cached.rangesKey === rangesKey && cached.matrix.every((value, i) => value === node.matrixWorld.elements[i])) { box.union(cached.bounds); return; }
    const point = new THREE.Vector3(), bounds = new THREE.Box3();
    // glTF primitives can share a POSITION accessor but reference disjoint
    // subsets. Count only complete rendered triangles, not unused vertices.
    for (const range of ranges) for (let offset = range.start; offset + 2 < range.end; offset += 3) for (let j = 0; j < 3; j++) {
      bounds.expandByPoint(point.fromBufferAttribute(position, index ? index.getX(offset + j) : offset + j).applyMatrix4(node.matrixWorld));
    }
    boundsCache.set(node, { positions: position, version, index, indexVersion, rangesKey, matrix: [...node.matrixWorld.elements], bounds });
    box.union(bounds);
  });
  return box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) ? null : { min: plain(box.min), max: plain(box.max) };
}
/** Snap only to visible vertices of the picked triangle, within a screen-space radius. */
export function snapReviewIntersection(intersection: THREE.Intersection | undefined, camera: THREE.Camera,
  canvas: Pick<HTMLCanvasElement, "getBoundingClientRect">, clippingPlanes: readonly THREE.Plane[] = [], thresholdPx = 12): THREE.Intersection | undefined {
  if (!intersection?.face || !staticMesh(intersection.object)) return intersection;
  const mesh = intersection.object, position = mesh.geometry.getAttribute("position"), bounds = canvas.getBoundingClientRect();
  if (!position || bounds.width <= 0 || bounds.height <= 0) return intersection;
  const projectedHit = intersection.point.clone().project(camera);
  let best: THREE.Vector3 | undefined, distance = thresholdPx;
  for (const index of [intersection.face.a, intersection.face.b, intersection.face.c]) {
    const point = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    if (clippingPlanes.some(plane => plane.distanceToPoint(point) < 0)) continue;
    const projected = point.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const pixels = Math.hypot((projected.x - projectedHit.x) * bounds.width / 2, (projected.y - projectedHit.y) * bounds.height / 2);
    if (pixels <= distance) { best = point; distance = pixels; }
  }
  return best ? { ...intersection, point: best } : intersection;
}
