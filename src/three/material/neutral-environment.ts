import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export interface NeutralEnvironment {
  readonly texture: THREE.Texture;
  dispose(): void;
}

export function createNeutralEnvironment(
  renderer: THREE.WebGLRenderer,
): NeutralEnvironment {
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let renderTarget: THREE.WebGLRenderTarget;

  try {
    renderTarget = generator.fromScene(room, 0.04);
  } finally {
    room.dispose();
    generator.dispose();
  }

  let disposed = false;
  return {
    texture: renderTarget.texture,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderTarget.dispose();
    },
  };
}
