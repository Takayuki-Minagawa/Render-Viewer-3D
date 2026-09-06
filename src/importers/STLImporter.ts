import { assertRenderableGeometryBudget } from "./geometry-budget";
import { disposeLoadedObject } from "./loader-resource-wait";
import * as THREE from "three";
import { parseSTL } from "./stl-parser";
import { BaseImporter } from "./BaseImporter";
import type { ImportedModel, ImportOptions } from "./types";

const DEFAULT_STL_COLOR = 0xd3d7dc;

export class STLImporter extends BaseImporter {
  readonly id = "stl";
  readonly name = "STL";
  readonly extensions = ["stl"] as const;
  readonly experimental = false;

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    this.assertWithinMainThreadBudget([primary]);
    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);

    const geometry = await parseSTL(data, options.signal);
    if (geometry.getAttribute("normal") === undefined) {
      geometry.computeVertexNormals();
    }

    const material = new THREE.MeshStandardMaterial({
      color: DEFAULT_STL_COLOR,
      roughness: 0.6,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = primary.name;

    const root = this.createRoot(primary, mesh);
    try {
      assertRenderableGeometryBudget(root, "STL");
      return this.finishImport(primary, "STL", root, options);
    } catch (error) {
      disposeLoadedObject(root);
      throw error;
    }
  }
}
