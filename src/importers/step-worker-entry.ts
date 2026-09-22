import * as Comlink from "comlink";
import { OcctKernel } from "occt-wasm";
import type { InitOptions } from "occt-wasm";
import type { ShapeHandle, TessellateOptions } from "occt-wasm";
import { exportSTEPAssembly } from "./step-assembly";

let kernel: OcctKernel | undefined;

const api = {
  async init(options?: InitOptions): Promise<void> {
    kernel?.[Symbol.dispose]();
    kernel = await OcctKernel.init(options);
  },
  get kernel(): OcctKernel {
    if (!kernel) {
      throw new Error("OcctKernel is not initialized.");
    }
    return Comlink.proxy(kernel);
  },
  importStep(data: string | ArrayBuffer) {
    if (!kernel) throw new Error("OcctKernel is not initialized.");
    return kernel.importStep(data);
  },
  tessellate(shape: ShapeHandle, options?: TessellateOptions) {
    if (!kernel) throw new Error("OcctKernel is not initialized.");
    return kernel.tessellate(shape, options);
  },
  release(shape: ShapeHandle) { kernel?.release(shape); },
  importAssembly(data: ArrayBuffer, options: TessellateOptions): Uint8Array {
    if (!kernel) throw new Error("OcctKernel is not initialized.");
    const bytes = exportSTEPAssembly(kernel, data, options);
    return Comlink.transfer(bytes, [bytes.buffer as ArrayBuffer]);
  },
};

Comlink.expose(api);
