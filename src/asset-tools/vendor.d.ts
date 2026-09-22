declare module "gltf-validator" {
  export function version(): string;
  export function supportedExtensions(): string[];
  export function validateBytes(bytes: Uint8Array, options?: {
    uri?: string; maxIssues?: number; writeTimestamp?: boolean;
    externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }): Promise<import("./types").ValidationReport>;
}
