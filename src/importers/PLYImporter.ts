import * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import { assertRenderableGeometryBudget } from "./geometry-budget";
import { disposeLoadedObject } from "./loader-resource-wait";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
} from "./types";

const DEFAULT_PLY_COLOR = 0xd3d7dc;
const DEFAULT_POINT_SIZE = 0.01;
export const MAX_PLY_HEADER_BYTES = 64 * 1024;
export const MAX_PLY_ELEMENT_COUNT = 2_000_000;
const MAX_PLY_ZERO_PROPERTY_ELEMENT_COUNT = 100_000;

interface PLYLoaderLike {
  parse(data: ArrayBuffer): THREE.BufferGeometry;
}

export interface PLYImporterDependencies {
  createLoader?: () => PLYLoaderLike | Promise<PLYLoaderLike>;
}

export class PLYImporter extends BaseImporter {
  readonly id = "ply";
  readonly name = "PLY";
  readonly extensions = ["ply"] as const;
  readonly experimental = false;

  constructor(private readonly dependencies: PLYImporterDependencies = {}) {
    super();
  }

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    this.assertWithinMainThreadBudget([primary]);
    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);
    const hasFaces = inspectPlyHeader(data);

    let geometry: THREE.BufferGeometry | undefined;
    let root: THREE.Group | undefined;
    try {
      const loader = this.dependencies.createLoader
        ? await this.dependencies.createLoader()
        : new (await import("three/addons/loaders/PLYLoader.js")).PLYLoader();
      this.assertNotAborted(options);
      geometry = loader.parse(data);
      this.assertNotAborted(options);

      const hasVertexColors = geometry.getAttribute("color") !== undefined;
      const content = hasFaces
        ? createMesh(primary.name, geometry, hasVertexColors)
        : createPointCloud(primary.name, geometry, hasVertexColors);
      root = this.createRoot(primary, content);
      assertRenderableGeometryBudget(root, "PLY");

      const warnings: ImportWarning[] = hasFaces
        ? []
        : [
            {
              code: "ply-point-cloud-custom-material-unsupported",
              message:
                "PLY point clouds keep their imported Points material when Custom PBR material mode is selected.",
            },
          ];
      return this.finishImport(primary, "PLY", root, options, warnings);
    } catch (error: unknown) {
      if (root) {
        disposeLoadedObject(root);
      } else {
        geometry?.dispose();
      }
      throw error;
    }
  }
}

function createMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  hasVertexColors: boolean,
): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: hasVertexColors ? 0xffffff : DEFAULT_PLY_COLOR,
    metalness: 0,
    roughness: 0.6,
    vertexColors: hasVertexColors,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function createPointCloud(
  name: string,
  geometry: THREE.BufferGeometry,
  hasVertexColors: boolean,
): THREE.Points {
  const material = new THREE.PointsMaterial({
    color: hasVertexColors ? 0xffffff : DEFAULT_PLY_COLOR,
    size: DEFAULT_POINT_SIZE,
    sizeAttenuation: true,
    vertexColors: hasVertexColors,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  return points;
}

function inspectPlyHeader(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  const headerEnd = findHeaderEnd(bytes);
  if (headerEnd < 0) {
    throw new Error(
      `PLY header is missing end_header within the ${MAX_PLY_HEADER_BYTES / 1024} KiB safety limit.`,
    );
  }

  const header = new TextDecoder().decode(bytes.subarray(0, headerEnd));
  const elements: Array<{
    name: string;
    count: number;
    propertyCount: number;
  }> = [];
  let currentElement: (typeof elements)[number] | undefined;
  let totalElementCount = 0;
  for (const rawLine of header.split(/\r\n|\r|\n/u)) {
    const line = rawLine.trim();
    if (/^element\b/iu.test(line)) {
      const declaration = /^element\s+(\S+)\s+(\S+)\s*$/iu.exec(line);
      if (!declaration) {
        throw new Error(
          "PLY element declaration must contain a name and non-negative integer count.",
        );
      }
      const [, name, rawCount] = declaration;
      if (!/^\d+$/u.test(rawCount)) {
        throw new Error(
          `PLY ${name} element declaration must contain a non-negative integer count.`,
        );
      }
      const count = Number(rawCount);
      if (!Number.isSafeInteger(count)) {
        throw new Error(`PLY ${name} element count is not safely representable.`);
      }
      if (count > MAX_PLY_ELEMENT_COUNT) {
        throw new Error(
          `PLY ${name} element count exceeds the ${MAX_PLY_ELEMENT_COUNT} synchronous parse safety limit.`,
        );
      }
      totalElementCount += count;
      if (!Number.isSafeInteger(totalElementCount) || totalElementCount > MAX_PLY_ELEMENT_COUNT) {
        throw new Error(
          `PLY total element count exceeds the ${MAX_PLY_ELEMENT_COUNT} synchronous parse safety limit.`,
        );
      }
      currentElement = { name: name.toLowerCase(), count, propertyCount: 0 };
      elements.push(currentElement);
    } else if (/^property\b/iu.test(line) && currentElement) {
      currentElement.propertyCount += 1;
    }
  }

  for (const element of elements) {
    if (element.propertyCount === 0 && element.count > MAX_PLY_ZERO_PROPERTY_ELEMENT_COUNT) {
      throw new Error(
        `PLY ${element.name} element has no properties and exceeds the ${MAX_PLY_ZERO_PROPERTY_ELEMENT_COUNT} zero-width parse safety limit.`,
      );
    }
  }
  const faceElements = elements.filter(({ name }) => name === "face");
  if (faceElements.length > 1) {
    throw new Error("PLY header contains multiple face element declarations.");
  }
  return (faceElements[0]?.count ?? 0) > 0;
}

function findHeaderEnd(bytes: Uint8Array): number {
  const marker = "end_header";
  const lastOffset = Math.min(
    bytes.length - marker.length,
    MAX_PLY_HEADER_BYTES - marker.length,
  );
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    let matches = true;
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker.charCodeAt(index)) {
        matches = false;
        break;
      }
    }
    const markerEnd = offset + marker.length;
    const startsLine =
      offset === 0 || bytes[offset - 1] === 10 || bytes[offset - 1] === 13;
    const endsLine =
      markerEnd === bytes.length ||
      bytes[markerEnd] === 10 ||
      bytes[markerEnd] === 13;
    if (matches && startsLine && endsLine) return markerEnd;
  }
  return -1;
}
