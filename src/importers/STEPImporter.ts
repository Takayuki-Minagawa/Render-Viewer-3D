import * as THREE from "three";
import type {
  Mesh as OcctMesh,
  ShapeHandle,
  TessellateOptions,
  InitOptions,
} from "occt-wasm";
import { BaseImporter } from "./BaseImporter";
import { abortable } from "./abort";
import { disposeLoadedObject } from "./loader-resource-wait";
import { assertRenderableGeometryBudget, MAIN_THREAD_GEOMETRY_BUDGET } from "./geometry-budget";
import { inspectSTEPAssemblyGLB, STEP_ASSEMBLY_MAX_DEPTH, STEP_ASSEMBLY_MAX_NODES, STEP_ASSEMBLY_MAX_TRIANGLES } from "./step-assembly";
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
  importAssembly(data: ArrayBuffer, options: TessellateOptions): Promise<Uint8Array>;
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
    import("comlink"),
    import("occt-wasm/dist/occt-wasm.wasm?url"),
  ]).then(async ([Comlink, wasmModule]) => {
    if (terminated) {
      throw new DOMException("The STEP worker was terminated.", "AbortError");
    }
    const client = Comlink.wrap<STEPWorkerClient & { init(options: InitOptions): Promise<void> }>(nativeWorker);
    await client.init({ wasm: wasmModule.default });
    return {
      importStep: (data: string | ArrayBuffer) => client.importStep(data),
      tessellate: (shape: ShapeHandle, options?: TessellateOptions) =>
        client.tessellate(shape, options),
      release: (shape: ShapeHandle) => client.release(shape),
      importAssembly: (data: ArrayBuffer, options: TessellateOptions) => client.importAssembly(data, options),
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
      if (options.stepStructure !== "flat") {
        const bytes = await abortable(activeWorker.importAssembly(data, stepTessellationOptions(options.quality)), options.signal, terminateWorker);
        this.assertNotAborted(options);
        return await this.importAssembly(primary, bytes, options);
      }
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

  private async importAssembly(primary: File, bytes: Uint8Array, options: ImportOptions): Promise<ImportedModel> {
    inspectSTEPAssemblyGLB(bytes);
    const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/utils/BufferGeometryUtils.js"),
    ]);
    this.assertNotAborted(options);
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(() => { throw new Error("External resources are not allowed in a STEP assembly."); });
    let content: THREE.Group | undefined;
    let abandoned = false;
    try {
      const buffer = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer : bytes.slice().buffer as ArrayBuffer;
      const gltf = await abortable(new GLTFLoader(manager).parseAsync(buffer, "").then((loaded) => {
        if (abandoned) disposeLoadedObject(loaded.scene);
        else content = loaded.scene;
        return loaded;
      }), options.signal);
      this.assertNotAborted(options);
      // The native exporter emits a primitive per CAD face. Join primitives
      // belonging to the same glTF mesh, retaining part nodes and face colors.
      // A complete solid then remains eligible for section caps and selection.
      const parts: THREE.Group[] = [];
      gltf.scene.traverse(node => {
        if (node instanceof THREE.Group && gltf.parser.associations.get(node)?.meshes !== undefined && node.children.length > 1 && node.children.every(child => child instanceof THREE.Mesh && !Array.isArray(child.material))) parts.push(node);
      });
      const discarded = new THREE.Group();
      try {
        for (const part of parts) {
          const meshes = [...part.children] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
          const geometry = mergeGeometries(meshes.map(mesh => mesh.geometry), true);
          if (!geometry) throw new Error("Unable to join STEP part faces.");
          const materials = [...new Set(meshes.map(mesh => mesh.material))];
          for (const group of geometry.groups) group.materialIndex = materials.indexOf(meshes[group.materialIndex!].material);
          if (materials.length === 1) geometry.clearGroups();
          const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
          mesh.name = "STEP mesh";
          for (const child of meshes) discarded.add(child);
          part.add(mesh);
        }
      } finally { disposeLoadedObject(discarded, [gltf.scene]); }
      // Undo only the exporter mm→m unit conversion, then use the same root
      // normalization as the legacy reader, including explicit unit overrides.
      gltf.scene.scale.multiplyScalar(1000);
      gltf.scene.traverse((node) => {
        if (typeof node.userData.name === "string") node.name = node.userData.name;
        if (!node.name) node.name = node instanceof THREE.Mesh ? "STEP mesh" : "STEP part";
        if (node instanceof THREE.Mesh) {
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.metalness = 0;
              material.roughness = 0.6;
              if (!material.name) material.color.setHex(0xd3d7dc);
            }
          }
        }
      });
      const root = this.createRoot(primary, gltf.scene);
      root.userData.stepStructure = "assembly";
      assertRenderableGeometryBudget(root, "STEP assembly", {
        ...MAIN_THREAD_GEOMETRY_BUDGET,
        maxDepth: STEP_ASSEMBLY_MAX_DEPTH + 4,
        maxSceneNodes: STEP_ASSEMBLY_MAX_NODES,
        maxRenderableObjects: STEP_ASSEMBLY_MAX_NODES,
        maxVertexReferences: STEP_ASSEMBLY_MAX_TRIANGLES * 3,
      });
      return this.finishImport(primary, "STEP", root, options, [], { sourceUnit: "millimeter" });
    } catch (error) {
      abandoned = true;
      if (content) disposeLoadedObject(content);
      throw error;
    }
  }
}
