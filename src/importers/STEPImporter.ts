import * as THREE from "three";
import type {
  Mesh as OcctMesh,
  ShapeHandle,
  TessellateOptions,
} from "occt-wasm";
import { BaseImporter } from "./BaseImporter";
import type {
  ImportedModel,
  ImportOptions,
  TriangulationQuality,
} from "./types";

export interface STEPWorkerClient {
  importStep(data: string | ArrayBuffer): Promise<ShapeHandle>;
  tessellate(
    shape: ShapeHandle,
    options?: TessellateOptions,
  ): Promise<OcctMesh>;
  release(shape: ShapeHandle): Promise<void>;
  terminate(): void;
}

export type STEPWorkerFactory = () => Promise<STEPWorkerClient>;

const QUALITY_OPTIONS: Readonly<
  Record<TriangulationQuality, Readonly<TessellateOptions>>
> = Object.freeze({
  low: Object.freeze({
    linearDeflection: 0.5,
    angularDeflection: 0.8,
    relative: false,
  }),
  medium: Object.freeze({
    linearDeflection: 0.1,
    angularDeflection: 0.5,
    relative: false,
  }),
  high: Object.freeze({
    linearDeflection: 0.03,
    angularDeflection: 0.25,
    relative: false,
  }),
});

export function stepTessellationOptions(
  quality: TriangulationQuality,
): Readonly<TessellateOptions> {
  return QUALITY_OPTIONS[quality];
}

async function spawnSTEPWorker(): Promise<STEPWorkerClient> {
  const [{ OcctWorker }, wasmModule] = await Promise.all([
    import("occt-wasm/worker"),
    import("occt-wasm/dist/occt-wasm.wasm?url"),
  ]);
  return OcctWorker.spawn({ wasm: wasmModule.default });
}

function geometryFromOcctMesh(mesh: OcctMesh): THREE.BufferGeometry {
  if (mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) {
    throw new Error("STEP tessellation produced invalid vertex positions.");
  }
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error("STEP tessellation produced invalid triangle indices.");
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  if (
    mesh.normals.length === mesh.positions.length &&
    mesh.normals.length > 0
  ) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  return geometry;
}

export class STEPImporter extends BaseImporter {
  readonly id = "step";
  readonly name = "STEP / STP";
  readonly extensions = ["step", "stp"] as const;
  readonly experimental = true;

  constructor(private readonly workerFactory: STEPWorkerFactory = spawnSTEPWorker) {
    super();
  }

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);

    const worker = await this.workerFactory();
    let shape: ShapeHandle | undefined;

    try {
      this.assertNotAborted(options);
      shape = await worker.importStep(data);
      this.assertNotAborted(options);

      const meshData = await worker.tessellate(
        shape,
        stepTessellationOptions(options.quality),
      );
      this.assertNotAborted(options);

      const geometry = geometryFromOcctMesh(meshData);
      const material = new THREE.MeshStandardMaterial({
        color: 0xd3d7dc,
        roughness: 0.6,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = primary.name;

      const root = this.createRoot(primary, mesh);
      return this.finishImport(
        primary,
        "STEP",
        root,
        options,
        [
          {
            code: "step-assembly-flattened",
            message:
              "STEP assembly hierarchy, names, colors, and source materials are flattened by the worker tessellation path.",
          },
        ],
        {
          // OpenCascade's STEP reader converts file units to its millimeter system.
          sourceUnit: "millimeter",
        },
      );
    } finally {
      try {
        if (shape !== undefined) {
          await worker.release(shape);
        }
      } finally {
        worker.terminate();
      }
    }
  }
}
