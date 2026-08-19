import * as THREE from "three";
import type { DeepReadonly, GeometryModel } from "../model/scene-model";

export type GeometrySnapshot = DeepReadonly<GeometryModel>;

export function createGeometry(model: GeometrySnapshot): THREE.BufferGeometry {
  switch (model.type) {
    case "box":
      return new THREE.BoxGeometry(model.width, model.height, model.depth);
    case "sphere":
      return new THREE.SphereGeometry(
        model.radius,
        model.widthSegments,
        model.heightSegments,
      );
    case "cylinder":
      return new THREE.CylinderGeometry(
        model.radiusTop,
        model.radiusBottom,
        model.height,
        model.radialSegments,
      );
    case "cone":
      return new THREE.ConeGeometry(
        model.radius,
        model.height,
        model.radialSegments,
      );
    case "plane":
      return new THREE.PlaneGeometry(model.width, model.height);
    case "torus":
      return new THREE.TorusGeometry(
        model.radius,
        model.tubeRadius,
        model.radialSegments,
        model.tubularSegments,
      );
  }
}

export function geometrySignature(model: GeometrySnapshot): string {
  switch (model.type) {
    case "box":
      return `box:${model.width}:${model.height}:${model.depth}`;
    case "sphere":
      return `sphere:${model.radius}:${model.widthSegments}:${model.heightSegments}`;
    case "cylinder":
      return `cylinder:${model.radiusTop}:${model.radiusBottom}:${model.height}:${model.radialSegments}`;
    case "cone":
      return `cone:${model.radius}:${model.height}:${model.radialSegments}`;
    case "plane":
      return `plane:${model.width}:${model.height}`;
    case "torus":
      return `torus:${model.radius}:${model.tubeRadius}:${model.radialSegments}:${model.tubularSegments}`;
  }
}
