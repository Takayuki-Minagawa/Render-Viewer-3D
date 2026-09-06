import type * as THREE from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { LocalResourceResolver } from "./resource-resolver";

let renderer: THREE.WebGLRenderer | null = null;

/** The application supplies the active renderer for device-specific KTX2 formats. */
export function configureGLTFRenderer(value: THREE.WebGLRenderer | null): void {
  renderer = value;
}

/** Keep decoder JS/WASM off the initial editor path. */
export async function attachGLTFDecoders(loader: GLTFLoader, resolver: LocalResourceResolver): Promise<() => void> {
  const { createGLTFDecoders } = await import("./gltf-decoder-runtime");
  return createGLTFDecoders(loader, resolver, renderer);
}
