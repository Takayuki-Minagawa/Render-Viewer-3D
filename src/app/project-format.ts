import type { SceneSnapshot } from "../model/scene-model";
import type { ImportOptions } from "../importers/types";
import type { MaterialImageAssetStore } from "../three/material/image-asset-store";
import { imageAssetIds, type ProjectAssets, type ImportSource } from "./project-assets";
import { record, text, validateJsonTree, validateScene } from "./project-validation";

const MAGIC = new TextEncoder().encode("RV3D0001");
export const PROJECT_MAX_BYTES = 512 * 1024 * 1024;
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
interface FileEntry { name: string; path: string; type: string; size: number; sha256: string; }
interface SavedImport { assetId: string; primaryName: string; primaryPath: string; files: number[]; options: Omit<ImportOptions, "signal">; }
interface Manifest {
  format: "render-viewer-3d"; version: 1; importerVersion: string;
  scene: SceneSnapshot; files: FileEntry[]; imports: SavedImport[];
  images: { assetId: string; file: number }[];
  environment?: { assetId: string; file: number };
}
export interface DecodedProject {
  model: ReturnType<typeof validateScene>;
  imports: Map<string, ImportSource>;
  images: Map<string, File>;
  importerVersion: string;
  environment?: File;
}
async function hash(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
}
function pathSafe(value: string): boolean {
  return !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(p => p === ".." || p === ".") && !value.includes("\0");
}

/** Length-prefixed manifest plus raw bytes: no base64 expansion or archive decompression. */
export async function encodeProject(model: SceneSnapshot, sources: ProjectAssets, images: MaterialImageAssetStore): Promise<Blob> {
  validateScene(model);
  const files: File[] = [];
  const indexes = new Map<File, number>();
  let total = 0;
  const addFile = (file: File): number => {
    const known = indexes.get(file); if (known !== undefined) return known;
    total += file.size;
    if (total > PROJECT_MAX_BYTES || file.size > 128 * 1024 * 1024 || files.length >= 4096) throw new Error("Project file size limit exceeded.");
    indexes.set(file, files.length); files.push(file); return files.length - 1;
  };
  const imports = model.imports.map(({ assetId }) => {
    const source = sources.imports.get(assetId); if (!source) throw new Error(`Missing original model bytes: ${assetId}`);
    return { assetId, primaryName: source.primaryName, primaryPath: source.primaryPath, options: source.options, files: source.files.map(addFile) };
  });
  const savedImages = [...imageAssetIds(model)].map(assetId => {
    const file = images.sourceFile(assetId); if (!file) throw new Error(`Missing image bytes: ${assetId}`);
    return { assetId, file: addFile(file) };
  });
  let environment: Manifest["environment"];
  if (model.environment) {
    const file = sources.environments.get(model.environment.assetId);
    if (!file) throw new Error("Missing original HDR environment.");
    environment = { assetId: model.environment.assetId, file: addFile(file) };
  }
  const entries: FileEntry[] = [];
  for (const file of files) entries.push({ name: file.name, path: file.webkitRelativePath || file.name, type: file.type, size: file.size, sha256: await hash(file) });
  const manifest: Manifest = { format: "render-viewer-3d", version: 1, importerVersion: "three-r185/occt-wasm-4.3.1/rv3d-1", scene: model, files: entries, imports, images: savedImages, ...(environment ? { environment } : {}) };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  if (json.byteLength > MANIFEST_MAX_BYTES || total + json.byteLength + 12 > PROJECT_MAX_BYTES) throw new Error("Project limit exceeded.");
  const prefix = new Uint8Array(12); prefix.set(MAGIC); new DataView(prefix.buffer).setUint32(8, json.byteLength, true);
  return new Blob([prefix, json, ...files], { type: "application/octet-stream" });
}

export async function decodeProject(blob: Blob): Promise<DecodedProject> {
  if (blob.size < 12 || blob.size > PROJECT_MAX_BYTES) throw new Error("Invalid project file size.");
  const prefix = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (!MAGIC.every((v, i) => v === prefix[i])) throw new Error("Unsupported project format/version.");
  const length = new DataView(prefix.buffer).getUint32(8, true);
  if (length > MANIFEST_MAX_BYTES || length + 12 > blob.size) throw new Error("Invalid project manifest length.");
  const raw: unknown = JSON.parse(await blob.slice(12, 12 + length).text());
  validateJsonTree(raw);
  const m = record(raw);
  if (m.format !== "render-viewer-3d" || m.version !== 1) throw new Error("Unsupported project version.");
  const model = validateScene(m.scene);
  if (!Array.isArray(m.files) || m.files.length > 4096 || !Array.isArray(m.imports) || !Array.isArray(m.images)) throw new Error("Invalid project manifest.");
  const files: File[] = [];
  let offset = 12 + length;
  for (const rawEntry of m.files) {
    const e = record(rawEntry); const name = text(e.name); const path = text(e.path);
    if (!pathSafe(path) || !pathSafe(name) || typeof e.type !== "string" || typeof e.size !== "number" || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > 128 * 1024 * 1024 || offset + e.size > blob.size || typeof e.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(e.sha256)) throw new Error("Invalid project file entry.");
    const bytes = blob.slice(offset, offset + e.size); offset += e.size;
    if (await hash(bytes) !== e.sha256) throw new Error(`Project checksum mismatch: ${name}`);
    const file = new File([bytes], name, { type: e.type });
    Object.defineProperty(file, "webkitRelativePath", { value: path === name ? "" : path });
    files.push(file);
  }
  if (offset !== blob.size) throw new Error("Unexpected project trailing bytes.");
  const used = new Set<number>();
  const fileAt = (index: unknown): File => {
    if (typeof index !== "number" || !Number.isInteger(index) || !files[index]) throw new Error("Missing project file reference.");
    used.add(index); return files[index];
  };
  const imports = new Map<string, ImportSource>();
  for (const rawImport of m.imports) {
    const entry = record(rawImport); const id = text(entry.assetId); const primaryName = text(entry.primaryName);
    const primaryPath = entry.primaryPath === undefined ? primaryName : text(entry.primaryPath);
    if (imports.has(id) || !model.imports.some(a => a.assetId === id) || !Array.isArray(entry.files)) throw new Error("Invalid project import reference.");
    const options = record(entry.options);
    if (!["auto", "millimeter", "centimeter", "meter", "inch", "foot"].includes(String(options.unit)) || !["auto", "y-up", "z-up"].includes(String(options.coordinateSystem)) || !["low", "medium", "high"].includes(String(options.quality)) || typeof options.centerModel !== "boolean" || typeof options.placeOnGround !== "boolean") throw new Error("Invalid saved import options.");
    const sourceFiles = entry.files.map(fileAt);
    const paths = sourceFiles.map(f => f.webkitRelativePath || f.name);
    if (!pathSafe(primaryPath) || new Set(paths).size !== paths.length || sourceFiles.filter(f => (f.webkitRelativePath || f.name) === primaryPath && f.name === primaryName).length !== 1) throw new Error("Ambiguous project files.");
    imports.set(id, { primaryName, primaryPath, files: sourceFiles, options: options as unknown as ImportOptions });
  }
  if (imports.size !== model.imports.length) throw new Error("Missing original import files.");
  const imageIds = imageAssetIds(model); const images = new Map<string, File>();
  for (const rawImage of m.images) {
    const entry = record(rawImage); const id = text(entry.assetId);
    if (!imageIds.has(id) || images.has(id)) throw new Error("Invalid project image reference.");
    images.set(id, fileAt(entry.file));
  }
  let environment: File | undefined;
  if (model.environment) {
    const entry = record(m.environment);
    if (entry.assetId !== model.environment.assetId) throw new Error("Missing environment reference.");
    environment = fileAt(entry.file);
  } else if (m.environment !== undefined) throw new Error("Unexpected environment entry.");
  if (images.size !== imageIds.size || used.size !== files.length) throw new Error("Missing or unreferenced project files.");
  return { model, imports, images, importerVersion: text(m.importerVersion), environment };
}
