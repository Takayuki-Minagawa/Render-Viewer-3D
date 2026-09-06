import * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import {
  assertRenderableGeometryBudget,
} from "./geometry-budget";
import {
  disposeLoadedObject,
  parseWithLoaderResourceWait,
} from "./loader-resource-wait";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
} from "./types";
import {
  inspectZipCentralDirectory,
  validateZipExpandedSizes,
} from "./zip-preflight";

import { MAX_3MF_ARCHIVE_BYTES, THREE_MF_ZIP_LIMITS, assertRequiredThreeMFEntries, inspectThreeMFPackage, resolveThreeMFUnit } from "./three-mf-preflight";
export { MAX_3MF_ARCHIVE_BYTES, MAX_3MF_XML_BYTES, MAX_3MF_XML_ELEMENTS, MAX_3MF_XML_DEPTH, THREE_MF_ZIP_LIMITS, assertThreeMFMeshPositionVertexBudget } from "./three-mf-preflight";

interface ThreeMFLoaderLike { parse(data: ArrayBuffer): THREE.Group; }

export type ThreeMFLoaderFactory = (
  manager: THREE.LoadingManager,
) => Promise<ThreeMFLoaderLike>;

async function createThreeMFLoader(
  manager: THREE.LoadingManager,
): Promise<ThreeMFLoaderLike> {
  const { ThreeMFLoader } = await import(
    "three/addons/loaders/3MFLoader.js"
  );
  return new ThreeMFLoader(manager);
}

export class ThreeMFImporter extends BaseImporter {
  readonly id = "3mf";
  readonly name = "3MF";
  readonly extensions = ["3mf"] as const;
  readonly experimental = true;

  constructor(
    private readonly loaderFactory: ThreeMFLoaderFactory = createThreeMFLoader,
  ) {
    super();
  }

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    if (primary.size > MAX_3MF_ARCHIVE_BYTES) {
      const limitMiB = MAX_3MF_ARCHIVE_BYTES / (1024 * 1024);
      throw new Error(
        `3MF import exceeds the ${limitMiB} MiB compressed archive safety limit. Split or optimize the model before importing it.`,
      );
    }

    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);
    if (data.byteLength > MAX_3MF_ARCHIVE_BYTES) {
      throw new Error("The 3MF archive exceeds its declared file size.");
    }
    const archive = inspectZipCentralDirectory(data, THREE_MF_ZIP_LIMITS);
    const modelEntry = assertRequiredThreeMFEntries(archive.fileNames);
    await validateZipExpandedSizes(data, archive, THREE_MF_ZIP_LIMITS);
    this.assertNotAborted(options);
    const inspectedUnit = await inspectThreeMFPackage(data, modelEntry);
    this.assertNotAborted(options);

    const manager = new THREE.LoadingManager();
    const loader = await this.loaderFactory(manager);
    this.assertNotAborted(options);
    let content: THREE.Group | undefined;

    try {
      content = await parseWithLoaderResourceWait(
        manager,
        () => {
          content = loader.parse(data);
          return content;
        },
        options.signal,
      );
      this.assertNotAborted(options);

      const warnings: ImportWarning[] = inspectedUnit
        ? []
        : [
            {
              code: "3mf-unit-assumed",
              message:
                "The 3MF model unit could not be inspected; Auto treats source coordinates as millimeters. Choose a unit explicitly if the package is incomplete or uses another unit.",
            },
          ];
      const unit = inspectedUnit ?? resolveThreeMFUnit(undefined);
      const root = this.createRoot(primary, content);
      assertRenderableGeometryBudget(root, "3MF");
      return this.finishImport(primary, "3MF", root, options, warnings, {
        sourceMetersPerUnit: unit.metersPerUnit,
        sourceUnitLabel: unit.label,
        sourceCoordinateSystem: "z-up",
      });
    } catch (error) {
      if (content) disposeLoadedObject(content);
      throw error;
    }
  }
}
