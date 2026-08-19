import * as THREE from "three";
import type {
  Mesh as OcctMesh,
  ShapeHandle,
  TessellateOptions,
} from "occt-wasm";
import { BaseImporter } from "./BaseImporter";
import { abortable } from "./abort";
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
}

export interface STEPWorkerHandle {
  readonly ready: Promise<STEPWorkerClient>;
  terminate(): void;
}

export type STEPWorkerFactory = () => STEPWorkerHandle;

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
const MAX_STEP_VERTEX_COUNT = 2_000_000;
const MAX_STEP_TRIANGLE_COUNT = 2_000_000;
export const MAX_STEP_INPUT_BYTES = 128 * 1024 * 1024;

export function stepTessellationOptions(
  quality: TriangulationQuality,
): Readonly<TessellateOptions> {
  return QUALITY_OPTIONS[quality];
}

function spawnSTEPWorker(): STEPWorkerHandle {
  const nativeWorker = new Worker(
    new URL("./step-worker-entry.ts", import.meta.url),
    { type: "module" },
  );
  let terminated = false;
  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    nativeWorker.terminate();
  };
  const ready = Promise.all([
    import("occt-wasm/worker"),
    import("occt-wasm/dist/occt-wasm.wasm?url"),
  ]).then(async ([{ OcctWorker }, wasmModule]) => {
    if (terminated) {
      throw new DOMException("The STEP worker was terminated.", "AbortError");
    }
    const client = await OcctWorker.spawn({
      wasm: wasmModule.default,
      worker: nativeWorker,
    });
    return {
      importStep: (data: string | ArrayBuffer) => client.importStep(data),
      tessellate: (shape: ShapeHandle, options?: TessellateOptions) =>
        client.tessellate(shape, options),
      release: (shape: ShapeHandle) => client.release(shape),
    } satisfies STEPWorkerClient;
  });

  return { ready, terminate };
}

function geometryFromOcctMesh(mesh: OcctMesh): THREE.BufferGeometry {
  if (mesh.positions.length === 0 || mesh.positions.length % 3 !== 0) {
    throw new Error("STEP tessellation produced invalid vertex positions.");
  }
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error("STEP tessellation produced invalid triangle indices.");
  }
  const vertexCount = mesh.positions.length / 3;
  const triangleCount = mesh.indices.length / 3;
  if (
    vertexCount > MAX_STEP_VERTEX_COUNT ||
    triangleCount > MAX_STEP_TRIANGLE_COUNT
  ) {
    throw new Error(
      "STEP tessellation exceeds the main-thread geometry safety budget.",
    );
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
    if (primary.size > MAX_STEP_INPUT_BYTES) {
      const limitMiB = MAX_STEP_INPUT_BYTES / (1024 * 1024);
      throw new Error(
        `STEP / STP import exceeds the ${limitMiB} MiB worker input safety limit. Split or optimize the model before importing it.`,
      );
    }
    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);

    const workerHandle = this.workerFactory();
    let worker: STEPWorkerClient | undefined;
    let workerTerminated = false;
    let shape: ShapeHandle | undefined;
    const terminateWorker = (): void => {
      if (workerTerminated) return;
      workerTerminated = true;
      workerHandle.terminate();
    };

    try {
      worker = await abortable(
        workerHandle.ready,
        options.signal,
        terminateWorker,
      );
      const activeWorker = worker;
      this.assertNotAborted(options);
      shape = await abortable(
        activeWorker.importStep(data),
        options.signal,
        terminateWorker,
      );
      this.assertNotAborted(options);

      const meshData = await abortable(
        activeWorker.tessellate(
          shape,
          stepTessellationOptions(options.quality),
        ),
        options.signal,
        terminateWorker,
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
      if (worker) {
        try {
          if (shape !== undefined && !workerTerminated) {
            await abortable(
              worker.release(shape),
              options.signal,
              terminateWorker,
            );
          }
        } finally {
          terminateWorker();
        }
      } else {
        terminateWorker();
      }
    }
  }
}
