import type * as THREE from "three";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { LocalResourceResolver } from "./resource-resolver";

/** Decoder assets use their own manager; model URLs still pass the local resolver. */
export function createGLTFDecoders(loader: GLTFLoader, resolver: LocalResourceResolver, renderer: THREE.WebGLRenderer | null): () => void {
  const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG).setWorkerLimit(2);
  loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  let ktx2: KTX2Loader | undefined;
  if (renderer) {
    ktx2 = new KTX2Loader().setWorkerLimit(2);
    ktx2.detectSupport(renderer);
    // The transcoder reads its bundled assets through its private manager. Only
    // texture inputs received from GLTFLoader pass through this wrapper.
    const originalLoad = ktx2.load.bind(ktx2);
    ktx2.load = (url, onLoad, onProgress, onError) => {
      const local = resolver.resolve(url);
      resolver.manager.itemStart(local);
      const fail = (error: unknown): void => {
        resolver.manager.itemError(local);
        resolver.manager.itemEnd(local);
        onError?.(error);
      };
      try {
        return originalLoad(local, (texture) => {
          try { onLoad?.(texture); } finally { resolver.manager.itemEnd(local); }
        }, onProgress, fail);
      } catch (error) { fail(error); throw error; }
    };
    loader.setKTX2Loader(ktx2);
  }
  return () => {
    draco.dispose();
    ktx2?.dispose();
  };
}
