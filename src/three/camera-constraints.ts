interface DistanceConstraints {
  minDistance: number;
  maxDistance: number;
}

/** Preserve a restored pose before OrbitControls.update() clamps its radius. */
export function includeCameraDistance(controls: DistanceConstraints, distance: number): void {
  if (!Number.isFinite(distance) || distance <= 0) return;
  // Leave existing Fit/navigation limits alone while the camera is inside them.
  // A restored pose outside those limits also needs room for its first zoom.
  if (distance < controls.minDistance) controls.minDistance = distance / 10;
  if (distance > controls.maxDistance) controls.maxDistance = Math.min(Number.MAX_VALUE, distance * 10);
}
