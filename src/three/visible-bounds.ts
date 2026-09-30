import * as THREE from "three";

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
export interface RenderedRange { start: number; end: number }

/** Match the renderer's index/drawRange and material-group selection. */
export function renderedRanges(object: Renderable): RenderedRange[] {
  const geometry = object.geometry;
  const count = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const start = Math.max(0, geometry.drawRange.start);
  const end = Math.min(count, start + geometry.drawRange.count);
  const materials = object.material;
  if (!Array.isArray(materials)) return materials.visible && end > start ? [{ start, end }] : [];
  return geometry.groups.flatMap(group => {
    const first = Math.max(start, group.start), last = Math.min(end, group.start + group.count);
    return materials[group.materialIndex ?? 0]?.visible && last > first ? [{ start: first, end: last }] : [];
  });
}

/** Visible rendered geometry only; helper objects must be excluded by the caller. */
export function visibleBounds(roots: readonly THREE.Object3D[]): THREE.Box3 {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3(), instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (const root of roots) {
    let visible = true;
    for (let parent: THREE.Object3D | null = root; parent; parent = parent.parent) if (!parent.visible) visible = false;
    if (!visible) continue;
    root.updateWorldMatrix(true, true);
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      const position = object.geometry.getAttribute("position"), index = object.geometry.index;
      if (!position) return;
      const ranges = renderedRanges(object);
      const primitiveSize = object instanceof THREE.Mesh ? 3 : object instanceof THREE.LineSegments ? 2 : 1;
      const minimumCount = object instanceof THREE.Line && !(object instanceof THREE.LineSegments) ? 2 : primitiveSize;
      const append = (mesh: THREE.Mesh | null, matrix: THREE.Matrix4) => {
        for (const range of ranges) {
          const count = Math.floor((range.end - range.start) / primitiveSize) * primitiveSize;
          if (count < minimumCount) continue;
          for (let offset = range.start; offset < range.start + count; offset++) {
            const vertex = index ? index.getX(offset) : offset;
            if (mesh) mesh.getVertexPosition(vertex, point);
            else point.fromBufferAttribute(position, vertex);
            bounds.expandByPoint(point.applyMatrix4(matrix));
          }
        }
      };
      if (object instanceof THREE.InstancedMesh) {
        // Per-instance morph weights are independent of the mesh-level weights.
        const mesh = new THREE.Mesh(object.geometry, object.material);
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, instance); world.multiplyMatrices(object.matrixWorld, instance);
          if (object.morphTexture) object.getMorphAt(i, mesh);
          append(mesh, world);
        }
      } else append(object instanceof THREE.Mesh ? object : null, object.matrixWorld);
    });
  }
  return bounds;
}
