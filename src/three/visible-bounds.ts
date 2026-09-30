import * as THREE from "three";

type Renderable = THREE.Mesh | THREE.Line | THREE.Points;
export interface RenderedRange { start: number; end: number }

function forEachVertex(object: Renderable, ranges: readonly RenderedRange[], visit: (vertex: number) => void): void {
  const index = object.geometry.index;
  const size = object instanceof THREE.Mesh ? 3 : object instanceof THREE.LineSegments ? 2 : 1;
  const minimum = object instanceof THREE.Line && !(object instanceof THREE.LineSegments) ? 2 : size;
  for (const range of ranges) {
    const count = Math.floor((range.end - range.start) / size) * size;
    if (count < minimum) continue;
    for (let offset = range.start; offset < range.start + count; offset++) visit(index ? index.getX(offset) : offset);
  }
}

function addScaledBounds(target: THREE.Box3, source: THREE.Box3, weight: number): void {
  if (weight === 0) return;
  target.min.addScaledVector(weight > 0 ? source.min : source.max, weight);
  target.max.addScaledVector(weight > 0 ? source.max : source.min, weight);
}

/** Scan shared attributes once, then conservatively bound each instance's current pose. */
function expandInstances(bounds: THREE.Box3, object: THREE.InstancedMesh, ranges: readonly RenderedRange[]): void {
  const geometry = object.geometry, position = geometry.getAttribute("position");
  const morphPositions = geometry.morphAttributes.position ?? [];
  const attributes = [position, ...morphPositions];
  const attributeBounds = attributes.map(() => new THREE.Box3());
  const point = new THREE.Vector3();
  forEachVertex(object, ranges, vertex => {
    attributes.forEach((attribute, i) => attributeBounds[i]!.expandByPoint(point.fromBufferAttribute(attribute, vertex)));
  });
  const base = attributeBounds[0]!;
  if (base.isEmpty()) return;
  const pose = new THREE.Mesh(geometry, object.material);
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4(), local = new THREE.Box3();
  for (let i = 0; i < object.count; i++) {
    object.getMatrixAt(i, instance); world.multiplyMatrices(object.matrixWorld, instance);
    if (object.morphTexture && morphPositions.length) {
      object.getMorphAt(i, pose);
      const weights = pose.morphTargetInfluences!;
      local.min.set(0, 0, 0); local.max.set(0, 0, 0);
      const baseWeight = geometry.morphTargetsRelative ? 1 : 1 - weights.reduce((sum, weight) => sum + weight, 0);
      addScaledBounds(local, base, baseWeight);
      morphPositions.forEach((_, target) => addScaledBounds(local, attributeBounds[target + 1]!, weights[target]!));
    } else local.copy(base);
    bounds.union(local.applyMatrix4(world));
  }
}

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
  const point = new THREE.Vector3();
  for (const root of roots) {
    let visible = true;
    for (let parent: THREE.Object3D | null = root; parent; parent = parent.parent) if (!parent.visible) visible = false;
    if (!visible) continue;
    root.updateWorldMatrix(true, true);
    root.traverseVisible(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
      const position = object.geometry.getAttribute("position");
      if (!position) return;
      const ranges = renderedRanges(object);
      if (object instanceof THREE.InstancedMesh) {
        expandInstances(bounds, object, ranges);
        return;
      }
      let mesh: THREE.Mesh | null = object instanceof THREE.Mesh ? object : null;
      if (!mesh && object.morphTargetInfluences && object.geometry.morphAttributes.position?.length) {
        // Reuse Three.js's vertex morph evaluation for points and lines too.
        // This temporary view shares geometry/material and allocates no GPU resource.
        mesh = new THREE.Mesh(object.geometry, object.material);
        mesh.morphTargetInfluences = object.morphTargetInfluences;
      }
      forEachVertex(object, ranges, vertex => {
        if (mesh) mesh.getVertexPosition(vertex, point);
        else point.fromBufferAttribute(position, vertex);
        bounds.expandByPoint(point.applyMatrix4(object.matrixWorld));
      });
    });
  }
  return bounds;
}
