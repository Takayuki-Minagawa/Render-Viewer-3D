import type {
  SceneModel,
  SceneObjectModel,
} from "../scene-model";
import {
  createDefaultPhysicalMaterialPreview,
  createMaterialDefinitionFromPreview,
} from "./material-presets";

export interface LegacyMaterialModelV1 {
  color: string;
  metalness: number;
  roughness: number;
}

export type LegacySceneObjectModelV1 = Omit<
  SceneObjectModel,
  "materialId"
> & {
  material: LegacyMaterialModelV1;
};

export type LegacySceneModelV1 = Omit<
  SceneModel,
  "schemaVersion" | "materials" | "objects"
> & {
  schemaVersion: 1;
  objects: LegacySceneObjectModelV1[];
};

export function migrateSceneModel(
  source: SceneModel | LegacySceneModelV1,
): SceneModel {
  const schemaVersion = (source as { schemaVersion: number }).schemaVersion;
  if (schemaVersion === 2) return structuredClone(source as SceneModel);
  if (schemaVersion !== 1) {
    throw new Error(`Unsupported scene schema version: ${String(schemaVersion)}`);
  }

  const legacy = structuredClone(source as LegacySceneModelV1);
  const allocatedIds = new Set<string>();
  const materials: SceneModel["materials"] = [];
  const objects: SceneObjectModel[] = legacy.objects.map((legacyObject) => {
    const { material: legacyMaterial, ...object } = legacyObject;
    const materialId = allocateMigratedMaterialId(
      legacyObject.id,
      allocatedIds,
    );
    const materialPreview = createDefaultPhysicalMaterialPreview({
      baseColor: legacyMaterial.color,
      metalness: legacyMaterial.metalness,
      roughness: legacyMaterial.roughness,
    });

    materials.push(
      createMaterialDefinitionFromPreview(
        materialId,
        `${legacyObject.name} Material`,
        materialPreview,
      ),
    );

    return { ...object, materialId };
  });

  return {
    ...legacy,
    schemaVersion: 2,
    materials,
    objects,
  };
}

export function isLegacySceneModelV1(
  scene: SceneModel | LegacySceneModelV1,
): scene is LegacySceneModelV1 {
  return scene.schemaVersion === 1;
}

function allocateMigratedMaterialId(
  objectId: string,
  allocatedIds: Set<string>,
): string {
  const objectPart =
    objectId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "object";
  const base = `${objectPart}-material`;
  if (!allocatedIds.has(base)) {
    allocatedIds.add(base);
    return base;
  }

  for (let ordinal = 2; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const candidate = `${base}-${ordinal}`;
    if (!allocatedIds.has(candidate)) {
      allocatedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error("Unable to allocate a migrated material id.");
}
