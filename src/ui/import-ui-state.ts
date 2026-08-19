import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportCoordinateSystem,
  type ImportOptions,
  type ImportUnit,
  type ModelImporter,
  type TriangulationQuality,
} from "../importers";

export interface ImportOptionValues {
  unit?: unknown;
  coordinateSystem?: unknown;
  centerModel?: unknown;
  placeOnGround?: unknown;
  quality?: unknown;
}

export interface ImporterDisplayItem {
  id: string;
  label: string;
  experimental: boolean;
}

const IMPORT_UNITS = new Set<ImportUnit>([
  "auto",
  "millimeter",
  "centimeter",
  "meter",
  "inch",
  "foot",
]);
const COORDINATE_SYSTEMS = new Set<ImportCoordinateSystem>([
  "auto",
  "y-up",
  "z-up",
]);
const TRIANGULATION_QUALITIES = new Set<TriangulationQuality>([
  "low",
  "medium",
  "high",
]);

export function createImportOptions(values: ImportOptionValues): ImportOptions {
  return {
    unit: isImportUnit(values.unit) ? values.unit : DEFAULT_IMPORT_OPTIONS.unit,
    coordinateSystem: isCoordinateSystem(values.coordinateSystem)
      ? values.coordinateSystem
      : DEFAULT_IMPORT_OPTIONS.coordinateSystem,
    centerModel:
      typeof values.centerModel === "boolean"
        ? values.centerModel
        : DEFAULT_IMPORT_OPTIONS.centerModel,
    placeOnGround:
      typeof values.placeOnGround === "boolean"
        ? values.placeOnGround
        : DEFAULT_IMPORT_OPTIONS.placeOnGround,
    quality: isTriangulationQuality(values.quality)
      ? values.quality
      : DEFAULT_IMPORT_OPTIONS.quality,
  };
}

export function hasDraggedFiles(types: Iterable<string>): boolean {
  for (const type of types) {
    if (type.toLowerCase() === "files") return true;
  }
  return false;
}

export function createImporterDisplayItems(
  importers: readonly Pick<
    ModelImporter,
    "id" | "name" | "extensions" | "experimental"
  >[],
): readonly ImporterDisplayItem[] {
  return importers.map((importer) => ({
    id: importer.id,
    label: `${importer.name} (${importer.extensions
      .map((extension) => `.${extension.replace(/^\./u, "").toLowerCase()}`)
      .join(", ")})`,
    experimental: importer.experimental,
  }));
}

export function importErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return String(error || "Unknown import error.");
}

function isImportUnit(value: unknown): value is ImportUnit {
  return typeof value === "string" && IMPORT_UNITS.has(value as ImportUnit);
}

function isCoordinateSystem(value: unknown): value is ImportCoordinateSystem {
  return (
    typeof value === "string" &&
    COORDINATE_SYSTEMS.has(value as ImportCoordinateSystem)
  );
}

function isTriangulationQuality(value: unknown): value is TriangulationQuality {
  return (
    typeof value === "string" &&
    TRIANGULATION_QUALITIES.has(value as TriangulationQuality)
  );
}
