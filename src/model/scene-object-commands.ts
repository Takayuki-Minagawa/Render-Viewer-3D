import type {
  GeometryModel,
  GeometryType,
  SceneModel,
  SceneObjectModel,
  TransformModel,
  Vec3Model,
} from "./scene-model";
import {
  createUniqueMaterialId,
  duplicateMaterial,
  findMaterial,
} from "./material/material-commands";
import { createMaterialDefinition } from "./material/material-presets";

export const SCENE_OBJECT_GEOMETRY_TYPES = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "plane",
  "torus",
] as const satisfies readonly GeometryType[];

type GeometryFor<Type extends GeometryType> = Extract<
  GeometryModel,
  { type: Type }
>;

export type GeometryUpdate = {
  [Type in GeometryType]: { type: Type } & Partial<
    Omit<GeometryFor<Type>, "type">
  >;
}[GeometryType];

export interface SceneObjectTransformUpdate {
  position?: Partial<Vec3Model>;
  rotationDegrees?: Partial<Vec3Model>;
  scale?: Partial<Vec3Model>;
}

const DIMENSION_MIN = 0.01;
const DIMENSION_MAX = 10_000;
const RADIAL_SEGMENTS_MAX = 128;
const TUBULAR_SEGMENTS_MAX = 256;
const POSITION_LIMIT = 10_000;
const ROTATION_LIMIT = 360_000;
const SCALE_MIN = 0.01;
const SCALE_MAX = 1_000;
const NAME_MAX_LENGTH = 80;

const GEOMETRY_LABELS: Record<GeometryType, string> = {
  box: "Box",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  plane: "Plane",
  torus: "Torus",
};

export function createDefaultGeometry(type: "box"): GeometryFor<"box">;
export function createDefaultGeometry(type: "sphere"): GeometryFor<"sphere">;
export function createDefaultGeometry(type: "cylinder"): GeometryFor<"cylinder">;
export function createDefaultGeometry(type: "cone"): GeometryFor<"cone">;
export function createDefaultGeometry(type: "plane"): GeometryFor<"plane">;
export function createDefaultGeometry(type: "torus"): GeometryFor<"torus">;
export function createDefaultGeometry(type: GeometryType): GeometryModel;
export function createDefaultGeometry(type: GeometryType): GeometryModel {
  switch (type) {
    case "box":
      return { type, width: 2, height: 2, depth: 2 };
    case "sphere":
      return { type, radius: 1, widthSegments: 32, heightSegments: 16 };
    case "cylinder":
      return {
        type,
        radiusTop: 1,
        radiusBottom: 1,
        height: 2,
        radialSegments: 32,
      };
    case "cone":
      return { type, radius: 1, height: 2, radialSegments: 32 };
    case "plane":
      return { type, width: 2, height: 2 };
    case "torus":
      return {
        type,
        radius: 1,
        tubeRadius: 0.25,
        radialSegments: 16,
        tubularSegments: 48,
      };
  }
}

export function createDefaultSceneObject(
  type: GeometryType,
  id: string,
  name = GEOMETRY_LABELS[type],
  materialId = `${id.trim()}-material`,
): SceneObjectModel {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error("Scene object id must not be empty.");
  const normalizedMaterialId = materialId.trim();
  if (!normalizedMaterialId) {
    throw new Error("Scene object material id must not be empty.");
  }

  const geometry = createDefaultGeometry(type);
  return {
    id: normalizedId,
    name: normalizeName(name) ?? GEOMETRY_LABELS[type],
    visible: true,
    transform: createDefaultTransform(geometry),
    geometry,
    materialId: normalizedMaterialId,
    castShadow: type !== "plane",
    receiveShadow: true,
  };
}

export function addSceneObject(
  draft: SceneModel,
  type: GeometryType,
): SceneObjectModel {
  const identity = createUniqueObjectIdentity(draft, type);
  const objectName =
    `${GEOMETRY_LABELS[type]} ${formatOrdinal(identity.ordinal)}`;
  const materialId = createUniqueMaterialId(
    draft,
    `${identity.id}-material`,
  );
  const material = createMaterialDefinition(
    materialId,
    `${objectName} Material`,
  );
  const object = createDefaultSceneObject(
    type,
    identity.id,
    objectName,
    material.id,
  );
  draft.materials.push(material);
  draft.objects.push(object);
  return object;
}

export function duplicateSceneObject(
  draft: SceneModel,
  objectId: string,
): SceneObjectModel | undefined {
  const sourceIndex = draft.objects.findIndex((object) => object.id === objectId);
  if (sourceIndex < 0) return undefined;

  const source = draft.objects[sourceIndex];
  const identity = createUniqueObjectIdentity(draft, source.geometry.type);
  const duplicate = structuredClone(source);
  duplicate.id = identity.id;
  duplicate.name = createUniqueCopyName(draft, source.name);

  const sourceMaterial = findMaterial(draft, source.materialId);
  const duplicatedMaterial = sourceMaterial
    ? duplicateMaterial(draft, sourceMaterial.id)
    : createMaterialDefinition(
        createUniqueMaterialId(draft, `${duplicate.id}-material`),
        `${duplicate.name.slice(0, 71)} Material`,
      );
  if (!duplicatedMaterial) {
    throw new Error("Unable to duplicate the source material.");
  }
  if (!sourceMaterial) draft.materials.push(duplicatedMaterial);
  duplicatedMaterial.name = `${duplicate.name.slice(0, 71)} Material`;
  duplicate.materialId = duplicatedMaterial.id;

  draft.objects.splice(sourceIndex + 1, 0, duplicate);
  return duplicate;
}

export function deleteSceneObject(draft: SceneModel, objectId: string): boolean {
  const index = draft.objects.findIndex((object) => object.id === objectId);
  if (index < 0) return false;

  draft.objects.splice(index, 1);
  return true;
}

export function renameSceneObject(
  draft: SceneModel,
  objectId: string,
  name: string,
): boolean {
  const object = findSceneObject(draft, objectId);
  const normalizedName = normalizeName(name);
  if (!object || !normalizedName) return false;

  object.name = normalizedName;
  return true;
}

export function setSceneObjectVisibility(
  draft: SceneModel,
  objectId: string,
  visible: boolean,
): boolean {
  const object = findSceneObject(draft, objectId);
  if (!object) return false;

  object.visible = visible;
  return true;
}

export function updateSceneObjectTransform(
  draft: SceneModel,
  objectId: string,
  update: SceneObjectTransformUpdate,
): boolean {
  const object = findSceneObject(draft, objectId);
  if (!object) return false;

  applyVectorUpdate(
    object.transform.position,
    update.position,
    -POSITION_LIMIT,
    POSITION_LIMIT,
  );
  applyVectorUpdate(
    object.transform.rotationDegrees,
    update.rotationDegrees,
    -ROTATION_LIMIT,
    ROTATION_LIMIT,
  );
  applyVectorUpdate(object.transform.scale, update.scale, SCALE_MIN, SCALE_MAX);
  return true;
}

export function updateSceneObjectGeometry(
  draft: SceneModel,
  objectId: string,
  update: GeometryUpdate,
): boolean {
  const object = findSceneObject(draft, objectId);
  if (!object) return false;

  const geometry = normalizeGeometry(object.geometry, update);
  if (!geometry) return false;

  object.geometry = geometry;
  return true;
}

function createDefaultTransform(geometry: GeometryModel): TransformModel {
  let y = 1;
  let rotationX = 0;

  switch (geometry.type) {
    case "box":
      y = geometry.height / 2;
      break;
    case "sphere":
      y = geometry.radius;
      break;
    case "cylinder":
    case "cone":
      y = geometry.height / 2;
      break;
    case "plane":
      y = 0.01;
      rotationX = -90;
      break;
    case "torus":
      y = geometry.radius + geometry.tubeRadius;
      break;
  }

  return {
    position: { x: 0, y, z: 0 },
    rotationDegrees: { x: rotationX, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function normalizeGeometry(
  current: GeometryModel,
  update: GeometryUpdate,
): GeometryModel | undefined {
  switch (update.type) {
    case "box": {
      const base =
        current.type === "box" ? current : createDefaultGeometry("box");
      return {
        type: "box",
        width: normalizeDimension(update.width, base.width),
        height: normalizeDimension(update.height, base.height),
        depth: normalizeDimension(update.depth, base.depth),
      };
    }
    case "sphere": {
      const base =
        current.type === "sphere" ? current : createDefaultGeometry("sphere");
      return {
        type: "sphere",
        radius: normalizeDimension(update.radius, base.radius),
        widthSegments: normalizeSegments(
          update.widthSegments,
          base.widthSegments,
          3,
          RADIAL_SEGMENTS_MAX,
        ),
        heightSegments: normalizeSegments(
          update.heightSegments,
          base.heightSegments,
          2,
          RADIAL_SEGMENTS_MAX,
        ),
      };
    }
    case "cylinder": {
      const base =
        current.type === "cylinder"
          ? current
          : createDefaultGeometry("cylinder");
      return {
        type: "cylinder",
        radiusTop: normalizeDimension(update.radiusTop, base.radiusTop),
        radiusBottom: normalizeDimension(
          update.radiusBottom,
          base.radiusBottom,
        ),
        height: normalizeDimension(update.height, base.height),
        radialSegments: normalizeSegments(
          update.radialSegments,
          base.radialSegments,
          3,
          RADIAL_SEGMENTS_MAX,
        ),
      };
    }
    case "cone": {
      const base =
        current.type === "cone" ? current : createDefaultGeometry("cone");
      return {
        type: "cone",
        radius: normalizeDimension(update.radius, base.radius),
        height: normalizeDimension(update.height, base.height),
        radialSegments: normalizeSegments(
          update.radialSegments,
          base.radialSegments,
          3,
          RADIAL_SEGMENTS_MAX,
        ),
      };
    }
    case "plane": {
      const base =
        current.type === "plane" ? current : createDefaultGeometry("plane");
      return {
        type: "plane",
        width: normalizeDimension(update.width, base.width),
        height: normalizeDimension(update.height, base.height),
      };
    }
    case "torus": {
      const base =
        current.type === "torus" ? current : createDefaultGeometry("torus");
      return {
        type: "torus",
        radius: normalizeDimension(update.radius, base.radius),
        tubeRadius: normalizeDimension(update.tubeRadius, base.tubeRadius),
        radialSegments: normalizeSegments(
          update.radialSegments,
          base.radialSegments,
          3,
          RADIAL_SEGMENTS_MAX,
        ),
        tubularSegments: normalizeSegments(
          update.tubularSegments,
          base.tubularSegments,
          3,
          TUBULAR_SEGMENTS_MAX,
        ),
      };
    }
    default:
      return undefined;
  }
}

function applyVectorUpdate(
  target: Vec3Model,
  update: Partial<Vec3Model> | undefined,
  minimum: number,
  maximum: number,
): void {
  if (!update) return;

  if (update.x !== undefined) {
    target.x = normalizeNumber(update.x, target.x, minimum, maximum);
  }
  if (update.y !== undefined) {
    target.y = normalizeNumber(update.y, target.y, minimum, maximum);
  }
  if (update.z !== undefined) {
    target.z = normalizeNumber(update.z, target.z, minimum, maximum);
  }
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  return normalizeNumber(value, fallback, DIMENSION_MIN, DIMENSION_MAX);
}

function normalizeSegments(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Math.round(normalizeNumber(value, fallback, minimum, maximum));
}

function normalizeNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const safeFallback = Number.isFinite(fallback)
    ? Math.min(maximum, Math.max(minimum, fallback))
    : Math.min(maximum, Math.max(minimum, 0));
  if (typeof value !== "number" || !Number.isFinite(value)) return safeFallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function findSceneObject(
  draft: SceneModel,
  objectId: string,
): SceneObjectModel | undefined {
  return draft.objects.find((object) => object.id === objectId);
}

function createUniqueObjectIdentity(
  draft: SceneModel,
  type: GeometryType,
): { id: string; ordinal: number } {
  const existingIds = new Set(draft.objects.map((object) => object.id));

  for (let ordinal = 1; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const id = `${type}-${formatOrdinal(ordinal)}`;
    if (!existingIds.has(id)) return { id, ordinal };
  }

  throw new Error("Unable to allocate a unique scene object id.");
}

function createUniqueCopyName(draft: SceneModel, sourceName: string): string {
  const existingNames = new Set(draft.objects.map((object) => object.name));
  const baseName = normalizeName(sourceName) ?? "Object";

  for (let ordinal = 1; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const suffix = ordinal === 1 ? " Copy" : ` Copy ${ordinal}`;
    const candidate = `${baseName.slice(0, NAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  throw new Error("Unable to allocate a unique scene object name.");
}

function normalizeName(name: string): string | undefined {
  const normalized = name.trim().slice(0, NAME_MAX_LENGTH);
  return normalized || undefined;
}

function formatOrdinal(ordinal: number): string {
  return String(ordinal).padStart(2, "0");
}
