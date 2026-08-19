import type { MaterialDefinitionModel } from "./material/material-model";

export type { MaterialDefinitionModel } from "./material/material-model";

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

export interface BoxGeometryModel {
  type: "box";
  width: number;
  height: number;
  depth: number;
}

export interface SphereGeometryModel {
  type: "sphere";
  radius: number;
  widthSegments: number;
  heightSegments: number;
}

export interface CylinderGeometryModel {
  type: "cylinder";
  radiusTop: number;
  radiusBottom: number;
  height: number;
  radialSegments: number;
}

export interface ConeGeometryModel {
  type: "cone";
  radius: number;
  height: number;
  radialSegments: number;
}

export interface PlaneGeometryModel {
  type: "plane";
  width: number;
  height: number;
}

export interface TorusGeometryModel {
  type: "torus";
  radius: number;
  tubeRadius: number;
  radialSegments: number;
  tubularSegments: number;
}

export type GeometryModel =
  | BoxGeometryModel
  | SphereGeometryModel
  | CylinderGeometryModel
  | ConeGeometryModel
  | PlaneGeometryModel
  | TorusGeometryModel;

export type GeometryType = GeometryModel["type"];

export interface SceneObjectModel {
  id: string;
  name: string;
  visible: boolean;
  transform: TransformModel;
  geometry: GeometryModel;
  materialId: string;
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
  schemaVersion: 2;
  name: string;
  backgroundColor: string;
  shadowsEnabled: boolean;
  helpers: {
    gridVisible: boolean;
    axesVisible: boolean;
  };
  camera: CameraModel;
  materials: MaterialDefinitionModel[];
  objects: SceneObjectModel[];
  lights: LightModel[];
}

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type SceneSnapshot = DeepReadonly<SceneModel>;
