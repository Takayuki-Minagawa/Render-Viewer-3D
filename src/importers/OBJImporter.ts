import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { BaseImporter } from "./BaseImporter";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
} from "./types";

function referencedMaterialLibraries(source: string): string[] {
  const references = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*mtllib\s+(.+?)\s*$/iu.exec(line);
    if (match?.[1]) {
      references.add(match[1]);
    }
  }
  return [...references];
}

export class OBJImporter extends BaseImporter {
  readonly id = "obj";
  readonly name = "Wavefront OBJ";
  readonly extensions = ["obj"] as const;
  readonly experimental = false;

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    this.assertWithinMainThreadBudget([primary]);
    const source = await primary.text();
    this.assertNotAborted(options);

    const warnings: ImportWarning[] = [];
    const materialLibraries = referencedMaterialLibraries(source);
    if (materialLibraries.length > 0) {
      warnings.push({
        code: "obj-material-library-ignored",
        message: `OBJ material libraries are not imported yet: ${materialLibraries.join(", ")}. Geometry was loaded with fallback materials.`,
      });
    }

    const content = new OBJLoader().parse(source);
    const root = this.createRoot(primary, content);
    return this.finishImport(primary, "OBJ", root, options, warnings);
  }
}
