import { LocalResourceResolver } from "../importers/resource-resolver";
import { ASSET_TOOL_MAX_BYTES, ASSET_TOOL_MAX_TOTAL_BYTES, ASSET_TOOL_MAX_FILES, ASSET_TOOL_MAX_ISSUES, type DiagnosticResult } from "./types";

/** Deliberately permissive parsing: malformed assets must reach the validator. */
export function assetJSON(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    let jsonBytes = bytes;
    if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === 0x46546c67) {
      if (bytes.length < 20) return;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const size = view.getUint32(12, true);
      if (view.getUint32(16, true) !== 0x4e4f534a || size > bytes.length - 20) return;
      jsonBytes = bytes.subarray(20, 20 + size);
    }
    const json: unknown = JSON.parse(new TextDecoder().decode(jsonBytes));
    return json && typeof json === "object" && !Array.isArray(json) ? json as Record<string, unknown> : undefined;
  } catch { return; }
}
export function assertFileBudget(files: readonly File[]): void {
  if (files.length > ASSET_TOOL_MAX_FILES) throw new Error("Select at most 256 model/resource files.");
  let total = 0;
  for (const file of files) {
    if (file.size > ASSET_TOOL_MAX_BYTES) throw new Error("Each diagnostic file must be at most 64 MiB.");
    total += file.size;
    if (total > ASSET_TOOL_MAX_TOTAL_BYTES) throw new Error("Diagnostic files exceed the 128 MiB total limit.");
  }
}
export function assertDiagnosticBudget(bytes: Uint8Array): void {
  if (bytes.byteLength > ASSET_TOOL_MAX_BYTES) throw new Error("The diagnostic asset must be at most 64 MiB.");
  const json = assetJSON(bytes);
  if (!json) return;
  let declared = 0;
  for (const key of ["buffers", "bufferViews", "accessors"] as const) {
    if (!Array.isArray(json[key])) continue;
    for (const value of json[key]) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const count = key === "accessors" ? Number(record.count) * 64 : Number(record.byteLength);
      if (count > 0) declared += count;
      if (declared > 256 * 1024 * 1024) throw new Error("Declared glTF allocation exceeds the diagnostic safety limit (256 MiB).");
    }
  }
}
/** No URI is fetched: the resolver can read only files the user selected. */
export async function diagnoseAsset(bytes: Uint8Array, name: string, files: readonly File[] = [], primary?: File): Promise<DiagnosticResult> {
  assertFileBudget(files); assertDiagnosticBudget(bytes);
  const start = performance.now();
  const validator = await import("gltf-validator");
  const resolver = new LocalResourceResolver(files, primary);
  const resources = new Map<File, Promise<Uint8Array>>();
  try {
    const report = await validator.validateBytes(bytes, {
      uri: name, maxIssues: ASSET_TOOL_MAX_ISSUES, writeTimestamp: false,
      externalResourceFunction: async (uri) => {
        const file = resolver.resolveFile(uri);
        let resource = resources.get(file);
        if (!resource) { resource = file.arrayBuffer().then((buffer) => new Uint8Array(buffer)); resources.set(file, resource); }
        return resource;
      },
    });
    // Cap report data as well as issue count (messages may include untrusted text).
    for (const issue of report.issues.messages) {
      issue.message = issue.message.slice(0, 2048);
      if (issue.pointer) issue.pointer = issue.pointer.slice(0, 1024);
    }
    if (JSON.stringify(report).length > 4 * 1024 * 1024) throw new Error("The validation report exceeds the 4 MiB safety limit.");
    const extensions = assetJSON(bytes)?.extensionsUsed;
    const supported = new Set(validator.supportedExtensions());
    const unsupportedExtensions = Array.isArray(extensions) ? extensions.filter((name): name is string => typeof name === "string" && !supported.has(name)) : [];
    return { report, unsupportedExtensions, durationMs: performance.now() - start };
  } finally { resolver.dispose(); }
}
