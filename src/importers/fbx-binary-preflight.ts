const FBX_BINARY_MAGIC = new TextEncoder().encode(
  "Kaydara FBX Binary  \0\u001a\0",
);
const FBX_VERSION_OFFSET = FBX_BINARY_MAGIC.byteLength;
const FBX_CONTENT_OFFSET = FBX_VERSION_OFFSET + 4;
const LEGACY_NODE_HEADER_BYTES = 13;
const MODERN_NODE_HEADER_BYTES = 25;

export interface FBXBinaryPreflightLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxPropertiesPerNode: number;
  readonly maxTotalProperties: number;
  readonly maxArrayCompressedBytes: number;
  readonly maxArrayExpandedBytes: number;
  readonly maxTotalArrayExpandedBytes: number;
  readonly maxCompressionRatio: number;
}

export const FBX_BINARY_PREFLIGHT_LIMITS: Readonly<FBXBinaryPreflightLimits> =
  Object.freeze({
    maxNodes: 50_000,
    maxDepth: 256,
    maxPropertiesPerNode: 100_000,
    maxTotalProperties: 1_000_000,
    maxArrayCompressedBytes: 32 * 1024 * 1024,
    maxArrayExpandedBytes: 64 * 1024 * 1024,
    maxTotalArrayExpandedBytes: 128 * 1024 * 1024,
    maxCompressionRatio: 200,
  });

interface ParseFrame {
  readonly endOffset: number;
  readonly nextDepth: number;
  readonly topLevel: boolean;
}

interface CompressedArrayPayload {
  readonly offset: number;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
}

class CompressedArrayValidationError extends Error {}

interface PreflightState {
  nodeCount: number;
  propertyCount: number;
  totalArrayExpandedBytes: number;
  readonly compressedArrays: CompressedArrayPayload[];
}

/**
 * Validates the framing and property declarations that FBXLoader trusts before
 * it inflates binary array properties. Returns false for an ASCII FBX source.
 */
export async function preflightBinaryFBX(
  source: ArrayBuffer,
  limits: FBXBinaryPreflightLimits = FBX_BINARY_PREFLIGHT_LIMITS,
): Promise<boolean> {
  validateLimits(limits);
  const bytes = new Uint8Array(source);
  if (!hasBinaryMagic(bytes)) return false;
  if (bytes.byteLength < FBX_CONTENT_OFFSET) {
    throw new Error("The binary FBX header is truncated.");
  }

  const view = new DataView(source);
  const version = view.getUint32(FBX_VERSION_OFFSET, true);
  if (version < 6400) {
    throw new Error(`Unsupported binary FBX version: ${version}.`);
  }

  const nodeHeaderBytes =
    version >= 7500 ? MODERN_NODE_HEADER_BYTES : LEGACY_NODE_HEADER_BYTES;
  const state: PreflightState = {
    nodeCount: 0,
    propertyCount: 0,
    totalArrayExpandedBytes: 0,
    compressedArrays: [],
  };
  const frames: ParseFrame[] = [
    {
      endOffset: bytes.byteLength,
      nextDepth: 1,
      topLevel: true,
    },
  ];
  let offset = FBX_CONTENT_OFFSET;

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (
      frame.topLevel &&
      hasReachedLoaderFooter(offset, bytes.byteLength)
    ) {
      await validateCompressedArrays(
        bytes,
        state.compressedArrays,
        limits,
      );
      return true;
    }
    if (offset >= frame.endOffset) {
      throw new Error(
        frame.topLevel
          ? "The binary FBX top-level node stream is out of bounds."
          : "A binary FBX child-node list has no terminating null record.",
      );
    }
    assertSpan(offset, nodeHeaderBytes, frame.endOffset, "node header");

    const recordOffset = offset;
    const endOffset =
      version >= 7500
        ? readSafeUint64(view, offset, "node end offset")
        : view.getUint32(offset, true);
    const propertyCount =
      version >= 7500
        ? readSafeUint64(view, offset + 8, "node property count")
        : view.getUint32(offset + 4, true);
    const propertyListBytes =
      version >= 7500
        ? readSafeUint64(view, offset + 16, "property-list length")
        : view.getUint32(offset + 8, true);
    const nameLength = view.getUint8(offset + nodeHeaderBytes - 1);
    offset += nodeHeaderBytes;

    if (endOffset === 0) {
      if (
        propertyCount !== 0 ||
        propertyListBytes !== 0 ||
        nameLength !== 0
      ) {
        throw new Error("A binary FBX null record contains non-zero fields.");
      }
      if (!frame.topLevel && offset !== frame.endOffset) {
        throw new Error(
          "A binary FBX null record does not end its parent node.",
        );
      }
      if (frame.topLevel) continue;
      frames.pop();
      continue;
    }

    state.nodeCount = checkedAdd(state.nodeCount, 1, "node count");
    if (state.nodeCount > limits.maxNodes) {
      throw new Error(
        `The binary FBX contains more than ${limits.maxNodes} nodes; the safety limit was exceeded.`,
      );
    }
    if (frame.nextDepth > limits.maxDepth) {
      throw new Error(
        `The binary FBX node depth exceeds the safety limit of ${limits.maxDepth}.`,
      );
    }
    if (propertyCount > limits.maxPropertiesPerNode) {
      throw new Error(
        `A binary FBX node declares ${propertyCount} properties; the per-node safety limit is ${limits.maxPropertiesPerNode}.`,
      );
    }
    if (propertyCount > propertyListBytes) {
      throw new Error(
        "A binary FBX property count cannot fit in its declared property list.",
      );
    }
    state.propertyCount = checkedAdd(
      state.propertyCount,
      propertyCount,
      "property count",
    );
    if (state.propertyCount > limits.maxTotalProperties) {
      throw new Error(
        `The binary FBX contains more than ${limits.maxTotalProperties} properties; the safety limit was exceeded.`,
      );
    }

    if (endOffset <= recordOffset || endOffset > frame.endOffset) {
      throw new Error("A binary FBX node end offset is out of bounds.");
    }
    assertSpan(offset, nameLength, endOffset, "node name");
    offset += nameLength;
    assertSpan(offset, propertyListBytes, endOffset, "property list");
    const propertyEnd = offset + propertyListBytes;
    offset = inspectProperties(
      bytes,
      view,
      offset,
      propertyEnd,
      propertyCount,
      state,
      limits,
    );
    if (offset !== propertyEnd) {
      throw new Error(
        "A binary FBX property-list length is inconsistent with its properties.",
      );
    }

    if (offset < endOffset) {
      frames.push({
        endOffset,
        nextDepth: frame.nextDepth + 1,
        topLevel: false,
      });
    }
  }

  throw new Error("The binary FBX node stream is malformed.");
}

function inspectProperties(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  propertyCount: number,
  state: PreflightState,
  limits: FBXBinaryPreflightLimits,
): number {
  let offset = start;
  for (let index = 0; index < propertyCount; index += 1) {
    assertSpan(offset, 1, end, "property type");
    const type = String.fromCharCode(bytes[offset]);
    offset += 1;

    switch (type) {
      case "Y":
        offset = advance(offset, 2, end, "16-bit property");
        break;
      case "C":
        offset = advance(offset, 1, end, "Boolean property");
        break;
      case "F":
      case "I":
        offset = advance(offset, 4, end, "32-bit property");
        break;
      case "D":
      case "L":
        offset = advance(offset, 8, end, "64-bit property");
        break;
      case "R":
      case "S": {
        assertSpan(offset, 4, end, "length-prefixed property");
        const length = view.getUint32(offset, true);
        offset = advance(offset + 4, length, end, "length-prefixed property");
        break;
      }
      case "b":
      case "c":
      case "d":
      case "f":
      case "i":
      case "l":
        offset = inspectArrayProperty(
          type,
          view,
          offset,
          end,
          state,
          limits,
        );
        break;
      default:
        throw new Error(`Unsupported binary FBX property type: ${type}.`);
    }
  }
  return offset;
}

function inspectArrayProperty(
  type: string,
  view: DataView,
  start: number,
  end: number,
  state: PreflightState,
  limits: FBXBinaryPreflightLimits,
): number {
  assertSpan(start, 12, end, "array property header");
  const elementCount = view.getUint32(start, true);
  const encoding = view.getUint32(start + 4, true);
  const compressedBytes = view.getUint32(start + 8, true);
  const elementBytes = type === "b" || type === "c" ? 1 :
    type === "d" || type === "l" ? 8 : 4;
  const expandedBytes = checkedMultiply(
    elementCount,
    elementBytes,
    "array expanded size",
  );

  if (encoding !== 0 && encoding !== 1) {
    throw new Error(`Unsupported binary FBX array encoding: ${encoding}.`);
  }
  if (compressedBytes > limits.maxArrayCompressedBytes) {
    throw new Error(
      `A binary FBX array declares ${compressedBytes} compressed bytes; the compressed-payload safety limit is ${limits.maxArrayCompressedBytes}.`,
    );
  }
  if (expandedBytes > limits.maxArrayExpandedBytes) {
    throw new Error(
      `A binary FBX array expands to ${expandedBytes} bytes; the per-array safety limit is ${limits.maxArrayExpandedBytes}.`,
    );
  }
  state.totalArrayExpandedBytes = checkedAdd(
    state.totalArrayExpandedBytes,
    expandedBytes,
    "array expanded size",
  );
  if (
    state.totalArrayExpandedBytes > limits.maxTotalArrayExpandedBytes
  ) {
    throw new Error(
      `The binary FBX arrays expand to ${state.totalArrayExpandedBytes} bytes; the total safety limit is ${limits.maxTotalArrayExpandedBytes}.`,
    );
  }

  if (encoding === 0 && compressedBytes !== expandedBytes) {
    throw new Error(
      "An uncompressed binary FBX array has inconsistent declared lengths.",
    );
  }
  const ratio =
    compressedBytes === 0
      ? expandedBytes === 0
        ? 1
        : Number.POSITIVE_INFINITY
      : expandedBytes / compressedBytes;
  if (ratio > limits.maxCompressionRatio) {
    throw new Error(
      `A binary FBX array exceeds the ${limits.maxCompressionRatio}:1 compression-ratio safety limit.`,
    );
  }

  const payloadOffset = start + 12;
  const payloadEnd = advance(
    payloadOffset,
    compressedBytes,
    end,
    "array property payload",
  );
  if (encoding === 1) {
    state.compressedArrays.push({
      offset: payloadOffset,
      compressedBytes,
      expandedBytes,
    });
  }
  return payloadEnd;
}

async function validateCompressedArrays(
  source: Uint8Array,
  arrays: readonly CompressedArrayPayload[],
  limits: FBXBinaryPreflightLimits,
): Promise<void> {
  if (arrays.length === 0) return;
  const { Unzlib } = await import(
    "three/addons/libs/fflate.module.js"
  );
  const chunkBytes = 1024;
  let totalExpandedBytes = 0;

  for (const array of arrays) {
    let actualExpandedBytes = 0;
    const stream = new Unzlib((chunk) => {
      actualExpandedBytes = checkedAdd(
        actualExpandedBytes,
        chunk.byteLength,
        "actual array expanded size",
      );
      totalExpandedBytes = checkedAdd(
        totalExpandedBytes,
        chunk.byteLength,
        "actual total array expanded size",
      );
      if (actualExpandedBytes > array.expandedBytes) {
        throw new CompressedArrayValidationError(
          `A compressed binary FBX array's actual expansion exceeds its declared ${array.expandedBytes}-byte size.`,
        );
      }
      if (actualExpandedBytes > limits.maxArrayExpandedBytes) {
        throw new CompressedArrayValidationError(
          `A compressed binary FBX array's actual expansion exceeds the per-array safety limit of ${limits.maxArrayExpandedBytes} bytes.`,
        );
      }
      if (totalExpandedBytes > limits.maxTotalArrayExpandedBytes) {
        throw new CompressedArrayValidationError(
          `The compressed binary FBX arrays' actual expansion exceeds the total safety limit of ${limits.maxTotalArrayExpandedBytes} bytes.`,
        );
      }
      const actualRatio =
        array.compressedBytes === 0
          ? actualExpandedBytes === 0
            ? 1
            : Number.POSITIVE_INFINITY
          : actualExpandedBytes / array.compressedBytes;
      if (actualRatio > limits.maxCompressionRatio) {
        throw new CompressedArrayValidationError(
          `A compressed binary FBX array's actual expansion exceeds the ${limits.maxCompressionRatio}:1 compression-ratio safety limit.`,
        );
      }
    });

    try {
      if (array.compressedBytes === 0) {
        stream.push(new Uint8Array(), true);
      } else {
        const end = array.offset + array.compressedBytes;
        for (let offset = array.offset; offset < end; offset += chunkBytes) {
          const chunkEnd = Math.min(offset + chunkBytes, end);
          stream.push(source.subarray(offset, chunkEnd), chunkEnd === end);
        }
      }
    } catch (error: unknown) {
      if (error instanceof CompressedArrayValidationError) {
        throw error;
      }
      throw new Error(
        "A compressed binary FBX array is not valid zlib data.",
        { cause: error },
      );
    }

    if (actualExpandedBytes !== array.expandedBytes) {
      throw new Error(
        `A compressed binary FBX array expands to ${actualExpandedBytes} bytes but declares ${array.expandedBytes} bytes.`,
      );
    }
  }
}

function hasBinaryMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < FBX_BINARY_MAGIC.byteLength) return false;
  for (let index = 0; index < FBX_BINARY_MAGIC.byteLength; index += 1) {
    if (bytes[index] !== FBX_BINARY_MAGIC[index]) return false;
  }
  return true;
}

function hasReachedLoaderFooter(offset: number, fileSize: number): boolean {
  const footerAndPaddingBytes = 160 + 16;
  if (fileSize % 16 !== 0) {
    return offset + footerAndPaddingBytes >= fileSize;
  }
  const alignedOffset =
    Math.floor((offset + footerAndPaddingBytes) / 16) * 16;
  return alignedOffset >= fileSize;
}

function readSafeUint64(
  view: DataView,
  offset: number,
  label: string,
): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `The binary FBX ${label} is not safely representable.`,
    );
  }
  return Number(value);
}

function advance(
  offset: number,
  length: number,
  end: number,
  label: string,
): number {
  assertSpan(offset, length, end, label);
  return offset + length;
}

function assertSpan(
  offset: number,
  length: number,
  end: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > end ||
    length > end - offset
  ) {
    throw new Error(`The binary FBX ${label} is truncated or out of bounds.`);
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The binary FBX ${label} is not safely representable.`);
  }
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The binary FBX ${label} is not safely representable.`);
  }
  return result;
}

function validateLimits(limits: FBXBinaryPreflightLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Binary FBX preflight limit ${name} must be positive.`);
    }
  }
}
