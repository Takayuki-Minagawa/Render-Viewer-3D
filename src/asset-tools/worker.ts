import { diagnoseAsset } from "./diagnostics";
import { optimizeGlbCopy } from "./optimization";
import type { AssetToolRequest, AssetToolResponse, DiagnosticResult, OptimizationResult } from "./types";

self.onmessage = async (event: MessageEvent<AssetToolRequest>) => {
  const request = event.data;
  try {
    let result: DiagnosticResult | OptimizationResult;
    if (request.operation === "validate-files") {
      const files = request.files.map(({ file, path }) => {
        Object.defineProperty(file, "webkitRelativePath", { value: path, configurable: true });
        return file;
      });
      const primary = files[request.primaryIndex];
      if (!primary) throw new Error("Select a glTF or GLB model.");
      result = await diagnoseAsset(new Uint8Array(await primary.arrayBuffer()), primary.name, files, primary);
    } else {
      result = request.operation === "optimize"
        ? await optimizeGlbCopy(request.bytes)
        : await diagnoseAsset(request.bytes, request.name);
    }
    const response: AssetToolResponse = { ok: true, result };
    if ("bytes" in result && result.bytes instanceof Uint8Array) self.postMessage(response, { transfer: [result.bytes.buffer] });
    else self.postMessage(response);
  } catch (error) {
    const response: AssetToolResponse = { ok: false, message: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
};
