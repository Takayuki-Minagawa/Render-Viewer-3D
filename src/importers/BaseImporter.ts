import * as THREE from "three";
import { throwIfImportAborted } from "./abort";
import {
  createModelMetadata,
  normalizeImportedRoot,
  type NormalizationContext,
} from "./normalization";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
  ModelImporter,
} from "./types";

export function fileExtension(fileName: string): string {
  const separator = fileName.lastIndexOf(".");
  if (separator < 0 || separator === fileName.length - 1) {
    return "";
  }
  return fileName.slice(separator + 1).toLowerCase();
}

export abstract class BaseImporter implements ModelImporter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly extensions: readonly string[];
  abstract readonly experimental: boolean;

  canImport(file: File): boolean {
    const extension = fileExtension(file.name);
    return this.extensions.some(
      (candidate) => candidate.toLowerCase() === extension,
    );
  }

  abstract import(
    primary: File,
    allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel>;

  protected assertNotAborted(options: ImportOptions): void {
    throwIfImportAborted(options.signal);
  }

  protected createRoot(primary: File, content: THREE.Object3D): THREE.Group {
    const root = new THREE.Group();
    root.name = primary.name;
    root.add(content);
    return root;
  }

  protected finishImport(
    primary: File,
    format: string,
    root: THREE.Object3D,
    options: ImportOptions,
    warnings: ImportWarning[] = [],
    context: NormalizationContext = {},
  ): ImportedModel {
    this.assertNotAborted(options);
    normalizeImportedRoot(root, options, warnings, context);
    return {
      root,
      metadata: createModelMetadata(primary.name, format, root),
      warnings,
    };
  }
}
