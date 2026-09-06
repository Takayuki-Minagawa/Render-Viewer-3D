import type { ImportOptions } from "../importers/types";
import type { SceneSnapshot } from "../model/scene-model";

export interface ImportSource {
  primaryName: string;
  primaryPath: string;
  files: readonly File[];
  options: Omit<ImportOptions, "signal">;
}

/** Original bytes are separate from both the scene model and GPU resources. */
export class ProjectAssets {
  readonly imports = new Map<string, ImportSource>();
  readonly environments = new Map<string, File>();

  capture(assetId: string, primary: File, files: readonly File[], options: ImportOptions): void {
    const { signal: _signal, ...savedOptions } = options;
    this.imports.set(assetId, { primaryName: primary.name, primaryPath: primary.webkitRelativePath || primary.name, files: files.includes(primary) ? [...files] : [primary, ...files], options: savedOptions });
  }

  retain(ids: ReadonlySet<string>, environments: ReadonlySet<string> = new Set()): void {
    for (const id of this.imports.keys()) if (!ids.has(id)) this.imports.delete(id);
    for (const id of this.environments.keys()) if (!environments.has(id)) this.environments.delete(id);
  }
}

export function imageAssetIds(model: SceneSnapshot): Set<string> {
  const ids = new Set<string>();
  // Includes current color maps and future channel maps without persisting runtime objects.
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("assetId" in value && "mimeType" in value && typeof value.assetId === "string") ids.add(value.assetId);
    for (const child of Object.values(value)) visit(child);
  };
  visit(model.materials);
  return ids;
}
