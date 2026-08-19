import type { SceneModel } from "./scene-model";

const DEFAULT_SCENE: SceneModel = {
  schemaVersion: 1,
  name: "Lighting Study 01",
  backgroundColor: "#10141b",
  shadowsEnabled: true,
  helpers: { gridVisible: true, axesVisible: true },
  camera: {
    position: { x: 6.5, y: 5.2, z: 8.2 },
    target: { x: 0, y: 0.9, z: 0 },
    fov: 45,
    near: 0.1,
    far: 200,
  },
  objects: [
    {
      id: "box-01",
      name: "Box 01",
      visible: true,
      transform: {
        position: { x: 0, y: 1, z: 0 },
        rotationDegrees: { x: 0, y: -18, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { type: "box", width: 2, height: 2, depth: 2 },
      material: { color: "#5f8cff", metalness: 0.08, roughness: 0.32 },
      castShadow: true,
      receiveShadow: true,
    },
    {
      id: "ground-01",
      name: "Ground Plane",
      visible: true,
      transform: {
        position: { x: 0, y: -0.02, z: 0 },
        rotationDegrees: { x: -90, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      geometry: { type: "plane", width: 24, height: 24 },
      material: { color: "#242a33", metalness: 0, roughness: 0.92 },
      castShadow: false,
      receiveShadow: true,
    },
  ],
  lights: [
    {
      id: "ambient-01",
      type: "ambient",
      name: "Ambient Light",
      color: "#c2d2ff",
      intensity: 0.65,
      enabled: true,
    },
    {
      id: "directional-01",
      type: "directional",
      name: "Key Light",
      color: "#fff4e4",
      intensity: 3.2,
      enabled: true,
      position: { x: 5, y: 8, z: 4 },
      target: { x: 0, y: 0.6, z: 0 },
      castShadow: true,
    },
  ],
};

export function createDefaultSceneModel(): SceneModel {
  return structuredClone(DEFAULT_SCENE);
}
