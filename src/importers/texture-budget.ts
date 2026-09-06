import type * as THREE from "three";

export const IMPORT_TEXTURE_PIXEL_BUDGET = 32 * 1024 * 1024;
export const IMPORT_TEXTURE_MAX_DIMENSION = 16_384;

/** Conservative decoded-pixel budget (independent of compressed source bytes). */
export function assertImportedTextureBudget(root: THREE.Object3D, format: string): void {
  const seen = new Set<THREE.Texture>();
  let pixels = 0;
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (!entry) continue;
      for (const value of Object.values(entry)) {
        if (!(value as THREE.Texture | undefined)?.isTexture || seen.has(value)) continue;
        const texture = value as THREE.Texture;
        seen.add(texture);
        const image = texture.image as { width?: number; height?: number; depth?: number } | undefined;
        const width = image?.width ?? 0;
        const height = image?.height ?? 0;
        const depth = image?.depth ?? 1;
        pixels += width * height * depth;
        if (![width, height, depth, pixels].every(Number.isSafeInteger) ||
          width < 0 || height < 0 || depth < 1 ||
          width > IMPORT_TEXTURE_MAX_DIMENSION || height > IMPORT_TEXTURE_MAX_DIMENSION ||
          pixels > IMPORT_TEXTURE_PIXEL_BUDGET) {
          throw new Error(`${format} decoded textures exceed the image safety budget (32 megapixels total, 16384 pixels per dimension).`);
        }
      }
    }
  });
}
