import * as THREE from "three";

export const HDR_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const HDR_MAX_PIXELS = 8 * 1024 * 1024;
/** Preflight before HDRLoader allocation; only local Radiance RGBE is supported. */
export function inspectHdrHeader(bytes: Uint8Array): { width: number; height: number } {
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 65536)));
  if (!/^#\?(RADIANCE|RGBE)\r?\n/.test(header) || !/FORMAT=32-bit_rle_rgbe\r?\n/.test(header)) throw new Error("Expected a Radiance RGBE .hdr file / Radiance RGBE形式のHDRが必要です");
  const dimensions = /(?:^|\n)-Y\s+(\d+)\s+\+X\s+(\d+)\s*(?:\r?\n)/.exec(header);
  if (!dimensions) throw new Error("Unsupported HDR orientation or missing dimensions / HDRの方向・寸法が未対応です");
  const width = Number(dimensions[2]), height = Number(dimensions[1]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > HDR_MAX_PIXELS) throw new Error("HDR limit: 8192 px per side, 8 megapixels / HDR寸法上限を超えています");
  return { width, height };
}
export async function prepareHdrEnvironment(file: File): Promise<THREE.DataTexture> {
  if (file.size <= 0 || file.size > HDR_MAX_FILE_BYTES) throw new Error("HDR file limit: 32 MiB / HDRは32 MiB以下です");
  inspectHdrHeader(new Uint8Array(await file.slice(0, 65536).arrayBuffer()));
  const { HDRLoader } = await import("three/addons/loaders/HDRLoader.js");
  const data = new HDRLoader().setDataType(THREE.HalfFloatType).parse(await file.arrayBuffer());
  const texture = new THREE.DataTexture(data.data, data.width, data.height, THREE.RGBAFormat, data.type);
  texture.colorSpace = THREE.LinearSRGBColorSpace; texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.flipY = true; texture.needsUpdate = true;
  return texture;
}
