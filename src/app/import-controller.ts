import * as THREE from "three";
import type { EditorStore } from "./editor-store";
import type { SceneStore } from "./scene-store";
import {
  addImportedScene,
  type ImportedNodeModel,
  type ImportedSceneMetadata,
  type ImportedSceneModel,
} from "../model/imported-scene-model";
import type { SceneSnapshot } from "../model/scene-model";
import {
  ImportManager,
  collectImportedMaterialDefinitions,
  type ImportedModel,
  type ImportOptions,
} from "../importers";
import { throwIfImportAborted } from "../importers/abort";
import type { ImportedAssetStore } from "../three/imported-asset-store";

interface ImportViewport {
  fitToObject: (objectId: string) => boolean;
}

interface HierarchyResult {
  readonly nodes: ImportedNodeModel[];
  readonly truncated: boolean;
}

const HIERARCHY_NODE_LIMIT = 10_000;
const HIERARCHY_DEPTH_LIMIT = 64;

export class ImportController {
  #nextOrdinal = 1;

  constructor(
    readonly manager: ImportManager,
    readonly assets: ImportedAssetStore,
    readonly sceneStore: SceneStore,
    readonly editorStore: EditorStore,
    readonly viewport: ImportViewport,
  ) {}

  async importFiles(
    files: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedSceneModel> {
    if (files.length === 0) throw new Error("No model file was selected.");

    const primaryFiles = files.filter((file) => this.manager.canImport(file));
    if (primaryFiles.length === 0) {
      await this.manager.import(files[0], files, options);
      throw new Error("The importer registry changed while importing the file.");
    }
    if (primaryFiles.length > 1) {
      throw new Error(
        "Select one supported model file at a time. Additional files may be glTF sidecar resources.",
      );
    }

    const primary = primaryFiles[0];
    const imported = await this.manager.import(primary, files, options);
    const snapshot = this.sceneStore.getSnapshot();
    const id = this.#createUniqueId(primary.name, snapshot);
    const assetId = `${id}-asset`;
    this.assets.register(assetId, imported.root);

    try {
      throwIfImportAborted(options.signal);
      const hierarchy = buildImportedHierarchy(imported.root);
      if (hierarchy.truncated) {
        imported.warnings.push({
          code: "hierarchy-truncated",
          message: `The Object Tree preview was limited to ${HIERARCHY_NODE_LIMIT.toLocaleString("en-US")} nodes. The complete Three.js hierarchy remains loaded.`,
        });
      }

      const materialDefinitions = collectImportedMaterialDefinitions(
        imported.root,
        id,
      );
      const materialIds = new Set(snapshot.materials.map(({ id }) => id));
      for (const definition of materialDefinitions) {
        const baseId = definition.id;
        let ordinal = 2;
        while (materialIds.has(definition.id)) {
          definition.id = `${baseId}-${ordinal}`;
          ordinal += 1;
        }
        materialIds.add(definition.id);
      }

      const model = createImportedSceneRecord(
        id,
        assetId,
        primary,
        imported,
        hierarchy.nodes,
        materialDefinitions[0]?.id ?? null,
      );
      this.sceneStore.update((draft) => {
        addImportedScene(draft.imports, model);
        draft.materials.push(...materialDefinitions);
      });

      this.editorStore.setSelectedObjectId(id);
      this.viewport.fitToObject(id);
      return model;
    } catch (error) {
      const published = this.sceneStore
        .getSnapshot()
        .imports.some((candidate) => candidate.id === id);
      if (!published) this.assets.delete(assetId);
      throw error;
    }
  }

  #createUniqueId(fileName: string, snapshot: SceneSnapshot): string {
    const stem = fileName.replace(/\.[^.]+$/u, "");
    const slug = stem
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase()
      .slice(0, 40) || "model";
    const ids = new Set([
      ...snapshot.objects.map(({ id }) => id),
      ...snapshot.imports.map(({ id }) => id),
    ]);

    let candidate: string;
    do {
      candidate = `import-${slug}-${this.#nextOrdinal}`;
      this.#nextOrdinal += 1;
    } while (ids.has(candidate));
    return candidate;
  }
}

export function buildImportedHierarchy(root: THREE.Object3D): HierarchyResult {
  let count = 0;
  let visited = 0;
  let truncated = false;

  const visit = (
    object: THREE.Object3D,
    path: string,
    depth: number,
  ): ImportedNodeModel | undefined => {
    if (visited >= HIERARCHY_NODE_LIMIT) {
      truncated = true;
      return undefined;
    }
    visited += 1;
    if (depth > HIERARCHY_DEPTH_LIMIT) {
      truncated = true;
      return undefined;
    }
    count += 1;
    const mesh = object instanceof THREE.Mesh;
    const node: ImportedNodeModel = {
      id: path,
      name: object.name.trim() || `${object.type} ${count}`,
      objectType: object.type,
      mesh,
      triangleCount: mesh ? triangleCount(object.geometry) : 0,
      children: [],
    };
    for (let index = 0; index < object.children.length; index += 1) {
      if (visited >= HIERARCHY_NODE_LIMIT) {
        truncated = true;
        break;
      }
      const child = object.children[index];
      const childNode = visit(child, `${path}-${index}`, depth + 1);
      if (childNode) node.children.push(childNode);
    }
    return node;
  };

  const nodes: ImportedNodeModel[] = [];
  for (let index = 0; index < root.children.length; index += 1) {
    if (visited >= HIERARCHY_NODE_LIMIT) {
      truncated = true;
      break;
    }
    const child = root.children[index];
    const node = visit(child, `node-${index}`, 0);
    if (node) nodes.push(node);
  }
  return { nodes, truncated };
}

function createImportedSceneRecord(
  id: string,
  assetId: string,
  primary: File,
  imported: ImportedModel,
  hierarchy: ImportedNodeModel[],
  customMaterialId: string | null,
): ImportedSceneModel {
  const metadata: ImportedSceneMetadata = {
    fileName: imported.metadata.fileName,
    format: imported.metadata.format,
    objectCount: imported.metadata.objectCount ?? 0,
    triangleCount: imported.metadata.triangleCount ?? 0,
    materialCount: imported.metadata.materialCount ?? 0,
    animationCount: imported.root.animations.length,
    unit: imported.metadata.unit,
    sourceUnit: sourceUnitForFormat(imported.metadata.format),
    sizeBytes: primary.size,
  };
  return {
    id,
    assetId,
    name: primary.name,
    format: imported.metadata.format,
    visible: true,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    materialMode: "imported",
    customMaterialId,
    metadata,
    warnings: imported.warnings.map(({ code, message }) => ({ code, message })),
    hierarchy,
  };
}

function sourceUnitForFormat(format: string): string | undefined {
  if (format === "glTF") return "meter";
  if (format === "STEP") return "millimeter";
  return undefined;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const count =
    geometry.getIndex()?.count ?? geometry.getAttribute("position")?.count ?? 0;
  return Math.floor(count / 3);
}
