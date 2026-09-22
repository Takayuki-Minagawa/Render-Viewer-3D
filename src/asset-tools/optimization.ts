import { assetJSON, assertDiagnosticBudget, diagnoseAsset } from "./diagnostics";
import type { OptimizationResult } from "./types";

/** Optimize a private, self-contained snapshot. Scene objects are never accepted. */
export async function optimizeGlbCopy(input: Uint8Array): Promise<OptimizationResult> {
  assertDiagnosticBudget(input);
  const start = performance.now();
  const json = assetJSON(input);
  if (!json || input.length < 20 || new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(0, true) !== 0x46546c67) throw new Error("Optimization requires a self-contained GLB snapshot.");
  for (const key of ["buffers", "images"] as const) {
    if (!Array.isArray(json[key])) continue;
    for (const resource of json[key]) {
      if (resource && typeof resource === "object" && "uri" in resource) throw new Error("Optimization does not accept external or data URI resources; export a self-contained GLB first.");
    }
  }
  const original = await diagnoseAsset(input, "scene.glb");
  if (original.report.issues.numErrors) throw new Error("The original GLB contains validation errors. Save its diagnostic report before optimizing.");
  const [{ WebIO, PropertyType, Logger }, { ALL_EXTENSIONS }, { dedup, prune }] = await Promise.all([
    import("@gltf-transform/core"), import("@gltf-transform/extensions"), import("@gltf-transform/functions"),
  ]);
  const supported = new Set(ALL_EXTENSIONS.map((extension) => extension.EXTENSION_NAME));
  const declared = new Set<string>();
  // Missing extensionsUsed must never allow nested, unsupported data to be lost.
  const scan = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(scan); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === "extensions" && child && typeof child === "object") Object.keys(child).forEach((name) => declared.add(name));
      else if ((key === "extensionsUsed" || key === "extensionsRequired") && Array.isArray(child)) child.filter((name): name is string => typeof name === "string").forEach((name) => declared.add(name));
      scan(child);
    }
  };
  scan(json);
  for (const extension of declared) {
    if (!supported.has(extension) || ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(extension)) throw new Error(`This optimization preset cannot preserve ${extension}; use the original GLB.`);
  }
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(input.slice());
  document.setLogger(new Logger(Logger.Verbosity.SILENT));
  // Narrow property selection intentionally keeps nodes, named materials, meshes,
  // animations, skin/morph structure, attributes and texture contents unchanged.
  await document.transform(
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    prune({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.BUFFER], keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
  );
  const candidate = await io.writeBinary(document);
  const result = await diagnoseAsset(candidate, "scene-optimized.glb");
  if (result.report.issues.numErrors) throw new Error("The optimized copy failed validation. Use the original GLB.");
  const reduced = candidate.byteLength < input.byteLength;
  const bytes = reduced ? candidate : input.slice();
  return {
    ...(reduced ? result : original), bytes, reduced,
    inputBytes: input.byteLength, outputBytes: bytes.byteLength,
    durationMs: performance.now() - start,
    estimatedWorkingBytes: input.byteLength * 6 + candidate.byteLength * 2,
  };
}
