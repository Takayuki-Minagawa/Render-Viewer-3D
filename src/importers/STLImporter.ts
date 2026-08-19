import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
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
    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);

    const geometry = new STLLoader().parse(data);
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
    return this.finishImport(primary, "STL", root, options);
  }
}
