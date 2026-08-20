import type * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import { preflightBinaryFBX } from "./fbx-binary-preflight";
import { assertRenderableGeometryBudget } from "./geometry-budget";
import {
  disposeLoadedObject,
  parseWithLoaderResourceWait,
} from "./loader-resource-wait";
import { LocalResourceResolver } from "./resource-resolver";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
} from "./types";

interface FBXLoaderLike {
  parse(source: ArrayBuffer | string, path: string): THREE.Group;
}

export interface FBXImporterDependencies {
  createLoader?: (
    manager: THREE.LoadingManager,
  ) => FBXLoaderLike | Promise<FBXLoaderLike>;
  createTgaLoader?: (
    manager: THREE.LoadingManager,
  ) => THREE.Loader | Promise<THREE.Loader>;
}

type FBXSourceCoordinateSystem = "y-up" | "z-up";

function unitScaleFactor(root: THREE.Group): number | undefined {
  const factor =
    root.userData.unitScaleFactor ??
    root.parent?.userData.unitScaleFactor;
  return typeof factor === "number" && Number.isFinite(factor) && factor > 0
    ? factor
    : undefined;
}

function inspectAsciiFBXUpAxis(
  source: ArrayBuffer,
): FBXSourceCoordinateSystem | undefined {
  const decoder = new TextDecoder();
  const signature = decoder.decode(
    new Uint8Array(source, 0, Math.min(source.byteLength, 23)),
  );
  if (signature.startsWith("Kaydara FBX Binary")) return undefined;

  const text = decoder.decode(source);
  const settingsMatch =
    /^[\t ]*GlobalSettings[\t ]*:[\t ]*\{/gmu.exec(text);
  if (!settingsMatch) return undefined;
  const openingBrace = settingsMatch.index + settingsMatch[0].lastIndexOf("{");
  const closingBrace = findClosingBrace(text, openingBrace);
  if (closingBrace === undefined) return undefined;

  const settings = text.slice(openingBrace + 1, closingBrace);
  const axes = new Set<number>();
  const propertyPattern =
    /^[\t ]*P[\t ]*:[\t ]*"UpAxis"[\t ]*,[^\r\n]*,[\t ]*(-?\d+)[\t ]*$/gmu;
  for (const match of settings.matchAll(propertyPattern)) {
    axes.add(Number(match[1]));
  }
  if (axes.size !== 1) return undefined;

  const [axis] = axes;
  if (axis === 1) return "y-up";
  if (axis === 2) return "z-up";
  throw new Error(
    `Unsupported FBX UpAxis value: ${axis}. Convert the file to Y-up or Z-up before importing.`,
  );
}

function findClosingBrace(
  text: string,
  openingBrace: number,
): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (let index = openingBrace; index < text.length; index += 1) {
    const character = text[index];
    if (inComment) {
      if (character === "\n" || character === "\r") inComment = false;
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === ";") {
      inComment = true;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function undoLoaderAxisCorrection(
  root: THREE.Group,
  declaredAxis: FBXSourceCoordinateSystem | undefined,
): FBXSourceCoordinateSystem {
  // A verified ASCII Y-up declaration protects an authored root rotation.
  if (declaredAxis === "y-up") return "y-up";

  // FBXLoader uses this exact synthetic wrapper rotation for Z-up assets. The
  // strict fallback also preserves explicit overrides for binary FBX files,
  // whose GlobalSettings record is not decoded here.
  if (
    root.rotation.x === -Math.PI / 2 &&
    root.rotation.y === 0 &&
    root.rotation.z === 0
  ) {
    root.rotation.set(0, 0, 0);
    return "z-up";
  }
  return "y-up";
}

export class FBXImporter extends BaseImporter {
  readonly id = "fbx";
  readonly name = "Autodesk FBX";
  readonly extensions = ["fbx"] as const;
  readonly experimental = true;

  constructor(private readonly dependencies: FBXImporterDependencies = {}) {
    super();
  }

  async import(
    primary: File,
    allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    const files = [...new Set([primary, ...allFiles])];
    this.assertWithinMainThreadBudget(files);
    const source = await primary.arrayBuffer();
    this.assertNotAborted(options);
    const isBinary = await preflightBinaryFBX(source);
    this.assertNotAborted(options);
    const declaredAxis = isBinary
      ? undefined
      : inspectAsciiFBXUpAxis(source);
    const resolver = new LocalResourceResolver(files, primary);
    let parsedRoot: THREE.Group | undefined;

    try {
      const [loaderModule, tgaModule] = await Promise.all([
        this.dependencies.createLoader
          ? undefined
          : import("three/addons/loaders/FBXLoader.js"),
        this.dependencies.createTgaLoader
          ? undefined
          : import("three/addons/loaders/TGALoader.js"),
      ]);
      this.assertNotAborted(options);

      const loader = this.dependencies.createLoader
        ? await this.dependencies.createLoader(resolver.manager)
        : new loaderModule!.FBXLoader(resolver.manager);
      const tgaLoader = this.dependencies.createTgaLoader
        ? await this.dependencies.createTgaLoader(resolver.manager)
        : new tgaModule!.TGALoader(resolver.manager);
      resolver.manager.addHandler(/\.tga(?:[?#].*)?$/iu, tgaLoader);

      parsedRoot = await parseWithLoaderResourceWait(
        resolver.manager,
        () => {
          parsedRoot = loader.parse(source, "");
          return parsedRoot;
        },
        options.signal,
      );
      this.assertNotAborted(options);

      const factor = unitScaleFactor(parsedRoot);
      const sourceCoordinateSystem = undoLoaderAxisCorrection(
        parsedRoot,
        declaredAxis,
      );
      const root = this.createRoot(primary, parsedRoot);
      root.animations = parsedRoot.animations;
      if (factor !== undefined) {
        root.userData.fbxUnitScaleFactor = factor;
      }
      assertRenderableGeometryBudget(root, "FBX");
      let containsLine = false;
      root.traverse((object) => {
        if ((object as THREE.Line).isLine) containsLine = true;
      });
      const warnings: ImportWarning[] = containsLine
        ? [
            {
              code: "fbx-line-custom-material-unsupported",
              message:
                "FBX line objects keep their imported line material when Custom PBR material mode is selected.",
            },
          ]
        : [];

      return this.finishImport(primary, "FBX", root, options, warnings, {
        sourceMetersPerUnit:
          factor === undefined ? undefined : factor * 0.01,
        sourceUnitLabel:
          factor === undefined
            ? undefined
            : `${factor} centimeters per unit`,
        sourceCoordinateSystem,
      });
    } catch (error: unknown) {
      if (parsedRoot) disposeLoadedObject(parsedRoot);
      if (options.signal?.aborted) throw error;

      const unresolved = resolver.unresolvedResources;
      if (unresolved.length > 0) {
        const detail =
          error instanceof Error ? error.message : "FBX parsing failed.";
        throw new Error(
          `${detail} Unresolved local FBX resources: ${unresolved.join(", ")}.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      resolver.dispose();
    }
  }
}
