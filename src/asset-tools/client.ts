import { assertFileBudget } from "./diagnostics";
import { ASSET_TOOL_MAX_BYTES, ASSET_TOOL_TIMEOUT_MS, type AssetToolRequest, type AssetToolResponse, type DiagnosticResult, type OptimizationResult } from "./types";

export interface AssetToolOptions { signal?: AbortSignal; timeoutMs?: number; }
export function diagnoseFiles(files: readonly File[], primaryIndex = 0, options: AssetToolOptions = {}): Promise<DiagnosticResult> {
  assertFileBudget(files);
  return runAssetTool({ operation: "validate-files", files: files.map((file) => ({ file, path: file.webkitRelativePath || file.name })), primaryIndex }, options);
}
export function diagnoseGlb(bytes: ArrayBuffer, options: AssetToolOptions = {}): Promise<DiagnosticResult> {
  return runAssetTool({ operation: "validate-bytes", bytes: copyBytes(bytes), name: "scene.glb" }, options);
}
export function optimizeGlb(bytes: ArrayBuffer, options: AssetToolOptions = {}): Promise<OptimizationResult> {
  return runAssetTool({ operation: "optimize", bytes: copyBytes(bytes), name: "scene.glb" }, options) as Promise<OptimizationResult>;
}
function copyBytes(bytes: ArrayBuffer): Uint8Array<ArrayBuffer> {
  if (bytes.byteLength > ASSET_TOOL_MAX_BYTES) throw new Error("The GLB must be at most 64 MiB.");
  return new Uint8Array(bytes.slice(0));
}
/** A fresh Worker per job provides hard cancellation, timeout and memory release. */
export function runAssetTool(request: AssetToolRequest, options: AssetToolOptions = {}): Promise<DiagnosticResult | OptimizationResult> {
  if (options.signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let done = false;
    const finish = (error?: Error, result?: DiagnosticResult | OptimizationResult) => {
      if (done) return;
      done = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Asset processing exceeded the time limit (30 seconds).")), Math.min(ASSET_TOOL_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? ASSET_TOOL_TIMEOUT_MS)));
    options.signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<AssetToolResponse>) => event.data.ok ? finish(undefined, event.data.result) : finish(new Error(event.data.message));
    worker.onerror = (event) => { event.preventDefault(); finish(new Error(event.message || "Asset Worker failed.")); };
    worker.onmessageerror = () => finish(new Error("Unable to read the asset Worker response."));
    try {
      if ("bytes" in request) worker.postMessage(request, [request.bytes.buffer]);
      else worker.postMessage(request);
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
