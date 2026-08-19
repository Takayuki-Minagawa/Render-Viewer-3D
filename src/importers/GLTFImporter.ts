import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { abortable } from "./abort";
import { BaseImporter } from "./BaseImporter";
import { LocalResourceResolver } from "./resource-resolver";
import type { ImportedModel, ImportOptions } from "./types";

export class GLTFImporter extends BaseImporter {
  readonly id = "gltf";
  readonly name = "glTF / GLB";
  readonly extensions = ["gltf", "glb"] as const;
  readonly experimental = false;

  async import(
    primary: File,
    allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    this.assertWithinMainThreadBudget(allFiles);
    const resolver = new LocalResourceResolver(allFiles, primary);
    const loader = new GLTFLoader(resolver.manager);

    try {
      const source = primary.name.toLowerCase().endsWith(".gltf")
        ? await primary.text()
        : await primary.arrayBuffer();
      this.assertNotAborted(options);

      const gltf = await abortable(
        loader.parseAsync(source, ""),
        options.signal,
        () => resolver.manager.abort(),
      );
      this.assertNotAborted(options);

      const root = this.createRoot(primary, gltf.scene);
      root.animations = gltf.animations;
      root.userData.gltfAsset = gltf.asset;
      root.userData.gltfUserData = gltf.userData;

      return this.finishImport(primary, "glTF", root, options, [], {
        sourceUnit: "meter",
        sourceCoordinateSystem: "y-up",
      });
    } catch (error: unknown) {
      const unresolved = resolver.unresolvedResources;
      if (options.signal?.aborted) {
        throw error;
      }
      if (unresolved.length > 0) {
        const detail =
          error instanceof Error ? error.message : "glTF parsing failed.";
        throw new Error(
          `${detail} Missing local glTF resources: ${unresolved.join(", ")}.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      resolver.dispose();
    }
  }
}
