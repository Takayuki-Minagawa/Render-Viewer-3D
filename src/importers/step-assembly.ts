import type { OcctKernel, TessellateOptions } from "occt-wasm";

export const STEP_ASSEMBLY_MAX_BYTES = 128 * 1024 * 1024;
export const STEP_ASSEMBLY_MAX_VERTICES = 2_000_000;
export const STEP_ASSEMBLY_MAX_TRIANGLES = 2_000_000;
export const STEP_ASSEMBLY_MAX_NODES = 10_000;
export const STEP_ASSEMBLY_MAX_DEPTH = 128;

interface AssemblyNode { children?: number[]; mesh?: number; }
interface AssemblyPrimitive { attributes: { POSITION?: number }; indices?: number; mode?: number; }
interface AssemblyDocument {
  nodes: AssemblyNode[];
  meshes: { primitives: AssemblyPrimitive[] }[];
  accessors: { count: number; type: string; componentType: number; }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  buffers: { byteLength: number; uri?: string }[];
  images?: unknown[];
  extensionsRequired?: string[];
}

/** Validate the kernel's embedded GLB before transferring or allocating Three resources.
 * Counts include every placed instance, so repeated parts cannot evade the limit.
 * This bounds exported output, not OCCT's transient memory while parsing/meshing.
 */
export function inspectSTEPAssemblyGLB(bytes: Uint8Array): void {
  if (bytes.byteLength < 28 || bytes.byteLength > STEP_ASSEMBLY_MAX_BYTES) throw new Error("STEP assembly GLB exceeds the output byte safety budget or is empty.");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = header.getUint32(12, true);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4e4f534a || jsonLength > 16 * 1024 * 1024 || jsonLength + 28 > bytes.byteLength) throw new Error("Invalid STEP assembly GLB header.");
  const binOffset = jsonLength + 20;
  const binLength = header.getUint32(binOffset, true);
  if (header.getUint32(binOffset + 4, true) !== 0x004e4942 || binOffset + 8 + binLength !== bytes.byteLength) throw new Error("Invalid STEP assembly GLB binary chunk.");
  const source = JSON.parse(new TextDecoder().decode(bytes.subarray(20, binOffset))) as AssemblyDocument;
  if (!Array.isArray(source.nodes) || !Array.isArray(source.meshes) || !Array.isArray(source.accessors) || !Array.isArray(source.scenes) || !Array.isArray(source.buffers) || source.buffers.length !== 1 || source.buffers[0].uri !== undefined || source.images?.length || source.extensionsRequired?.length) throw new Error("Unsupported STEP assembly GLB resources.");
  if (!Number.isSafeInteger(source.buffers[0].byteLength) || source.buffers[0].byteLength < 0 || source.buffers[0].byteLength > binLength || binLength - source.buffers[0].byteLength > 3) throw new Error("Invalid STEP assembly buffer size.");
  if (source.nodes.length > STEP_ASSEMBLY_MAX_NODES) throw new Error("STEP assembly exceeds the node safety budget.");
  let nodes = 0, vertices = 0, triangles = 0, renderables = 0;
  const ancestors = new Set<number>();
  const integer = (value: number | undefined, limit: number): value is number => Number.isSafeInteger(value) && value! >= 0 && value! < limit;
  const count = (index: number | undefined): number => {
    if (!integer(index, source.accessors.length)) throw new Error("Invalid STEP assembly accessor reference.");
    const value = source.accessors[index].count;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid STEP assembly accessor count.");
    return value;
  };
  const visit = (index: number, depth: number): void => {
    if (!integer(index, source.nodes.length) || ancestors.has(index)) throw new Error("Invalid STEP assembly node hierarchy.");
    if (++nodes > STEP_ASSEMBLY_MAX_NODES || depth > STEP_ASSEMBLY_MAX_DEPTH) throw new Error("STEP assembly exceeds the hierarchy safety budget.");
    ancestors.add(index);
    const node = source.nodes[index];
    if (node.mesh !== undefined) {
      if (!integer(node.mesh, source.meshes.length)) throw new Error("Invalid STEP assembly mesh reference.");
      const primitives = source.meshes[node.mesh].primitives;
      if (!Array.isArray(primitives)) throw new Error("Invalid STEP assembly primitives.");
      for (const primitive of primitives) {
        if ((primitive.mode ?? 4) !== 4) throw new Error("Unsupported STEP assembly primitive mode.");
        const positionCount = count(primitive.attributes?.POSITION);
        const indexCount = primitive.indices === undefined ? positionCount : count(primitive.indices);
        if (indexCount % 3 !== 0) throw new Error("Invalid STEP assembly triangle count.");
        vertices += positionCount;
        triangles += indexCount / 3;
        if (++renderables > STEP_ASSEMBLY_MAX_NODES || vertices > STEP_ASSEMBLY_MAX_VERTICES || triangles > STEP_ASSEMBLY_MAX_TRIANGLES) throw new Error("STEP assembly exceeds the total geometry safety budget.");
      }
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error("Invalid STEP assembly children.");
    for (const child of node.children ?? []) visit(child, depth + 1);
    ancestors.delete(index);
  };
  if (source.scenes.length !== 1 || (source.scene ?? 0) !== 0 || !Array.isArray(source.scenes[0]?.nodes)) throw new Error("Unsupported STEP assembly scene.");
  for (const node of source.scenes[0].nodes) visit(node, 0);
  if (triangles === 0) throw new Error("STEP assembly contains no triangle geometry.");
}

/** occt-wasm 4.3.1's native exporter resolves XCAF prototype references and
 * placements that its public label API cannot access. Its GLB positions are
 * meters, with the source axes retained (covered by asymmetric fixtures).
 */
export function exportSTEPAssembly(kernel: OcctKernel, data: ArrayBuffer, quality: TessellateOptions): Uint8Array {
  const document = kernel.importXCAFFromSTEP(new TextDecoder().decode(data));
  try {
    const bytes = document.exportGLTF({ linearDeflection: quality.linearDeflection, angularDeflection: quality.angularDeflection });
    inspectSTEPAssemblyGLB(bytes);
    return bytes;
  } finally {
    document.close();
  }
}
