import { throwIfImportAborted } from "./abort";
import { fileExtension } from "./BaseImporter";
import {
  getImportAccept,
  getSupportedExtensions,
  importerRegistry,
} from "./registry";
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportedModel,
  type ImportOptions,
  type ModelImporter,
} from "./types";

function normalizedExtension(extension: string): string {
  return extension.replace(/^\./u, "").toLowerCase();
}

export class ImportManager {
  readonly importers: readonly ModelImporter[];

  private readonly importersByExtension = new Map<string, ModelImporter>();

  constructor(importers: readonly ModelImporter[] = importerRegistry) {
    this.importers = [...importers];
    const ids = new Set<string>();

    for (const importer of this.importers) {
      if (ids.has(importer.id)) {
        throw new Error(`Duplicate importer id: ${importer.id}.`);
      }
      ids.add(importer.id);

      for (const declaredExtension of importer.extensions) {
        const extension = normalizedExtension(declaredExtension);
        if (!extension) {
          throw new Error(`Importer ${importer.id} declares an empty extension.`);
        }

        const existing = this.importersByExtension.get(extension);
        if (existing) {
          throw new Error(
            `Extension .${extension} is declared by both ${existing.id} and ${importer.id}.`,
          );
        }
        this.importersByExtension.set(extension, importer);
      }
    }
  }

  get supportedExtensions(): readonly string[] {
    return getSupportedExtensions(this.importers);
  }

  get accept(): string {
    return getImportAccept(this.importers);
  }

  findImporter(file: File): ModelImporter | undefined {
    return this.importersByExtension.get(fileExtension(file.name));
  }

  canImport(file: File): boolean {
    return this.findImporter(file) !== undefined;
  }

  async import(
    primary: File,
    allFiles: readonly File[] = [primary],
    options: ImportOptions = DEFAULT_IMPORT_OPTIONS,
  ): Promise<ImportedModel> {
    throwIfImportAborted(options.signal);
    const importer = this.findImporter(primary);
    if (!importer) {
      const extension = fileExtension(primary.name);
      const format = extension ? `.${extension}` : "a file without an extension";
      throw new Error(
        `Unsupported model format: ${format}. Supported extensions: ${this.accept}.`,
      );
    }

    const files = allFiles.includes(primary)
      ? allFiles
      : [primary, ...allFiles];
    return importer.import(primary, files, options);
  }
}
