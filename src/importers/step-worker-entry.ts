import * as Comlink from "comlink";
import { OcctKernel } from "occt-wasm";
import type { InitOptions } from "occt-wasm";

let kernel: OcctKernel | undefined;

const api = {
  async init(options?: InitOptions): Promise<void> {
    kernel?.releaseAll();
    kernel = await OcctKernel.init(options);
  },
  get kernel(): OcctKernel {
    if (!kernel) {
      throw new Error("OcctKernel is not initialized.");
    }
    return Comlink.proxy(kernel);
  },
};

Comlink.expose(api);
