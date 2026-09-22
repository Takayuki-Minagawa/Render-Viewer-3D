import * as THREE from "three";

export interface SectionCapStatus { eligible: number; skipped: number }
const closureCache = new WeakMap<THREE.BufferGeometry, { positions: unknown; index: unknown; version: string; closed: boolean }>();
const MAX_CAP_TRIANGLES = 200_000;

/** Conservative eligibility: closed, consistently wound triangles only. */
export function isClosedGeometry(geometry: THREE.BufferGeometry): boolean {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3) return false;
  const index = geometry.index;
  const count = index?.count ?? position.count;
  if (count % 3 || count / 3 > MAX_CAP_TRIANGLES || geometry.drawRange.start !== 0 || geometry.drawRange.count < count) return false;
  const version = `${(position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version)}:${index?.version ?? 0}:${position.count}:${count}`;
  const cached = closureCache.get(geometry);
  if (cached?.positions === position && cached.index === index && cached.version === version) return cached.closed;
  const vertices = new Map<string, number>();
  const ids: number[] = [];
  const edges = new Map<string, { count: number; winding: number }>();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3()).length();
  const tolerance = Math.max(1e-10, size * 1e-7);
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)].map(v => Math.round(v / tolerance)).join(",");
    let id = vertices.get(key); if (id === undefined) { id = vertices.size; vertices.set(key, id); }
    ids.push(id);
  }
  let triangles = 0;
  for (let i = 0; i < count; i += 3) {
    const tri = [0, 1, 2].map(j => ids[index ? index.getX(i + j) : i + j]!);
    if (new Set(tri).size !== 3) continue;
    triangles++;
    for (let j = 0; j < 3; j++) {
      const a = tri[j]!, b = tri[(j + 1) % 3]!;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, winding: 0 };
      edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
    }
  }
  const closed = triangles > 0 && [...edges.values()].every(edge => edge.count === 2 && edge.winding === 0);
  closureCache.set(geometry, { positions: position, index, version, closed });
  return closed;
}

export function canCapMesh(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || Object.keys(object.geometry.morphAttributes).length) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  if (Array.isArray(object.material)) {
    // The stencil pass uses one material. Reject missing or overlapping groups
    // so it never closes faces that the actual mesh does not draw.
    let end = 0;
    for (const group of [...object.geometry.groups].sort((a, b) => a.start - b.start)) {
      if (group.start !== end || !materials[group.materialIndex ?? 0]) return false;
      end += group.count;
    }
    if (end !== (object.geometry.index?.count ?? object.geometry.getAttribute("position")?.count)) return false;
  }
  return materials.every(m => !(m instanceof THREE.MeshPhysicalMaterial && m.transmission > 0) && m.visible && !m.transparent && m.opacity === 1 && m.alphaTest === 0 && !m.alphaHash) && isClosedGeometry(object.geometry);
}

/** A display-only stencil pass. Borrowed geometry is never modified or disposed. */
export class SectionCapRenderer {
  readonly #stencilScene = new THREE.Scene();
  readonly #capScene = new THREE.Scene();
  readonly #empty = new THREE.BufferGeometry();
  readonly #back = new THREE.Mesh(this.#empty, new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp }));
  readonly #front = new THREE.Mesh(this.#empty, new THREE.MeshBasicMaterial({ side: THREE.FrontSide, depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp }));
  readonly #cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp }));
  constructor() {
    for (const mesh of [this.#back, this.#front]) { mesh.matrixAutoUpdate = false; mesh.frustumCulled = false; this.#stencilScene.add(mesh); }
    this.#cap.frustumCulled = false; this.#capScene.add(this.#cap);
  }
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, candidates: readonly THREE.Object3D[], plane: THREE.Plane, color: string): SectionCapStatus {
    const status = { eligible: 0, skipped: 0 };
    const autoClear = renderer.autoClear, clipping = renderer.clippingPlanes;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.autoClear = false; renderer.shadowMap.autoUpdate = false;
    this.#cap.material.color.set(color);
    try {
      for (const object of candidates) {
        if (!canCapMesh(object)) { status.skipped++; continue; }
        status.eligible++;
        object.updateWorldMatrix(true, false);
        const bounds = new THREE.Box3().setFromObject(object, true);
        if (bounds.isEmpty() || !plane.intersectsBox(bounds)) continue;
        const center = bounds.getCenter(new THREE.Vector3());
        const diameter = bounds.getSize(new THREE.Vector3()).length() * 1.01;
        plane.projectPoint(center, this.#cap.position);
        this.#cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
        this.#cap.scale.set(diameter, diameter, 1);
        for (const mesh of [this.#back, this.#front]) { mesh.geometry = object.geometry; mesh.matrix.copy(object.matrixWorld); }
        renderer.clearStencil(); renderer.clippingPlanes = [plane];
        renderer.render(this.#stencilScene, camera);
        renderer.clippingPlanes = [];
        renderer.render(this.#capScene, camera);
      }
    } finally {
      renderer.clearStencil(); renderer.clippingPlanes = clipping; renderer.autoClear = autoClear;
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      this.#back.geometry = this.#empty; this.#front.geometry = this.#empty;
    }
    return status;
  }
  dispose(): void { this.#empty.dispose(); this.#back.material.dispose(); this.#front.material.dispose(); this.#cap.geometry.dispose(); this.#cap.material.dispose(); }
}
