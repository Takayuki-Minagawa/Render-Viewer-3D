import { Group } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { attachGLTFDecoders } from "./gltf-decoders";
import { inspectGLTFSource } from "./gltf-preflight";
import { assertRenderableGeometryBudget } from "./geometry-budget";
import { assertImportedTextureBudget } from "./texture-budget";
import { disposeLoadedObject, parseWithLoaderResourceWait } from "./loader-resource-wait";
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
    const files = [...new Set([primary, ...allFiles])];
    this.assertWithinMainThreadBudget(files);
    const resolver = new LocalResourceResolver(files, primary);
    let disposeDecoders: (() => void) | undefined;
    let parsed: GLTF | undefined;
    let abandoned = false;

    try {
      const source = primary.name.toLowerCase().endsWith(".gltf")
        ? await primary.text()
        : await primary.arrayBuffer();
      this.assertNotAborted(options);

      await inspectGLTFSource(source, resolver);
      this.assertNotAborted(options);
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      this.assertNotAborted(options);
      const loader = new GLTFLoader(resolver.manager);
      disposeDecoders = await attachGLTFDecoders(loader, resolver);
      this.assertNotAborted(options);
      const gltf = await parseWithLoaderResourceWait(
        resolver.manager,
        () => loader.parseAsync(source, "").then((result) => {
          if (abandoned) {
            disposeGLTF(result);
          } else {
            parsed = result;
          }
          return result;
        }),
        options.signal,
      );
      this.assertNotAborted(options);

      const root = this.createRoot(primary, gltf.scene);
      root.animations = gltf.animations;
      root.userData.gltfAsset = gltf.asset;
      root.userData.gltfUserData = gltf.userData;

      assertRenderableGeometryBudget(root, "glTF");
      assertImportedTextureBudget(root, "glTF");
      const imported = this.finishImport(primary, "glTF", root, options, [], {
        sourceUnit: "meter",
        sourceCoordinateSystem: "y-up",
      });
      const unused = new Group();
      for (const scene of gltf.scenes) if (scene !== gltf.scene) unused.add(scene);
      disposeLoadedObject(unused, [root]);
      return imported;
    } catch (error: unknown) {
      abandoned = true;
      if (parsed) disposeGLTF(parsed);
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
      disposeDecoders?.();
      resolver.dispose();
    }
  }
}

function disposeGLTF(gltf: GLTF): void {
  const collection = new Group();
  for (const scene of gltf.scenes) collection.add(scene);
  disposeLoadedObject(collection);
}
