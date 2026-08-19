import * as THREE from "three";
import {
  MATERIAL_TEXTURE_MAX_DIMENSION,
  MATERIAL_TEXTURE_MAX_FILE_BYTES,
  MATERIAL_TEXTURE_MAX_PIXELS,
  createMaterialColorMap,
  type CreateMaterialColorMapInput,
} from "../../model/material/material-color-map";
import type { MaterialColorMapModel } from "../../model/material/material-model";

export const MATERIAL_TEXTURE_MAX_RESIDENT_BYTES = 256 * 1024 * 1024;
const BYTES_PER_PIXEL = 4;
const MIPMAP_FACTOR = 4 / 3;

export type MaterialTextureLoadErrorCode =
  | "empty-file"
  | "file-too-large"
  | "unsupported-format"
  | "mime-mismatch"
  | "invalid-header"
  | "animated-image"
  | "dimensions-too-large"
  | "decode-failed"
  | "decoded-dimensions-invalid"
  | "resident-limit"
  | "decoder-unavailable"
  | "disposed";

export class MaterialTextureLoadError extends Error {
  constructor(
    readonly code: MaterialTextureLoadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MaterialTextureLoadError";
  }
}

export interface DecodedMaterialImage {
  readonly width: number;
  readonly height: number;
  close?: () => void;
}

export type MaterialImageDecoder = (
  file: Blob,
) => Promise<DecodedMaterialImage>;

export interface MaterialImageHeader {
  readonly mimeType: MaterialColorMapModel["mimeType"];
  readonly width: number;
  readonly height: number;
  readonly animated: boolean;
}

interface MaterialImageAssetRecord {
  readonly descriptor: MaterialColorMapModel;
  readonly image: DecodedMaterialImage;
  readonly source: THREE.Source<DecodedMaterialImage>;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  leases: number;
  pendingDelete: boolean;
}

export interface MaterialImageAssetLease {
  readonly assetId: string;
  readonly source: THREE.Source<DecodedMaterialImage>;
}

export class MaterialImageAssetStore {
  readonly #assets = new Map<string, MaterialImageAssetRecord>();
  readonly #decoder: MaterialImageDecoder;
  readonly #maxResidentBytes: number;
  #reservedBytes = 0;
  #residentBytes = 0;
  #nextId = 1;
  #maxTextureSize = MATERIAL_TEXTURE_MAX_DIMENSION;
  #disposed = false;

  constructor(
    decoder: MaterialImageDecoder = decodeWithImageBitmap,
    maxResidentBytes = MATERIAL_TEXTURE_MAX_RESIDENT_BYTES,
  ) {
    if (!Number.isSafeInteger(maxResidentBytes) || maxResidentBytes <= 0) {
      throw new RangeError("Material texture resident limit must be positive.");
    }
    this.#decoder = decoder;
    this.#maxResidentBytes = maxResidentBytes;
  }

  setMaxTextureSize(value: number): void {
    this.#assertActive();
    if (!Number.isFinite(value) || value <= 0) return;
    this.#maxTextureSize = Math.min(
      MATERIAL_TEXTURE_MAX_DIMENSION,
      Math.max(1, Math.floor(value)),
    );
  }

  async importFile(file: File): Promise<MaterialColorMapModel> {
    this.#assertActive();
    let inspectionBytes = 0;
    let image: DecodedMaterialImage | undefined;
    let reservedBytes = 0;
    let committed = false;
    try {
      if (file.size > 0 && file.size <= MATERIAL_TEXTURE_MAX_FILE_BYTES) {
        this.#reserve(file.size);
        inspectionBytes = file.size;
      }
      const header = await inspectMaterialImageFile(file, this.#maxTextureSize);
      this.#releaseReservation(inspectionBytes);
      inspectionBytes = 0;
      this.#assertActive();

      const estimate = estimateResidentBytes(header.width, header.height);
      this.#reserve(estimate.total);
      reservedBytes = estimate.total;
      image = await this.#decode(file);
      this.#assertDecodedDimensions(image);
      if (this.#disposed) {
        throw new MaterialTextureLoadError(
          "disposed",
          "Material image store was disposed during decoding.",
        );
      }

      const assetId = this.#allocateId();
      const input: CreateMaterialColorMapInput = {
        assetId,
        sourceName: file.name,
        mimeType: header.mimeType,
        byteSize: file.size,
        width: image.width,
        height: image.height,
      };
      const descriptor = createMaterialColorMap(input);
      if (!descriptor) {
        throw new MaterialTextureLoadError(
          "decoded-dimensions-invalid",
          "Decoded image metadata is invalid.",
        );
      }
      const actualEstimate = estimateResidentBytes(image.width, image.height);
      if (actualEstimate.total > estimate.total) {
        this.#reserve(actualEstimate.total - estimate.total);
        reservedBytes += actualEstimate.total - estimate.total;
      }
      const result = structuredClone(descriptor);
      const source = new THREE.Source(image);
      this.#releaseReservation(reservedBytes);
      reservedBytes = 0;
      this.#residentBytes += actualEstimate.total;
      this.#assets.set(assetId, {
        descriptor,
        image,
        source,
        cpuBytes: actualEstimate.cpu,
        gpuBytes: actualEstimate.gpu,
        leases: 0,
        pendingDelete: false,
      });
      committed = true;
      return result;
    } catch (error) {
      if (!committed) image?.close?.();
      throw error;
    } finally {
      if (!committed) {
        this.#releaseReservation(inspectionBytes + reservedBytes);
      }
    }
  }

  acquire(assetId: string): MaterialImageAssetLease | undefined {
    this.#assertActive();
    const record = this.#assets.get(assetId);
    if (!record || record.pendingDelete) return undefined;
    const extraGpuBytes = record.leases > 0 ? record.gpuBytes : 0;
    if (
      this.#residentBytes +
        this.#reservedBytes +
        extraGpuBytes >
      this.#maxResidentBytes
    ) {
      return undefined;
    }
    record.leases += 1;
    this.#residentBytes += extraGpuBytes;
    return { assetId, source: record.source };
  }

  release(assetId: string): void {
    const record = this.#assets.get(assetId);
    if (!record || record.leases <= 0) return;
    if (record.leases > 1) this.#residentBytes -= record.gpuBytes;
    record.leases -= 1;
    if (record.leases === 0 && record.pendingDelete) {
      this.#destroy(assetId, record);
    }
  }

  delete(assetId: string): boolean {
    const record = this.#assets.get(assetId);
    if (!record) return false;
    if (record.leases > 0) {
      record.pendingDelete = true;
      return true;
    }
    this.#destroy(assetId, record);
    return true;
  }

  has(assetId: string): boolean {
    return this.#assets.has(assetId);
  }

  ids(): readonly string[] {
    return [...this.#assets.keys()];
  }

  get residentBytes(): number {
    return this.#residentBytes + this.#reservedBytes;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const [assetId, record] of this.#assets) {
      this.#destroy(assetId, record);
    }
    this.#assets.clear();
    this.#reservedBytes = 0;
    this.#residentBytes = 0;
  }

  async #decode(file: File): Promise<DecodedMaterialImage> {
    try {
      return await this.#decoder(file);
    } catch (error) {
      if (error instanceof MaterialTextureLoadError) throw error;
      throw new MaterialTextureLoadError(
        "decode-failed",
        "The selected image could not be decoded.",
        { cause: error },
      );
    }
  }

  #assertDecodedDimensions(image: DecodedMaterialImage): void {
    const { width, height } = image;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new MaterialTextureLoadError(
        "decoded-dimensions-invalid",
        "Decoded image dimensions are invalid.",
      );
    }
    if (
      width > this.#maxTextureSize ||
      height > this.#maxTextureSize ||
      width * height > MATERIAL_TEXTURE_MAX_PIXELS
    ) {
      throw new MaterialTextureLoadError(
        "dimensions-too-large",
        "Decoded image dimensions exceed the configured limit.",
      );
    }
  }

  #reserve(bytes: number): void {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      this.#residentBytes + this.#reservedBytes + bytes >
        this.#maxResidentBytes
    ) {
      throw new MaterialTextureLoadError(
        "resident-limit",
        "Material texture memory limit would be exceeded.",
      );
    }
    this.#reservedBytes += bytes;
  }

  #releaseReservation(bytes: number): void {
    this.#reservedBytes = Math.max(0, this.#reservedBytes - bytes);
  }

  #allocateId(): string {
    for (; this.#nextId < Number.MAX_SAFE_INTEGER; this.#nextId += 1) {
      const id = "material-image-" + String(this.#nextId).padStart(4, "0");
      if (!this.#assets.has(id)) {
        this.#nextId += 1;
        return id;
      }
    }
    throw new Error("Unable to allocate a material image asset id.");
  }

  #destroy(assetId: string, record: MaterialImageAssetRecord): void {
    this.#assets.delete(assetId);
    const extraGpuBytes = Math.max(0, record.leases - 1) * record.gpuBytes;
    this.#residentBytes = Math.max(
      0,
      this.#residentBytes - record.cpuBytes - record.gpuBytes - extraGpuBytes,
    );
    record.leases = 0;
    record.image.close?.();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new MaterialTextureLoadError(
        "disposed",
        "Material image store has already been disposed.",
      );
    }
  }
}

export async function inspectMaterialImageFile(
  file: File,
  maxTextureSize = MATERIAL_TEXTURE_MAX_DIMENSION,
): Promise<MaterialImageHeader> {
  if (file.size === 0) {
    throw new MaterialTextureLoadError("empty-file", "The selected image is empty.");
  }
  if (file.size > MATERIAL_TEXTURE_MAX_FILE_BYTES) {
    throw new MaterialTextureLoadError(
      "file-too-large",
      "The selected image exceeds the file-size limit.",
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = inspectMaterialImageHeader(bytes);
  const declaredMime = file.type.trim().toLowerCase();
  if (declaredMime && declaredMime !== header.mimeType) {
    throw new MaterialTextureLoadError(
      "mime-mismatch",
      "The image MIME type does not match its file signature.",
    );
  }
  if (header.animated) {
    throw new MaterialTextureLoadError(
      "animated-image",
      "Animated images are not supported.",
    );
  }
  const maximum = Math.min(
    MATERIAL_TEXTURE_MAX_DIMENSION,
    Math.max(1, Math.floor(maxTextureSize)),
  );
  if (
    header.width > maximum ||
    header.height > maximum ||
    header.width * header.height > MATERIAL_TEXTURE_MAX_PIXELS
  ) {
    throw new MaterialTextureLoadError(
      "dimensions-too-large",
      "The selected image dimensions exceed the configured limit.",
    );
  }
  return header;
}

export function inspectMaterialImageHeader(
  bytes: Uint8Array,
): MaterialImageHeader {
  const png = inspectPng(bytes);
  if (png) return png;
  const jpeg = inspectJpeg(bytes);
  if (jpeg) return jpeg;
  const webp = inspectWebp(bytes);
  if (webp) return webp;
  throw new MaterialTextureLoadError(
    "unsupported-format",
    "Only PNG, JPEG, and WebP images are supported.",
  );
}

async function decodeWithImageBitmap(
  file: Blob,
): Promise<DecodedMaterialImage> {
  if (typeof createImageBitmap !== "function") {
    throw new MaterialTextureLoadError(
      "decoder-unavailable",
      "This browser does not provide createImageBitmap.",
    );
  }
  return createImageBitmap(file, {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default",
  });
}

function inspectPng(bytes: Uint8Array): MaterialImageHeader | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) return undefined;
  if (
    bytes.length < 33 ||
    readUint32BigEndian(bytes, 8) !== 13 ||
    ascii(bytes, 12, 16) !== "IHDR"
  ) {
    throw invalidHeader();
  }
  const width = readUint32BigEndian(bytes, 16);
  const height = readUint32BigEndian(bytes, 20);
  let animated = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BigEndian(bytes, offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND") break;
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next <= offset || next > bytes.length) break;
    offset = next;
  }
  return checkedHeader("image/png", width, height, animated);
}

function inspectJpeg(bytes: Uint8Array): MaterialImageHeader | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (isJpegStartOfFrame(marker)) {
      if (length < 7) throw invalidHeader();
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return checkedHeader("image/jpeg", width, height, false);
    }
    offset += length;
  }
  throw invalidHeader();
}

function inspectWebp(bytes: Uint8Array): MaterialImageHeader | undefined {
  if (
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 12) !== "WEBP"
  ) {
    return undefined;
  }
  const kind = ascii(bytes, 12, 16);
  if (kind === "VP8X") {
    if (bytes.length < 30) throw invalidHeader();
    const width = 1 + readUint24LittleEndian(bytes, 24);
    const height = 1 + readUint24LittleEndian(bytes, 27);
    return checkedHeader("image/webp", width, height, (bytes[20] & 0x02) !== 0);
  }
  if (kind === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) throw invalidHeader();
    const width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
    const height =
      1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6));
    return checkedHeader("image/webp", width, height, false);
  }
  if (kind === "VP8 ") {
    if (
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      throw invalidHeader();
    }
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return checkedHeader("image/webp", width, height, false);
  }
  throw invalidHeader();
}

function checkedHeader(
  mimeType: MaterialImageHeader["mimeType"],
  width: number,
  height: number,
  animated: boolean,
): MaterialImageHeader {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw invalidHeader();
  }
  return { mimeType, width, height, animated };
}

function invalidHeader(): MaterialTextureLoadError {
  return new MaterialTextureLoadError(
    "invalid-header",
    "The selected image header is invalid or incomplete.",
  );
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw invalidHeader();
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) throw invalidHeader();
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (end > bytes.length) return "";
  let value = "";
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function estimateResidentBytes(
  width: number,
  height: number,
): { readonly cpu: number; readonly gpu: number; readonly total: number } {
  const cpu = width * height * BYTES_PER_PIXEL;
  const gpu = Math.ceil(cpu * MIPMAP_FACTOR);
  return { cpu, gpu, total: cpu + gpu };
}
