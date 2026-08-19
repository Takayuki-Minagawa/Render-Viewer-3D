import { GLTFImporter } from "./GLTFImporter";
import { OBJImporter } from "./OBJImporter";
import { STEPImporter } from "./STEPImporter";
import { STLImporter } from "./STLImporter";
import type { ModelImporter } from "./types";

export const importerRegistry: readonly ModelImporter[] = Object.freeze([
  new GLTFImporter(),
  new OBJImporter(),
  new STLImporter(),
  new STEPImporter(),
]);

export function getSupportedExtensions(
  importers: readonly ModelImporter[] = importerRegistry,
): readonly string[] {
  const extensions = new Set<string>();
  for (const importer of importers) {
    for (const extension of importer.extensions) {
      extensions.add(extension.replace(/^\./u, "").toLowerCase());
    }
  }
  return [...extensions];
}

export function getImportAccept(
  importers: readonly ModelImporter[] = importerRegistry,
): string {
  return getSupportedExtensions(importers)
    .map((extension) => `.${extension}`)
    .join(",");
}

export const SUPPORTED_IMPORT_EXTENSIONS = getSupportedExtensions();
export const IMPORT_FILE_ACCEPT = getImportAccept();
