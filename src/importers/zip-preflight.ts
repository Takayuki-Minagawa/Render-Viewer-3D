const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const UTF8_FILE_NAME_FLAG = 1 << 11;
const ENCRYPTED_FLAG = 1;
const DANGEROUS_ZIP_ENTRY_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export interface ZipPreflightLimits {
  readonly maxEntries: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
  readonly maxCompressionRatio: number;
}

export interface ZipPreflightResult {
  readonly entryCount: number;
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
  readonly fileNames: readonly string[];
  readonly entries: readonly ZipPreflightEntry[];
}

export interface ZipPreflightEntry {
  readonly fileName: string;
  readonly compressionMethod: 0 | 8;
  readonly payloadOffset: number;
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
}

export interface ZipExpandedSizeResult {
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
}

class ZipExpandedSizeError extends Error {}

interface InflateConsumptionProbe {
  readonly s: {
    readonly f?: number;
    readonly l?: unknown;
    readonly p?: number;
  };
  readonly p: Uint8Array;
}

export function inspectZipCentralDirectory(
  data: ArrayBuffer,
  limits: ZipPreflightLimits,
): ZipPreflightResult {
  validateLimits(limits);
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw new Error("The 3MF archive has no valid ZIP central directory.");
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const directoryDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const directorySize = view.getUint32(eocdOffset + 12, true);
  const directoryOffset = view.getUint32(eocdOffset + 16, true);

  if (
    diskNumber !== 0 ||
    directoryDisk !== 0 ||
    entriesOnDisk !== entryCount
  ) {
    throw new Error("Multi-disk 3MF ZIP archives are not supported.");
  }
  if (
    entriesOnDisk === 0xffff ||
    entryCount === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 3MF archives are not supported.");
  }
  if (entryCount > limits.maxEntries) {
    throw new Error(
      `The 3MF archive contains ${entryCount} entries; the safety limit is ${limits.maxEntries}.`,
    );
  }
  if (
    directoryOffset > eocdOffset ||
    directorySize !== eocdOffset - directoryOffset
  ) {
    throw new Error("The 3MF ZIP central directory is out of bounds or has an inconsistent size.");
  }

  const fileNames: string[] = [];
  const seenCanonicalNames = new Set<string>();
  const localRecordRanges: Array<{ start: number; end: number }> = [];
  let totalCompressedBytes = 0;
  const entries: ZipPreflightEntry[] = [];
  let totalUncompressedBytes = 0;
  let offset = directoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > eocdOffset ||
      view.getUint32(offset, true) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE
    ) {
      throw new Error("The 3MF ZIP central directory is malformed.");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedBytes = view.getUint32(offset + 20, true);
    const uncompressedBytes = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const recordLength =
      46 + fileNameLength + extraLength + entryCommentLength;

    if (offset + recordLength > eocdOffset) {
      throw new Error("A 3MF ZIP entry record is truncated.");
    }
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw new Error("Encrypted 3MF ZIP entries are not supported.");
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(
        `Unsupported 3MF ZIP compression method: ${compressionMethod}.`,
      );
    }
    if (
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      diskStart === 0xffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("ZIP64 3MF entries are not supported.");
    }
    if (compressionMethod === 0 && compressedBytes !== uncompressedBytes) {
      throw new Error(
        "A stored 3MF ZIP entry has inconsistent compressed and uncompressed sizes.",
      );
    }
    if (uncompressedBytes > limits.maxEntryUncompressedBytes) {
      throw new Error(
        `A 3MF archive entry expands to ${uncompressedBytes} bytes; the per-entry safety limit is ${limits.maxEntryUncompressedBytes}.`,
      );
    }

    const ratio =
      compressedBytes === 0
        ? uncompressedBytes === 0
          ? 1
          : Number.POSITIVE_INFINITY
        : uncompressedBytes / compressedBytes;
    if (ratio > limits.maxCompressionRatio) {
      throw new Error(
        `A 3MF archive entry exceeds the ${limits.maxCompressionRatio}:1 compression-ratio safety limit.`,
      );
    }

    totalCompressedBytes = checkedAdd(
      totalCompressedBytes,
      compressedBytes,
      "compressed",
    );
    totalUncompressedBytes = checkedAdd(
      totalUncompressedBytes,
      uncompressedBytes,
      "uncompressed",
    );
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error(
        `The 3MF archive expands to ${totalUncompressedBytes} bytes; the total safety limit is ${limits.maxTotalUncompressedBytes}.`,
      );
    }

    const rawName = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
    const fileName = decodeZipFileName(rawName, flags);
    if (fileName.includes("\\")) {
      throw new Error(
        `The 3MF archive contains an unsafe relative entry path: ${fileName}. Backslash separators are not valid OPC part names.`,
      );
    }
    if (!fileName || fileName.includes("\0")) {
      throw new Error("The 3MF archive contains an invalid entry name.");
    }
    validateEntryName(fileName);
    const localRecord = validateLocalFileRecord(
      bytes,
      view,
      directoryOffset,
      localHeaderOffset,
      flags,
      compressionMethod,
      compressedBytes,
      rawName,
    );
    localRecordRanges.push(localRecord);
    const canonicalName = fileName.normalize("NFC").toLowerCase();
    if (seenCanonicalNames.has(canonicalName)) {
      throw new Error(`The 3MF archive contains a duplicate entry: ${fileName}.`);
    }
    seenCanonicalNames.add(canonicalName);
    fileNames.push(fileName);
    entries.push({
      fileName,
      compressionMethod,
      payloadOffset: localRecord.payloadOffset,
      compressedBytes,
      uncompressedBytes,
    });
    offset += recordLength;
  }

  if (offset !== eocdOffset) {
    throw new Error("The 3MF ZIP central directory size is inconsistent.");
  }
  if (totalCompressedBytes > bytes.byteLength) {
    throw new Error("The 3MF ZIP entry sizes exceed the archive size.");
  }

  localRecordRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRecordRanges.length; index += 1) {
    const previous = localRecordRanges[index - 1];
    const current = localRecordRanges[index];
    if (current.start < previous.end) {
      throw new Error(
        "The 3MF ZIP local file records overlap or are duplicated.",
      );
    }
  }

  return {
    entryCount,
    totalCompressedBytes,
    totalUncompressedBytes,
    fileNames,
    entries,
  };
}

export async function validateZipExpandedSizes(
  data: ArrayBuffer,
  archive: ZipPreflightResult,
  limits: ZipPreflightLimits,
): Promise<ZipExpandedSizeResult> {
  validateLimits(limits);
  const bytes = new Uint8Array(data);
  const { Inflate } = await import("three/addons/libs/fflate.module.js");
  let totalCompressedBytes = 0;
  let totalUncompressedBytes = 0;

  for (const entry of archive.entries) {
    validatePreflightEntryMetadata(entry, bytes.byteLength);
    totalCompressedBytes = checkedAdd(
      totalCompressedBytes,
      entry.compressedBytes,
      "actual compressed",
    );
    const payload = bytes.subarray(
      entry.payloadOffset,
      entry.payloadOffset + entry.compressedBytes,
    );
    let actualBytes = 0;

    if (entry.compressionMethod === 0) {
      actualBytes = payload.byteLength;
      assertActualEntrySize(entry, actualBytes, limits);
      totalUncompressedBytes = addActualOutput(
        totalUncompressedBytes,
        actualBytes,
        limits,
      );
    } else {
      const inflater = new Inflate((chunk: Uint8Array) => {
        actualBytes = checkedAdd(
          actualBytes,
          chunk.byteLength,
          "actual uncompressed",
        );
        assertActualEntrySize(entry, actualBytes, limits, true);
        totalUncompressedBytes = addActualOutput(
          totalUncompressedBytes,
          chunk.byteLength,
          limits,
        );
      });
      let streamComplete = false;
      try {
        if (payload.byteLength === 0) {
          inflater.push(payload, true);
          streamComplete = assertDeflatePayloadConsumed(
            inflater,
            payload.byteLength,
            0,
          );
        } else {
          for (let offset = 0; offset < payload.byteLength; offset += 1024) {
            const end = Math.min(offset + 1024, payload.byteLength);
            inflater.push(
              payload.subarray(offset, end),
              end === payload.byteLength,
            );
            streamComplete = assertDeflatePayloadConsumed(
              inflater,
              payload.byteLength,
              end,
            );
          }
        }
      } catch (error: unknown) {
        if (isExpandedSizeError(error)) throw error;
        throw new Error(
          `The 3MF ZIP entry ${entry.fileName} has an invalid DEFLATE payload.`,
          { cause: error },
        );
      }
      if (!streamComplete) {
        throw new ZipExpandedSizeError(
          `The 3MF ZIP entry ${entry.fileName} does not contain a complete DEFLATE stream.`,
        );
      }
      assertActualEntrySize(entry, actualBytes, limits);
    }
  }

  if (totalCompressedBytes !== archive.totalCompressedBytes) {
    throw new Error("The 3MF ZIP compressed-size metadata is inconsistent.");
  }
  if (totalUncompressedBytes !== archive.totalUncompressedBytes) {
    throw new Error(
      "The 3MF ZIP actual expanded size does not match its declaration.",
    );
  }
  return { totalCompressedBytes, totalUncompressedBytes };
}

function validatePreflightEntryMetadata(
  entry: ZipPreflightEntry,
  archiveBytes: number,
): void {
  for (const value of [
    entry.payloadOffset,
    entry.compressedBytes,
    entry.uncompressedBytes,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        "The 3MF ZIP entry metadata is not safely representable.",
      );
    }
  }
  if (
    (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) ||
    entry.payloadOffset > archiveBytes ||
    entry.compressedBytes > archiveBytes - entry.payloadOffset
  ) {
    throw new Error("The 3MF ZIP entry payload metadata is out of bounds.");
  }
}

function assertActualEntrySize(
  entry: ZipPreflightEntry,
  actualBytes: number,
  limits: ZipPreflightLimits,
  partial = false,
): void {
  if (actualBytes > entry.uncompressedBytes) {
    throw new ZipExpandedSizeError(
      `The 3MF ZIP entry ${entry.fileName} expands beyond its declared uncompressed size.`,
    );
  }
  if (actualBytes > limits.maxEntryUncompressedBytes) {
    throw new ZipExpandedSizeError(
      `The 3MF ZIP entry ${entry.fileName} exceeds the actual per-entry expansion safety limit.`,
    );
  }
  if (partial) return;
  if (actualBytes !== entry.uncompressedBytes) {
    throw new ZipExpandedSizeError(
      `The 3MF ZIP entry ${entry.fileName} actual expanded size does not match its declaration.`,
    );
  }
  const ratio = entry.compressedBytes === 0
    ? actualBytes === 0
      ? 1
      : Number.POSITIVE_INFINITY
    : actualBytes / entry.compressedBytes;
  if (ratio > limits.maxCompressionRatio) {
    throw new ZipExpandedSizeError(
      `The 3MF ZIP entry ${entry.fileName} exceeds the actual ${limits.maxCompressionRatio}:1 compression-ratio safety limit.`,
    );
  }
}

function addActualOutput(
  total: number,
  chunkBytes: number,
  limits: ZipPreflightLimits,
): number {
  const result = checkedAdd(total, chunkBytes, "actual uncompressed");
  if (result > limits.maxTotalUncompressedBytes) {
    throw new ZipExpandedSizeError(
      `The 3MF ZIP actual expanded size exceeds the ${limits.maxTotalUncompressedBytes}-byte total safety limit.`,
    );
  }
  return result;
}

function isExpandedSizeError(error: unknown): error is ZipExpandedSizeError {
  return error instanceof ZipExpandedSizeError;
}

function assertDeflatePayloadConsumed(
  inflater: unknown,
  payloadBytes: number,
  pushedBytes: number,
): boolean {
  const probe = inflater as InflateConsumptionProbe;
  if (probe.s.f !== 1 || probe.s.l) return false;

  // Inflate retains the partially consumed terminal byte when the final block
  // ends off a byte boundary. Any additional retained byte is trailing data.
  const terminalBytes = (probe.s.p ?? 0) === 0 ? 0 : 1;
  if (
    pushedBytes !== payloadBytes ||
    probe.p.byteLength !== terminalBytes
  ) {
    throw new ZipExpandedSizeError(
      "The 3MF ZIP DEFLATE payload contains trailing compressed data.",
    );
  }
  return true;
}

function validateLocalFileRecord(
  bytes: Uint8Array,
  view: DataView,
  directoryOffset: number,
  localHeaderOffset: number,
  flags: number,
  compressionMethod: number,
  compressedBytes: number,
  centralName: Uint8Array,
): { start: number; end: number; payloadOffset: number } {
  if (
    localHeaderOffset > directoryOffset ||
    localHeaderOffset + 30 > directoryOffset ||
    view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw new Error("A 3MF ZIP local file header is missing or out of bounds.");
  }

  const localFlags = view.getUint16(localHeaderOffset + 6, true);
  const localMethod = view.getUint16(localHeaderOffset + 8, true);
  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset =
    localHeaderOffset + 30 + localNameLength + localExtraLength;
  if (
    localFlags !== flags ||
    localMethod !== compressionMethod ||
    dataOffset > directoryOffset ||
    compressedBytes > directoryOffset - dataOffset
  ) {
    throw new Error("A 3MF ZIP local file header is inconsistent or out of bounds.");
  }

  const localName = bytes.subarray(
    localHeaderOffset + 30,
    localHeaderOffset + 30 + localNameLength,
  );
  if (!equalBytes(localName, centralName)) {
    throw new Error(
      "A 3MF ZIP local file name does not match its central-directory entry.",
    );
  }

  return {
    start: localHeaderOffset,
    payloadOffset: dataOffset,
    end: dataOffset + compressedBytes,
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeZipFileName(rawName: Uint8Array, flags: number): string {
  if ((flags & UTF8_FILE_NAME_FLAG) !== 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(rawName);
    } catch (error: unknown) {
      throw new Error("A 3MF ZIP entry name is not valid UTF-8.", {
        cause: error,
      });
    }
  }

  let result = "";
  for (const byte of rawName) result += String.fromCharCode(byte);
  return result;
}

function validateEntryName(fileName: string): void {
  if (fileName.startsWith("/") || /^[a-z]:/iu.test(fileName)) {
    throw new Error(
      `The 3MF archive contains an unsafe absolute entry path: ${fileName}.`,
    );
  }

  const path = fileName.endsWith("/")
    ? fileName.slice(0, -1)
    : fileName;
  const segments = path.split("/");
  if (
    !path ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw new Error(
      `The 3MF archive contains an unsafe relative entry path: ${fileName}.`,
    );
  }
  const dangerous = segments.find((segment) =>
    DANGEROUS_ZIP_ENTRY_SEGMENTS.has(segment.toLowerCase()),
  );
  if (dangerous) {
    throw new Error(
      `The 3MF archive contains a dangerous entry key: ${dangerous}.`,
    );
  }
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(
    0,
    view.byteLength - (MAX_ZIP_COMMENT_BYTES + 22),
  );
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }
    return offset + 22 + view.getUint16(offset + 20, true) ===
      view.byteLength
      ? offset
      : -1;
  }
  return -1;
}

function validateLimits(limits: ZipPreflightLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`ZIP preflight limit ${name} must be positive.`);
    }
  }
}

function checkedAdd(total: number, value: number, label: string): number {
  const result = total + value;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The 3MF ZIP ${label} size is not safely representable.`);
  }
  return result;
}
