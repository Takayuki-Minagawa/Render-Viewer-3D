import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["occt-wasm"],
  },
  base: "/Render-Viewer-3D/",
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
});
