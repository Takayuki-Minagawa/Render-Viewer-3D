import type {
  DeepReadonly,
  TransformModel,
  Vec3Model,
} from "./scene-model";

export type ImportedMaterialMode = "imported" | "custom";

export interface ImportedNodeModel {
  id: string;
  name: string;
  objectType: string;
  mesh: boolean;
  triangleCount: number;
  children: ImportedNodeModel[];
}

export interface ImportedSceneMetadata {
  fileName: string;
  format: string;
  objectCount: number;
  triangleCount: number;
  materialCount: number;
  animationCount?: number;
  unit?: string;
  sourceUnit?: string;
  sizeBytes: number;
}

export interface ImportedSceneWarning {
  code: string;
  message: string;
}

export interface ImportedSceneModel {
  id: string;
  assetId: string;
  name: string;
  format: string;
  visible: boolean;
  transform: TransformModel;
  materialMode: ImportedMaterialMode;
  customMaterialId: string | null;
  metadata: ImportedSceneMetadata;
  warnings: ImportedSceneWarning[];
  hierarchy: ImportedNodeModel[];
}

export type ImportedSceneSnapshot = DeepReadonly<ImportedSceneModel>;

export interface CreateImportedSceneInput {
  id: string;
  assetId: string;
  name: string;
  format: string;
  visible?: boolean;
  transform?: PartialTransformModel;
  materialMode?: ImportedMaterialMode;
  customMaterialId?: string | null;
  metadata: ImportedSceneMetadata;
  warnings?: ImportedSceneWarning[];
  hierarchy?: ImportedNodeModel[];
}

export interface PartialTransformModel {
  position?: Partial<Vec3Model>;
  rotationDegrees?: Partial<Vec3Model>;
  scale?: Partial<Vec3Model>;
}

const DEFAULT_TRANSFORM: TransformModel = {
  position: { x: 0, y: 0, z: 0 },
  rotationDegrees: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

const MAX_NAME_LENGTH = 80;

export function createImportedSceneModel(
  input: CreateImportedSceneInput,
): ImportedSceneModel {
  const id = requireIdentifier(input.id, "Imported scene id");
  const assetId = requireIdentifier(input.assetId, "Imported asset id");
  const format = requireIdentifier(input.format, "Imported scene format");
  const name = normalizeName(input.name);
  if (!name) throw new Error("Imported scene name must not be empty.");

  const materialMode = input.materialMode ?? "imported";
  const customMaterialId = normalizeOptionalIdentifier(input.customMaterialId);
  if (materialMode === "custom" && customMaterialId === null) {
    throw new Error("Custom material mode requires a material id.");
  }

  const transform = mergeTransform(DEFAULT_TRANSFORM, input.transform);
  if (!isFiniteTransformUpdate(transform)) {
    throw new Error("Imported scene transform must contain only finite values.");
  }

  return {
    id,
    assetId,
    name,
    format,
    visible: input.visible ?? true,
    transform,
    materialMode,
    customMaterialId,
    metadata: structuredClone(input.metadata),
    warnings: structuredClone(input.warnings ?? []),
    hierarchy: structuredClone(input.hierarchy ?? []),
  };
}

export function addImportedScene(
  imports: ImportedSceneModel[],
  input: CreateImportedSceneInput,
): ImportedSceneModel {
  const model = createImportedSceneModel(input);
  if (imports.some(({ id }) => id === model.id)) {
    throw new Error(`Duplicate imported scene id: ${model.id}`);
  }
  if (imports.some(({ assetId }) => assetId === model.assetId)) {
    throw new Error(`Duplicate imported asset id: ${model.assetId}`);
  }
  imports.push(model);
  return model;
}

export function renameImportedScene(
  imports: ImportedSceneModel[],
  importedSceneId: string,
  name: string,
): boolean {
  const model = findImportedScene(imports, importedSceneId);
  const normalizedName = normalizeName(name);
  if (!model || !normalizedName) return false;
  model.name = normalizedName;
  return true;
}

export function setImportedSceneVisibility(
  imports: ImportedSceneModel[],
  importedSceneId: string,
  visible: boolean,
): boolean {
  const model = findImportedScene(imports, importedSceneId);
  if (!model) return false;
  model.visible = visible;
  return true;
}

export function updateImportedSceneTransform(
  imports: ImportedSceneModel[],
  importedSceneId: string,
  update: PartialTransformModel,
): boolean {
  const model = findImportedScene(imports, importedSceneId);
  if (!model || !isFiniteTransformUpdate(update)) return false;
  model.transform = mergeTransform(model.transform, update);
  return true;
}

export function setImportedSceneMaterialMode(
  imports: ImportedSceneModel[],
  importedSceneId: string,
  materialMode: ImportedMaterialMode,
  customMaterialId?: string | null,
): boolean {
  const model = findImportedScene(imports, importedSceneId);
  if (!model) return false;

  const nextCustomMaterialId =
    customMaterialId === undefined
      ? model.customMaterialId
      : normalizeOptionalIdentifier(customMaterialId);
  if (materialMode === "custom" && nextCustomMaterialId === null) return false;

  model.materialMode = materialMode;
  model.customMaterialId = nextCustomMaterialId;
  return true;
}

export function deleteImportedScene(
  imports: ImportedSceneModel[],
  importedSceneId: string,
): boolean {
  const index = imports.findIndex(({ id }) => id === importedSceneId);
  if (index < 0) return false;
  imports.splice(index, 1);
  return true;
}

function findImportedScene(
  imports: ImportedSceneModel[],
  importedSceneId: string,
): ImportedSceneModel | undefined {
  return imports.find(({ id }) => id === importedSceneId);
}

function mergeTransform(
  current: TransformModel,
  update: PartialTransformModel | undefined,
): TransformModel {
  return {
    position: mergeVector(current.position, update?.position),
    rotationDegrees: mergeVector(
      current.rotationDegrees,
      update?.rotationDegrees,
    ),
    scale: mergeVector(current.scale, update?.scale),
  };
}

function mergeVector(current: Vec3Model, update: Partial<Vec3Model> | undefined): Vec3Model {
  return {
    x: update?.x ?? current.x,
    y: update?.y ?? current.y,
    z: update?.z ?? current.z,
  };
}

function isFiniteTransformUpdate(update: PartialTransformModel): boolean {
  return [update.position, update.rotationDegrees, update.scale].every(
    (vector) =>
      vector === undefined ||
      Object.values(vector).every(
        (value) => value === undefined || Number.isFinite(value),
      ),
  );
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeName(value: string): string {
  return value.trim().slice(0, MAX_NAME_LENGTH);
}
