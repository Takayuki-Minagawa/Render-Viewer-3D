import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { throwIfImportAborted } from "./abort";

export const STL_WORKER_THRESHOLD_BYTES = 1024 * 1024;

/** Only typed geometry buffers cross the boundary; the worker owns no DOM/GPU state. */
export async function parseSTL(data: ArrayBuffer, signal?: AbortSignal): Promise<THREE.BufferGeometry> {
  throwIfImportAborted(signal);
  if (data.byteLength < STL_WORKER_THRESHOLD_BYTES || typeof Worker === "undefined") return new STLLoader().parse(data);
  const worker = new Worker(new URL("./stl-worker-entry.ts", import.meta.url), { type: "module" });
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = (): void => { cleanup(); reject(signal?.reason ?? new DOMException("The model import was aborted.", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "STL worker failed.")); };
    worker.onmessage = ({ data: result }) => {
      cleanup();
      if (result.error) { reject(new Error(result.error)); return; }
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(result.attributes) as [string, { array: Float32Array; itemSize: number; normalized: boolean }][]) {
        geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
      }
      resolve(geometry);
    };
    try { worker.postMessage(data, [data]); } catch (error) { cleanup(); reject(error); }
  });
}
