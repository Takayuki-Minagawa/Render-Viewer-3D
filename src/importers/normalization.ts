import * as THREE from "three";
import type {
  ImportOptions,
  ImportWarning,
  ModelMetadata,
  ResolvedImportCoordinateSystem,
  ResolvedImportUnit,
} from "./types";

const METERS_PER_UNIT: Readonly<Record<ResolvedImportUnit, number>> = {
  millimeter: 0.001,
  centimeter: 0.01,
  meter: 1,
  inch: 0.0254,
  foot: 0.3048,
};

export interface NormalizationContext {
  sourceUnit?: ResolvedImportUnit;
  sourceMetersPerUnit?: number;
  sourceUnitLabel?: string;
  sourceCoordinateSystem?: ResolvedImportCoordinateSystem;
}

export interface ModelStatistics {
  objectCount: number;
  triangleCount: number;
  materialCount: number;
}

function addWarningOnce(
  warnings: ImportWarning[],
  warning: ImportWarning,
): void {
  if (!warnings.some(({ code }) => code === warning.code)) {
    warnings.push(warning);
  }
}

function hasNonFinitePosition(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): boolean {
  for (let index = 0; index < position.count; index += 1) {
    if (
      !Number.isFinite(position.getX(index)) ||
      !Number.isFinite(position.getY(index)) ||
      !Number.isFinite(position.getZ(index))
    ) {
      return true;
    }
  }
  return false;
}

function prepareRenderableObjects(root: THREE.Object3D): boolean {
  let hasNonFiniteGeometry = false;

  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) &&
      !(object instanceof THREE.Points) &&
      !(object instanceof THREE.Line)
    ) {
      return;
    }

    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }

    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    if (position !== undefined && hasNonFinitePosition(position)) {
      hasNonFiniteGeometry = true;
      geometry.boundingBox = new THREE.Box3().makeEmpty();
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        -1,
      );
      return;
    }
    if (
      object instanceof THREE.Mesh &&
      position !== undefined &&
      geometry.getAttribute("normal") === undefined
    ) {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });

  return hasNonFiniteGeometry;
}

function applyUnitScale(
  root: THREE.Object3D,
  options: ImportOptions,
  context: NormalizationContext,
  warnings: ImportWarning[],
): void {
  let metersPerUnit: number;
  if (options.unit === "auto") {
    if (
      context.sourceMetersPerUnit !== undefined &&
      Number.isFinite(context.sourceMetersPerUnit) &&
      context.sourceMetersPerUnit > 0
    ) {
      metersPerUnit = context.sourceMetersPerUnit;
    } else if (context.sourceUnit) {
      metersPerUnit = METERS_PER_UNIT[context.sourceUnit];
    } else {
      metersPerUnit = METERS_PER_UNIT.meter;
      addWarningOnce(warnings, {
        code: "unit-unavailable",
        message:
          "The source unit could not be detected; source coordinates were treated as meters.",
      });
    }
  } else {
    metersPerUnit = METERS_PER_UNIT[options.unit];
  }

  root.scale.multiplyScalar(metersPerUnit);
}

function applyCoordinateSystem(
  root: THREE.Object3D,
  options: ImportOptions,
  context: NormalizationContext,
  warnings: ImportWarning[],
): void {
  let coordinateSystem: ResolvedImportCoordinateSystem;
  if (options.coordinateSystem === "auto") {
    if (context.sourceCoordinateSystem) {
      coordinateSystem = context.sourceCoordinateSystem;
    } else {
      coordinateSystem = "y-up";
      addWarningOnce(warnings, {
        code: "coordinate-system-unavailable",
        message:
          "The source up axis could not be detected; source coordinates were treated as Y-up.",
      });
    }
  } else {
    coordinateSystem = options.coordinateSystem;
  }

  if (coordinateSystem === "z-up") {
    root.rotateX(-Math.PI / 2);
  }
}

function applyOriginCorrection(
  root: THREE.Object3D,
  options: ImportOptions,
  warnings: ImportWarning[],
): void {
  if (!options.centerModel && !options.placeOnGround) {
    return;
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) {
    addWarningOnce(warnings, {
      code: "empty-model",
      message: "The imported model contains no bounded renderable geometry.",
    });
    return;
  }
  if (
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
  ) {
    addWarningOnce(warnings, {
      code: "non-finite-bounds",
      message: "The imported model has non-finite bounds; origin correction was skipped.",
    });
    return;
  }

  if (options.centerModel) {
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.sub(center);
    root.updateMatrixWorld(true);
  }

  if (options.placeOnGround) {
    const groundedBounds = new THREE.Box3().setFromObject(root);
    root.position.y -= groundedBounds.min.y;
    root.updateMatrixWorld(true);
  }
}

export function normalizeImportedRoot(
  root: THREE.Object3D,
  options: ImportOptions,
  warnings: ImportWarning[] = [],
  context: NormalizationContext = {},
): ImportWarning[] {
  const hasNonFiniteGeometry = prepareRenderableObjects(root);
  applyUnitScale(root, options, context, warnings);
  applyCoordinateSystem(root, options, context, warnings);
  if (hasNonFiniteGeometry) {
    addWarningOnce(warnings, {
      code: "non-finite-bounds",
      message:
        "The imported model has non-finite vertex positions; origin correction was skipped.",
    });
  } else {
    applyOriginCorrection(root, options, warnings);
  }
  root.updateMatrixWorld(true);
  return warnings;
}

export function collectModelStatistics(
  root: THREE.Object3D,
): ModelStatistics {
  let objectCount = 0;
  let triangleCount = 0;
  const materials = new Set<THREE.Material>();

  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) &&
      !(object instanceof THREE.Points) &&
      !(object instanceof THREE.Line)
    ) {
      return;
    }

    objectCount += 1;
    const geometry = object.geometry;
    if (object instanceof THREE.Mesh) {
      const index = geometry.getIndex();
      const position = geometry.getAttribute("position");
      triangleCount += Math.floor(
        (index?.count ?? position?.count ?? 0) / 3,
      );
    }

    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
    }
  });

  return {
    objectCount,
    triangleCount,
    materialCount: materials.size,
  };
}

export function createModelMetadata(
  fileName: string,
  format: string,
  root: THREE.Object3D,
  sourceUnit?: string,
): ModelMetadata {
  return {
    fileName,
    format,
    ...collectModelStatistics(root),
    unit: "meter",
    sourceUnit,
  };
}
