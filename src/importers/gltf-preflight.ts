import { MAIN_THREAD_GEOMETRY_BUDGET } from "./geometry-budget";
import { IMPORT_TEXTURE_MAX_DIMENSION, IMPORT_TEXTURE_PIXEL_BUDGET } from "./texture-budget";
import type { LocalResourceResolver } from "./resource-resolver";

/** Inspect declared allocation sizes before compressed payloads reach a decoder. */
export async function inspectGLTFSource(source: string | ArrayBuffer, resolver: LocalResourceResolver): Promise<void> {
  let json: string;
  let binaryChunk: Uint8Array | undefined;
  if (typeof source === "string") {
    json = source;
  } else {
    const bytes = new DataView(source);
    if (source.byteLength < 20 || bytes.getUint32(0, true) !== 0x46546c67 || bytes.getUint32(16, true) !== 0x4e4f534a) {
      throw new Error("Invalid GLB header or JSON chunk.");
    }
    const length = bytes.getUint32(12, true);
    if (length > source.byteLength - 20) throw new Error("GLB JSON chunk exceeds file size.");
    json = new TextDecoder().decode(new Uint8Array(source, 20, length));
    const binaryOffset = 20 + length;
    if (binaryOffset + 8 <= source.byteLength && bytes.getUint32(binaryOffset + 4, true) === 0x004e4942) {
      const binaryLength = bytes.getUint32(binaryOffset, true);
      if (binaryLength > source.byteLength - binaryOffset - 8) throw new Error("GLB binary chunk exceeds file size.");
      binaryChunk = new Uint8Array(source, binaryOffset + 8, binaryLength);
    }
  }
  const document = JSON.parse(json);
  let bufferBytes = 0;
  for (const buffer of document.buffers ?? []) {
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) throw new Error("Invalid glTF buffer allocation size.");
    bufferBytes += buffer.byteLength;
    if (bufferBytes > 128 * 1024 * 1024) throw new Error("glTF declared buffers exceed the 128 MiB safety budget.");
  }
  let expandedBytes = 0;
  for (const view of document.bufferViews ?? []) {
    const meshopt = view.extensions?.EXT_meshopt_compression;
    const bytes = meshopt ? meshopt.count * meshopt.byteStride : view.byteLength;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid glTF buffer allocation size.");
    expandedBytes += bytes;
    if (expandedBytes > 128 * 1024 * 1024) throw new Error("glTF expanded buffers exceed the 128 MiB safety budget.");
  }
  let accessorBytes = 0;
  for (const accessor of document.accessors ?? []) {
    if (!Number.isSafeInteger(accessor.count) || accessor.count < 0 || accessor.count > MAIN_THREAD_GEOMETRY_BUDGET.maxPositionVertices) {
      throw new Error("glTF accessor exceeds the geometry safety budget.");
    }
    const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    const sizes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    // Budget even accessors decoded from Draco, where buffer views only
    // describe the compressed bytes and would underestimate allocation.
    accessorBytes += accessor.count * (components[accessor.type] ?? 16) * (sizes[accessor.componentType] ?? 4);
    if (accessorBytes > 128 * 1024 * 1024) throw new Error("glTF decoded accessors exceed the 128 MiB safety budget.");
  }
  if ((document.nodes?.length ?? 0) > MAIN_THREAD_GEOMETRY_BUDGET.maxSceneNodes) throw new Error("glTF nodes exceed the geometry safety budget.");
  assertNodeGraph(document.nodes ?? [], document.scenes ?? [], document.meshes ?? []);
  // GLTFLoader tolerates some image failures. Reject invalid references before
  // parsing so an external image cannot silently disappear from an import.
  for (const resource of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (typeof resource.uri === "string" && !/^data:/iu.test(resource.uri)) resolver.resolveFile(resource.uri);
  }
  const bufferCache = new Map<number, Uint8Array>();
  const decodeDataURI = (uri: string): Uint8Array => {
    const comma = uri.indexOf(",");
    if (comma < 0) throw new Error("Malformed glTF data URI.");
    const text = /;base64$/iu.test(uri.slice(0, comma)) ? atob(uri.slice(comma + 1)) : decodeURIComponent(uri.slice(comma + 1));
    return Uint8Array.from(text, (character) => character.charCodeAt(0));
  };
  let ktxPixels = 0;
  const basisSources = new Set((document.textures ?? []).map((texture: { extensions?: { KHR_texture_basisu?: { source?: number } } }) => texture.extensions?.KHR_texture_basisu?.source));
  for (const [imageIndex, image] of (document.images ?? []).entries()) {
    if (!basisSources.has(imageIndex) && image.mimeType !== "image/ktx2" && !/\.ktx2(?:[?#]|$)/iu.test(image.uri ?? "") && !/^data:image\/ktx2/iu.test(image.uri ?? "")) continue;
    let bytes: Uint8Array;
    if (typeof image.uri === "string") {
      bytes = /^data:/iu.test(image.uri) ? decodeDataURI(image.uri) : new Uint8Array(await resolver.resolveFile(image.uri).arrayBuffer());
    } else {
      const view = document.bufferViews?.[image.bufferView];
      if (!view) throw new Error("KTX2 image references an absent buffer view.");
      let buffer = bufferCache.get(view.buffer);
      if (!buffer) {
        const uri = document.buffers?.[view.buffer]?.uri;
        buffer = typeof uri === "string" ? (/^data:/iu.test(uri) ? decodeDataURI(uri) : new Uint8Array(await resolver.resolveFile(uri).arrayBuffer())) : binaryChunk;
        if (!buffer) throw new Error("KTX2 image references an absent buffer.");
        bufferCache.set(view.buffer, buffer);
      }
      const offset = view.byteOffset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + view.byteLength > buffer.byteLength) throw new Error("KTX2 image exceeds its buffer.");
      bytes = buffer.subarray(offset, offset + view.byteLength);
    }
    ktxPixels += inspectKTX2Header(bytes);
    if (ktxPixels > IMPORT_TEXTURE_PIXEL_BUDGET) throw new Error("KTX2 decoded textures exceed the image safety budget.");
  }
}

export function inspectKTX2Header(bytes: Uint8Array): number {
  const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 80 || !magic.every((value, index) => bytes[index] === value)) throw new Error("Invalid KTX2 header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(20, true), height = view.getUint32(24, true);
  const depth = Math.max(1, view.getUint32(28, true));
  const layers = Math.max(1, view.getUint32(32, true)), faces = Math.max(1, view.getUint32(36, true));
  const pixels = width * Math.max(1, height) * depth * layers * faces;
  if (width === 0 || width > IMPORT_TEXTURE_MAX_DIMENSION || height > IMPORT_TEXTURE_MAX_DIMENSION || pixels > IMPORT_TEXTURE_PIXEL_BUDGET || !Number.isSafeInteger(pixels)) throw new Error("KTX2 decoded textures exceed the image safety budget.");
  return pixels;
}

interface GLTFPreflightNode { children?: number[]; mesh?: number; }
function assertNodeGraph(nodes: GLTFPreflightNode[], scenes: { nodes?: number[] }[], meshes: { primitives?: unknown[] }[]): void {
  const state = new Uint8Array(nodes.length);
  const depths = new Uint16Array(nodes.length);
  const expanded = new Float64Array(nodes.length);
  const renderables = new Float64Array(nodes.length);
  const budget = MAIN_THREAD_GEOMETRY_BUDGET;
  const assertSize = (count: number, objects: number): void => {
    if (count > budget.maxSceneNodes || objects > budget.maxRenderableObjects) throw new Error("glTF expanded node instances exceed the geometry safety budget.");
  };
  const visit = (id: number, pathDepth = 0): number => {
    if (pathDepth > budget.maxDepth - 2) throw new Error("glTF node depth exceeds the geometry safety budget.");
    if (!Number.isSafeInteger(id) || id < 0 || id >= nodes.length) throw new Error("glTF references an invalid child node.");
    if (state[id] === 1) throw new Error("glTF contains a cyclic node hierarchy.");
    if (state[id] === 2) return depths[id];
    state[id] = 1;
    let depth = 0, count = 1;
    const meshIndex = nodes[id].mesh;
    let objects = meshIndex === undefined ? 0 : (meshes[meshIndex]?.primitives?.length ?? 0);
    // A mesh with multiple primitives adds a Group and one Object3D per primitive.
    if (objects > 1) count += objects;
    assertSize(count, objects);
    for (const child of nodes[id].children ?? []) {
      depth = Math.max(depth, 1 + visit(child, pathDepth + 1));
      if (depth > budget.maxDepth - 2) throw new Error("glTF node depth exceeds the geometry safety budget.");
      count += expanded[child]; objects += renderables[child];
      assertSize(count, objects);
    }
    state[id] = 2; depths[id] = depth; expanded[id] = count; renderables[id] = objects;
    return depth;
  };
  for (let index = 0; index < nodes.length; index += 1) visit(index);
  // GLTFLoader resolves every scene, including scenes the viewer does not show.
  // Count expanded trees rather than only the JSON's compact node table.
  let total = 1, objects = 0;
  for (const scene of scenes) {
    total += 1;
    for (const node of scene.nodes ?? []) {
      visit(node); total += expanded[node]; objects += renderables[node];
      assertSize(total, objects);
    }
    assertSize(total, objects);
  }
}
