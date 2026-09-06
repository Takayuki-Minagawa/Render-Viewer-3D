import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { BaseImporter } from "./BaseImporter";
import { assertRenderableGeometryBudget } from "./geometry-budget";
import { assertImportedTextureBudget } from "./texture-budget";
import { disposeLoadedObject, parseWithLoaderResourceWait } from "./loader-resource-wait";
import { LocalResourceResolver } from "./resource-resolver";
import type { ImportedModel, ImportOptions, ImportWarning } from "./types";

export function referencedMaterialLibraries(source: string): string[] {
  const references = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\s*mtllib\s+(.+?)\s*$/iu.exec(line.replace(/\s+#.*$/u, ""));
    if (match?.[1]) references.add(match[1]);
  }
  return [...references];
}

export class OBJImporter extends BaseImporter {
  readonly id = "obj";
  readonly name = "Wavefront OBJ";
  readonly extensions = ["obj"] as const;
  readonly experimental = false;

  async import(primary: File, allFiles: readonly File[], options: ImportOptions): Promise<ImportedModel> {
    this.assertNotAborted(options);
    const files = [...new Set([primary, ...allFiles])];
    this.assertWithinMainThreadBudget(files);
    const source = await primary.text();
    this.assertNotAborted(options);
    const resolver = new LocalResourceResolver(files, primary);
    const resolvers = [resolver];
    const warnings: ImportWarning[] = [];
    const creators: MTLLoader.MaterialCreator[] = [];
    const createdTextures = new Set<THREE.Texture>();
    let content: THREE.Group | undefined;
    try {
      for (const reference of referencedMaterialLibraries(source)) {
        // First try a complete filename, preserving spaces. If it does not
        // identify a selected file, OBJ also permits multiple libraries per line.
        let libraries: File[];
        try {
          libraries = [resolver.resolveFile(reference)];
        } catch (error) {
          const names = reference.match(/"[^"]+"|\S+/gu) ?? [];
          if (names.length < 2) throw error;
          libraries = names.map((name) => resolver.resolveFile(name.replace(/^"|"$/gu, "")));
        }
        for (const library of libraries) {
          const resources = new LocalResourceResolver(files, library);
          resolvers.push(resources);
          const text = await library.text();
          this.assertNotAborted(options);
          const creator = new MTLLoader(resources.manager).parse(text, "");
          const loadTexture = creator.loadTexture.bind(creator);
          creator.loadTexture = (...args) => {
            const texture = loadTexture(...args);
            createdTextures.add(texture);
            return texture;
          };
          creators.push(creator);
        }
      }
      const loader = new OBJLoader(resolver.manager);
      if (creators.length > 0) {
        warnings.push({ code: "obj-mtl-pbr-approximation", message: "OBJ/MTL uses legacy Phong materials. Custom PBR material conversion approximates their appearance." });
        // OBJLoader only needs create(). Keep each creator's own relative
        // texture directory and use the last declaration for duplicate names.
        const combined = new MTLLoader().parse("", "");
        combined.create = (name) => {
          const creator = [...creators].reverse().find((candidate) => Object.hasOwn(candidate.materialsInfo, name));
          if (!creator) throw new Error(`OBJ material is not defined in the selected MTL libraries: ${name}.`);
          return creator.create(name);
        };
        loader.setMaterials(combined);
      }
      // Every MTL manager must be tracked while synchronous OBJ parsing creates
      // its textures. Nested trackers await resources before URL revocation.
      const parse = (index: number): Promise<THREE.Group> => {
        if (index === resolvers.length) {
          content = loader.parse(source);
          return Promise.resolve(content);
        }
        return parseWithLoaderResourceWait(resolvers[index].manager, () => parse(index + 1), options.signal);
      };
      content = await parse(0);
      this.assertNotAborted(options);
      const root = this.createRoot(primary, content);
      assertRenderableGeometryBudget(root, "OBJ");
      assertImportedTextureBudget(root, "OBJ");
      return this.finishImport(primary, "OBJ", root, options, warnings);
    } catch (error) {
      // Include material creators to collect textures if OBJ parsing threw
      // after material creation but before returning an Object3D.
      const cleanup = new THREE.Group();
      if (content) cleanup.add(content);
      const materials = creators.flatMap((creator) => Object.values(creator.materials));
      for (const texture of createdTextures) materials.push(new THREE.MeshBasicMaterial({ map: texture }));
      cleanup.add(new THREE.Mesh(new THREE.BufferGeometry(), materials));
      disposeLoadedObject(cleanup);
      throw error;
    } finally {
      for (const resources of resolvers) resources.dispose();
    }
  }
}
