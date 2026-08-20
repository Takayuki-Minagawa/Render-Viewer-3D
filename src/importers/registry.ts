import { ColladaImporter } from "./ColladaImporter";
import { FBXImporter } from "./FBXImporter";
import { GLTFImporter } from "./GLTFImporter";
import { OBJImporter } from "./OBJImporter";
import { PLYImporter } from "./PLYImporter";
import { STEPImporter } from "./STEPImporter";
import { STLImporter } from "./STLImporter";
import { ThreeMFImporter } from "./ThreeMFImporter";
import type { ModelImporter } from "./types";

export const IMPORT_RESOURCE_EXTENSIONS = Object.freeze([
  "bin",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "tga",
  "bmp",
  "gif",
]);

export const importerRegistry: readonly ModelImporter[] = Object.freeze([
  new GLTFImporter(),
  new OBJImporter(),
  new STLImporter(),
  new PLYImporter(),
  new FBXImporter(),
  new ColladaImporter(),
  new ThreeMFImporter(),
  new STEPImporter(),
]);

function normalizedExtension(extension: string): string {
  return extension.replace(/^\./u, "").toLowerCase();
}

export function getSupportedExtensions(
  importers: readonly ModelImporter[] = importerRegistry,
): readonly string[] {
  const extensions = new Set<string>();
  for (const importer of importers) {
    for (const extension of importer.extensions) {
      extensions.add(normalizedExtension(extension));
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

export function getImportFileInputAccept(
  importers: readonly ModelImporter[] = importerRegistry,
  resourceExtensions: readonly string[] = IMPORT_RESOURCE_EXTENSIONS,
): string {
  const extensions = new Set(getSupportedExtensions(importers));
  for (const extension of resourceExtensions) {
    const normalized = normalizedExtension(extension);
    if (normalized) extensions.add(normalized);
  }
  return [...extensions].map((extension) => `.${extension}`).join(",");
}

export const SUPPORTED_IMPORT_EXTENSIONS = getSupportedExtensions();
export const IMPORT_FILE_ACCEPT = getImportAccept();
export const IMPORT_FILE_INPUT_ACCEPT = getImportFileInputAccept();
