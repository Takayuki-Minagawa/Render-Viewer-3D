export interface Vec3Model {
  x: number;
  y: number;
  z: number;
}

export interface TransformModel {
  position: Vec3Model;
  rotationDegrees: Vec3Model;
  scale: Vec3Model;
}

export interface MaterialModel {
  color: string;
  metalness: number;
  roughness: number;
}

export type GeometryModel =
  | { type: "box"; width: number; height: number; depth: number }
  | { type: "plane"; width: number; height: number };

export interface SceneObjectModel {
  id: string;
  name: string;
  visible: boolean;
  transform: TransformModel;
  geometry: GeometryModel;
  material: MaterialModel;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface AmbientLightModel {
  id: string;
  type: "ambient";
  name: string;
  color: string;
  intensity: number;
  enabled: boolean;
}

export interface DirectionalLightModel {
  id: string;
  type: "directional";
  name: string;
  color: string;
  intensity: number;
  enabled: boolean;
  position: Vec3Model;
  target: Vec3Model;
  castShadow: boolean;
}

export type LightModel = AmbientLightModel | DirectionalLightModel;

export interface CameraModel {
  position: Vec3Model;
  target: Vec3Model;
  fov: number;
  near: number;
  far: number;
}

export interface SceneModel {
  schemaVersion: 1;
  name: string;
  backgroundColor: string;
  shadowsEnabled: boolean;
  helpers: {
    gridVisible: boolean;
    axesVisible: boolean;
  };
  camera: CameraModel;
  objects: SceneObjectModel[];
  lights: LightModel[];
}

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type SceneSnapshot = DeepReadonly<SceneModel>;
