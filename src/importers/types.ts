import type * as THREE from "three";

export type ImportUnit =
  | "auto"
  | "millimeter"
  | "centimeter"
  | "meter"
  | "inch"
  | "foot";

export type ImportCoordinateSystem = "auto" | "y-up" | "z-up";

export type TriangulationQuality = "low" | "medium" | "high";

export interface ImportOptions {
  unit: ImportUnit;
  coordinateSystem: ImportCoordinateSystem;
  centerModel: boolean;
  placeOnGround: boolean;
  quality: TriangulationQuality;
  signal?: AbortSignal;
}

export const DEFAULT_IMPORT_OPTIONS: Readonly<ImportOptions> = Object.freeze({
  unit: "auto",
  coordinateSystem: "auto",
  centerModel: true,
  placeOnGround: true,
  quality: "medium",
});

export interface ImportWarning {
  code: string;
  message: string;
}

export interface ModelMetadata {
  fileName: string;
  format: string;
  objectCount?: number;
  triangleCount?: number;
  materialCount?: number;
  unit?: string;
}

export interface ImportedModel {
  root: THREE.Object3D;
  metadata: ModelMetadata;
  warnings: ImportWarning[];
}

export interface ModelImporter {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly experimental: boolean;

  canImport(file: File): boolean;

  import(
    primary: File,
    allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel>;
}

export type ResolvedImportUnit = Exclude<ImportUnit, "auto">;
export type ResolvedImportCoordinateSystem = Exclude<
  ImportCoordinateSystem,
  "auto"
>;
