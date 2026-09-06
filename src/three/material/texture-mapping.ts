import * as THREE from "three";
import type { DeepReadonly } from "../../model/scene-model";
import type { MaterialColorMapModel, MaterialTextureWrapMode } from "../../model/material/material-model";
type ColorMapSnapshot = DeepReadonly<MaterialColorMapModel>;
type MaterialTextureUvOrigin = "bottom-left" | "top-left";

const TOP_LEFT_UV_Y_FLIP_MATRIX = new THREE.Matrix3().set(
  1, 0, 0,
  0, -1, 1,
  0, 0, 1,
);

export function applyTextureMapping(
  texture: THREE.Texture,
  colorMap: ColorMapSnapshot,
  uvOrigin: MaterialTextureUvOrigin,
  notifyWrapChange = true,
): void {
  const wrapping = toThreeWrapping(colorMap.wrapMode);
  const wrapChanged = texture.wrapS !== wrapping || texture.wrapT !== wrapping;
  texture.wrapS = wrapping;
  texture.wrapT = wrapping;
  texture.repeat.set(colorMap.repeatX, colorMap.repeatY);
  texture.offset.set(colorMap.offsetX, colorMap.offsetY);
  texture.center.set(0.5, 0.5);
  texture.rotation = THREE.MathUtils.degToRad(colorMap.rotationDegrees);
  texture.updateMatrix();
  texture.matrixAutoUpdate = uvOrigin === "bottom-left";
  if (uvOrigin === "top-left") {
    texture.matrix.multiply(TOP_LEFT_UV_Y_FLIP_MATRIX);
  }
  if (notifyWrapChange && wrapChanged) texture.needsUpdate = true;
}

function toThreeWrapping(mode: MaterialTextureWrapMode): THREE.Wrapping {
  switch (mode) {
    case "repeat":
      return THREE.RepeatWrapping;
    case "clamp-to-edge":
      return THREE.ClampToEdgeWrapping;
    case "mirrored-repeat":
      return THREE.MirroredRepeatWrapping;
  }
}
