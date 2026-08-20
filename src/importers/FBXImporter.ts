import type * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import {
  FBX_BINARY_PREFLIGHT_LIMITS,
  inspectBinaryFBX,
  type FBXBinaryPreflightLimits,
  type FBXSourceCoordinateSystem,
} from "./fbx-binary-preflight";
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
  binaryPreflightLimits?: FBXBinaryPreflightLimits;
}

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
  // Three's TextParser only recognizes a top-level node when its name starts
  // in column zero. Do not treat an indented/nested GlobalSettings node as the
  // root node that FBXTreeParser will consume.
  const settingsMatches = matchDirectAsciiLines(
    text,
    -1,
    text.length,
    /^GlobalSettings:[^\r\n]*\{/u,
  );
  if (settingsMatches.length === 0) return undefined;
  if (settingsMatches.length > 1) {
    throw new Error(
      "The ASCII FBX contains duplicate top-level GlobalSettings nodes.",
    );
  }
  const [{ lineStart, match: settingsMatch }] = settingsMatches;
  const openingBrace = lineStart + settingsMatch[0].lastIndexOf("{");
  const closingBrace = findClosingBrace(text, openingBrace);
  if (closingBrace === undefined) return undefined;

  let declaredAxis: number | undefined;
  // These indentation and whitespace constraints mirror TextParser.parse().
  const propertyPattern = /^\t\tP:[\t ](.*)$/u;
  let hasUpAxisDeclaration = false;
  const propertiesBlocks = findDirectAsciiNodeBlocks(
    text,
    openingBrace,
    closingBrace,
    /^\tProperties70:[^\r\n]*\{/u,
  );
  for (const block of propertiesBlocks) {
    for (const { match } of matchDirectAsciiLines(
      text,
      block.openingBrace,
      block.closingBrace,
      propertyPattern,
    )) {
      const property = parseAsciiSpecialProperty(match[1]);
      if (property.name !== "UpAxis") continue;

      const axis =
        typeof property.value === "number" &&
        Number.isFinite(property.value)
          ? property.value
          : undefined;
      if (hasUpAxisDeclaration) {
        throw new Error(
          declaredAxis !== undefined && declaredAxis === axis
            ? "The ASCII FBX contains duplicate UpAxis declarations."
            : "The ASCII FBX contains conflicting UpAxis declarations.",
        );
      }
      hasUpAxisDeclaration = true;
      if (axis === undefined) continue;
      if (axis !== 1 && axis !== 2) {
        throw new Error(
          `Unsupported FBX UpAxis value: ${axis}. Convert the file to Y-up or Z-up before importing.`,
        );
      }
      declaredAxis = axis;
    }
  }
  if (declaredAxis === undefined) return undefined;

  return declaredAxis === 1 ? "y-up" : "z-up";
}

interface AsciiSpecialProperty {
  readonly name: string;
  readonly value: number | string | undefined;
}

function parseAsciiSpecialProperty(source: string): AsciiSpecialProperty {
  // Keep this deliberately in lockstep with TextParser.parseNodeProperty()
  // and parseNodeSpecialProperty() in Three's FBXLoader.
  const propertyValue = source
    .replace(/^"/u, "")
    .replace(/"$/u, "")
    .trim();
  const fields = propertyValue.split('",').map((field) =>
    field
      .trim()
      .replace(/^"/u, "")
      .replace(/\s/u, "_"),
  );
  const name = fields[0] ?? "";
  const type = fields[1];
  let value: number | string | undefined = fields[4];

  switch (type) {
    case "int":
    case "enum":
    case "bool":
    case "ULongLong":
    case "double":
    case "Number":
    case "FieldOfView":
      value = Number.parseFloat(value ?? "");
      break;
    default:
      break;
  }

  return { name, value };
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

interface AsciiNodeBlock {
  readonly openingBrace: number;
  readonly closingBrace: number;
}

interface DirectAsciiLineMatch {
  readonly lineStart: number;
  readonly match: RegExpMatchArray;
}

function findDirectAsciiNodeBlocks(
  text: string,
  parentOpeningBrace: number,
  parentClosingBrace: number,
  nodePattern: RegExp,
): readonly AsciiNodeBlock[] {
  const blocks: AsciiNodeBlock[] = [];
  for (const { lineStart, match } of matchDirectAsciiLines(
    text,
    parentOpeningBrace,
    parentClosingBrace,
    nodePattern,
  )) {
    const openingBrace = lineStart + match[0].lastIndexOf("{");
    const closingBrace = findClosingBrace(text, openingBrace);
    if (closingBrace !== undefined && closingBrace <= parentClosingBrace) {
      blocks.push({ openingBrace, closingBrace });
    }
  }
  return blocks;
}

function matchDirectAsciiLines(
  text: string,
  parentOpeningBrace: number,
  parentClosingBrace: number,
  pattern: RegExp,
): readonly DirectAsciiLineMatch[] {
  const matches: DirectAsciiLineMatch[] = [];
  let depth = 1;
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (
    let index = parentOpeningBrace + 1;
    index < parentClosingBrace;
    index += 1
  ) {
    const previous = text[index - 1];
    const atLineStart =
      index === 0 || previous === "\n" || previous === "\r";
    if (atLineStart && depth === 1 && !inString && !inComment) {
      let lineEnd = index;
      while (
        lineEnd < parentClosingBrace &&
        text[lineEnd] !== "\n" &&
        text[lineEnd] !== "\r"
      ) {
        lineEnd += 1;
      }
      const match = text.slice(index, lineEnd).match(pattern);
      if (match) matches.push({ lineStart: index, match });
    }

    const character = text[index];
    if (inComment) {
      if (character === "\n" || character === "\r") {
        inComment = false;
      }
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
    }
  }

  return matches;
}

function undoLoaderAxisCorrection(
  root: THREE.Group,
  declaredAxis: FBXSourceCoordinateSystem | undefined,
): FBXSourceCoordinateSystem {
  // A verified ASCII Y-up declaration protects an authored root rotation.
  if (declaredAxis === "y-up") return "y-up";

  if (declaredAxis === "z-up") {
    if (hasExactLoaderAxisCorrection(root)) {
      root.rotation.set(0, 0, 0);
    }
    return "z-up";
  }

  // FBXLoader uses this exact synthetic wrapper rotation for Z-up assets. The
  // strict fallback retains compatibility for files without an axis record.
  if (hasExactLoaderAxisCorrection(root)) {
    root.rotation.set(0, 0, 0);
    return "z-up";
  }
  return "y-up";
}

function hasExactLoaderAxisCorrection(root: THREE.Group): boolean {
  return (
    root.rotation.x === -Math.PI / 2 &&
    root.rotation.y === 0 &&
    root.rotation.z === 0
  );
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
    const binaryPreflight = await inspectBinaryFBX(
      source,
      this.dependencies.binaryPreflightLimits ??
        FBX_BINARY_PREFLIGHT_LIMITS,
    );
    this.assertNotAborted(options);
    const declaredAxis = binaryPreflight.isBinary
      ? binaryPreflight.sourceCoordinateSystem
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
