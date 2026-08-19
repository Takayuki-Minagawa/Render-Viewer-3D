import * as THREE from "three";

export interface CameraFitResult {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly near: number;
  readonly far: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

const MIN_RADIUS = 1e-4;
const MIN_NEAR = 1e-4;

export function calculateCameraFit(
  bounds: THREE.Box3,
  verticalFovDegrees: number,
  aspect: number,
  viewDirection: THREE.Vector3,
  padding = 1.2,
): CameraFitResult {
  if (bounds.isEmpty()) {
    throw new Error("Cannot fit the camera to empty bounds.");
  }

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  if (![...center.toArray(), ...size.toArray()].every(Number.isFinite)) {
    throw new Error("Cannot fit the camera to non-finite bounds.");
  }

  const rawRadius = size.length() * 0.5;
  const radius = Math.max(rawRadius, MIN_RADIUS);
  const safePadding = Number.isFinite(padding)
    ? THREE.MathUtils.clamp(padding, 1, 4)
    : 1.2;
  const verticalHalfFov = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(verticalFovDegrees, 1, 179) * 0.5,
  );
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * safeAspect);
  const limitingHalfFov = Math.max(
    THREE.MathUtils.degToRad(0.5),
    Math.min(verticalHalfFov, horizontalHalfFov),
  );
  const distance = (radius * safePadding) / Math.sin(limitingHalfFov);

  const direction = viewDirection.clone();
  if (
    !direction.toArray().every(Number.isFinite) ||
    direction.lengthSq() < Number.EPSILON
  ) {
    direction.set(1, 0.75, 1);
  }
  direction.normalize();

  const position = center.clone().addScaledVector(direction, distance);
  const near = Math.max(MIN_NEAR, distance - radius * safePadding * 1.75);
  const far = Math.max(
    near * 100,
    distance + radius * safePadding * 4,
    near + 1,
  );

  return {
    position,
    target: center,
    near,
    far,
    minDistance: Math.max(MIN_NEAR, radius * 0.01),
    maxDistance: Math.max(45, distance * 20, radius * 50),
  };
}
