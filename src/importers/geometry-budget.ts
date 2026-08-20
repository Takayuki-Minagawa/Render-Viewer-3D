import * as THREE from "three";

export interface RenderableGeometryBudget {
  readonly maxSceneNodes: number;
  readonly maxDepth: number;
  readonly maxRenderableObjects: number;
  readonly maxPositionVertices: number;
  readonly maxVertexReferences: number;
  readonly maxPrimitives: number;
}

export interface RenderableGeometryUsage {
  readonly sceneNodes: number;
  readonly maxDepth: number;
  readonly renderableObjects: number;
  readonly positionVertices: number;
  readonly vertexReferences: number;
  readonly primitives: number;
}

export const MAIN_THREAD_GEOMETRY_BUDGET: Readonly<RenderableGeometryBudget> =
  Object.freeze({
    maxSceneNodes: 50_000,
    maxDepth: 256,
    maxRenderableObjects: 10_000,
    maxPositionVertices: 2_000_000,
    maxVertexReferences: 2_000_000,
    maxPrimitives: 2_000_000,
  });

interface PendingNode {
  readonly object: THREE.Object3D;
  readonly depth: number;
}

export function assertRenderableGeometryBudget(
  root: THREE.Object3D,
  format: string,
  budget: RenderableGeometryBudget = MAIN_THREAD_GEOMETRY_BUDGET,
): RenderableGeometryUsage {
  validateBudget(budget);
  let sceneNodes = 0;
  let maxDepth = 0;
  let renderableObjects = 0;
  let positionVertices = 0;
  let vertexReferences = 0;
  let primitives = 0;
  const visited = new Set<THREE.Object3D>();
  const enqueued = new Set<THREE.Object3D>([root]);
  const pending: PendingNode[] = [{ object: root, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current.object)) {
      throw new Error(
        `${format} output is not a valid Object3D tree (cycle or shared node).`,
      );
    }
    visited.add(current.object);

    sceneNodes = checkedAdd(sceneNodes, 1, format);
    maxDepth = Math.max(maxDepth, current.depth);
    assertWithinBudget();

    const object = current.object;
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line
    ) {
      renderableObjects = checkedAdd(renderableObjects, 1, format);
      const geometry = object.geometry;
      const positionCount = geometry.getAttribute("position")?.count ?? 0;
      const referenceCount = geometry.getIndex()?.count ?? positionCount;
      positionVertices = checkedAdd(
        positionVertices,
        positionCount,
        format,
      );
      vertexReferences = checkedAdd(
        vertexReferences,
        referenceCount,
        format,
      );

      const primitiveCount =
        object instanceof THREE.Mesh
          ? Math.floor(referenceCount / 3)
          : object instanceof THREE.Points
            ? referenceCount
            : Math.floor(referenceCount / 2);
      primitives = checkedAdd(primitives, primitiveCount, format);
      assertWithinBudget();
    }

    if (
      object.children.length > 0 &&
      current.depth >= budget.maxDepth
    ) {
      maxDepth = current.depth + 1;
      assertWithinBudget();
    }
    const projectedSceneNodes =
      sceneNodes + pending.length + object.children.length;
    if (projectedSceneNodes > budget.maxSceneNodes) {
      sceneNodes = projectedSceneNodes;
      assertWithinBudget();
    }
    for (let index = object.children.length - 1; index >= 0; index -= 1) {
      const child = object.children[index];
      if (enqueued.has(child)) {
        throw new Error(
          `${format} output is not a valid Object3D tree (cycle or shared node).`,
        );
      }
      enqueued.add(child);
      pending.push({
        object: child,
        depth: current.depth + 1,
      });
    }
  }

  return {
    sceneNodes,
    maxDepth,
    renderableObjects,
    positionVertices,
    vertexReferences,
    primitives,
  };

  function assertWithinBudget(): void {
    if (
      sceneNodes > budget.maxSceneNodes ||
      maxDepth > budget.maxDepth ||
      renderableObjects > budget.maxRenderableObjects ||
      positionVertices > budget.maxPositionVertices ||
      vertexReferences > budget.maxVertexReferences ||
      primitives > budget.maxPrimitives
    ) {
      throw new Error(
        `${format} output exceeds the main-thread geometry safety budget ` +
          `(${sceneNodes}/${budget.maxSceneNodes} scene nodes, ` +
          `${maxDepth}/${budget.maxDepth} depth, ` +
          `${renderableObjects}/${budget.maxRenderableObjects} renderables, ` +
          `${positionVertices}/${budget.maxPositionVertices} position vertices, ` +
          `${vertexReferences}/${budget.maxVertexReferences} vertex references, ` +
          `${primitives}/${budget.maxPrimitives} primitives).`,
      );
    }
  }
}

function validateBudget(budget: RenderableGeometryBudget): void {
  for (const [name, value] of Object.entries(budget)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Geometry budget ${name} must be a non-negative safe integer.`);
    }
  }
}

function checkedAdd(total: number, value: number, format: string): number {
  const result = total + value;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${format} output geometry size is not safely representable.`);
  }
  return result;
}
