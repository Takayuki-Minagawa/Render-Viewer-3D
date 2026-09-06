import process from "node:process";
import { defineConfig } from "vite";

// Unit tests use SSR module loading only; concurrent browser prebundlers would
// contend for the same disk cache after a clean npm ci.
const unitTests = process.env.RV3D_UNIT_TEST === "1";

export default defineConfig({
  optimizeDeps: {
    // STEP reaches Comlink through an excluded WASM package after first import.
    // Prebundle it up front to avoid a dependency-discovery page reload.
    noDiscovery: unitTests,
    include: unitTests ? [] : ["comlink"],
    exclude: ["occt-wasm", "three/addons/loaders/DRACOLoader.js", "three/addons/loaders/KTX2Loader.js"],
  },
  base: "/Render-Viewer-3D/",
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
});
