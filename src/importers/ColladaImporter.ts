import type * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import { assertRenderableGeometryBudget } from "./geometry-budget";
import {
  disposeLoadedObject,
  parseWithLoaderResourceWait,
} from "./loader-resource-wait";
import { LocalResourceResolver } from "./resource-resolver";
import type {
  ImportedModel,
  ImportOptions,
  ResolvedImportCoordinateSystem,
} from "./types";

interface ColladaResultLike {
  scene: THREE.Scene;
}

interface ColladaLoaderLike {
  parse(source: string, path: string): ColladaResultLike | null;
}

interface ColladaAssetMetadata {
  readonly metersPerUnit: number;
  readonly sourceUnitLabel: string;
  readonly sourceCoordinateSystem: ResolvedImportCoordinateSystem;
}

interface PendingColladaElement {
  readonly element: Element;
  readonly nodeDepth: number;
}

const MAX_COLLADA_XML_ELEMENTS = 100_000;
const MAX_COLLADA_XML_DEPTH = 256;
const MAX_COLLADA_NODES = 50_000;
const MAX_COLLADA_NODE_DEPTH = 256;

export interface ColladaImporterDependencies {
  createLoader?: (
    manager: THREE.LoadingManager,
  ) => ColladaLoaderLike | Promise<ColladaLoaderLike>;
}

function directChildrenByLocalName(
  parent: Element,
  localName: string,
): Element[] {
  return Array.from(parent.children).filter(
    (child) => child.localName.toLowerCase() === localName,
  );
}

function optionalDirectChild(
  parent: Element,
  localName: string,
): Element | undefined {
  const matches = directChildrenByLocalName(parent, localName);
  if (matches.length > 1) {
    throw new Error(
      `COLLADA contains more than one direct ${localName} element.`,
    );
  }
  return matches[0];
}

function inspectColladaAsset(source: string): ColladaAssetMetadata {
  preflightColladaXmlStructure(source);
  const document = new DOMParser().parseFromString(source, "application/xml");
  const root = document.documentElement;
  if (
    !root ||
    root.localName.toLowerCase() !== "collada" ||
    document.getElementsByTagName("parsererror").length > 0
  ) {
    throw new Error("COLLADA source is not well-formed COLLADA XML.");
  }
  validateColladaStructure(root);

  const asset = optionalDirectChild(root, "asset");
  const unit = asset ? optionalDirectChild(asset, "unit") : undefined;
  const rawMeter = unit?.getAttribute("meter") ?? undefined;
  const metersPerUnit = rawMeter === undefined ? 1 : Number(rawMeter);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
    throw new Error(
      `COLLADA asset unit meter must be a positive finite number: ${rawMeter ?? "missing"}.`,
    );
  }

  const unitName = unit?.getAttribute("name")?.trim() || undefined;
  const upAxis = asset
    ? optionalDirectChild(asset, "up_axis")
    : undefined;
  const rawUpAxis = upAxis?.textContent?.trim().toUpperCase() || "Y_UP";
  if (rawUpAxis === "X_UP") {
    throw new Error(
      "COLLADA X_UP assets are not supported; convert the file to Y_UP or Z_UP before importing.",
    );
  }
  if (rawUpAxis !== "Y_UP" && rawUpAxis !== "Z_UP") {
    throw new Error(`Unsupported COLLADA up_axis value: ${rawUpAxis}.`);
  }

  return {
    metersPerUnit,
    sourceUnitLabel:
      unitName ||
      (metersPerUnit === 1
        ? "meter"
        : `${metersPerUnit} meters per unit`),
    sourceCoordinateSystem:
      rawUpAxis === "Z_UP" ? "z-up" : "y-up",
  };
}

function preflightColladaXmlStructure(source: string): void {
  const openElements: string[] = [];
  let cursor = 0;
  let elementCount = 0;

  while (cursor < source.length) {
    const markupStart = source.indexOf("<", cursor);
    if (markupStart < 0) break;

    if (source.startsWith("<!--", markupStart)) {
      cursor = findColladaMarkupEnd(source, markupStart + 4, "-->");
      continue;
    }
    if (source.startsWith("<![CDATA[", markupStart)) {
      cursor = findColladaMarkupEnd(source, markupStart + 9, "]]>");
      continue;
    }
    if (source.startsWith("<?", markupStart)) {
      cursor = findColladaMarkupEnd(source, markupStart + 2, "?>");
      continue;
    }
    if (source.startsWith("<!", markupStart)) {
      const declaration = source.slice(markupStart).match(
        /^<!\s*(?:DOCTYPE|ENTITY)\b/iu,
      );
      if (declaration) {
        throw new Error(
          "COLLADA DOCTYPE and ENTITY declarations are not supported.",
        );
      }
      throwMalformedColladaXml();
    }

    const markupEnd = findColladaTagEnd(source, markupStart + 1);
    if (source.startsWith("</", markupStart)) {
      const closingTag = source
        .slice(markupStart + 2, markupEnd)
        .trim();
      if (!closingTag || /\s/u.test(closingTag)) throwMalformedColladaXml();
      if (openElements.pop() !== closingTag) throwMalformedColladaXml();
      cursor = markupEnd + 1;
      continue;
    }

    const tagBody = source.slice(markupStart + 1, markupEnd).trimEnd();
    const tagName = tagBody.match(/^([^\s/>]+)/u)?.[1];
    if (!tagName) throwMalformedColladaXml();

    elementCount += 1;
    if (elementCount > MAX_COLLADA_XML_ELEMENTS) {
      throw new Error("COLLADA XML exceeds the safe element-count limit.");
    }

    if (!tagBody.endsWith("/")) {
      openElements.push(tagName);
      if (openElements.length > MAX_COLLADA_XML_DEPTH) {
        throw new Error(
          "COLLADA XML markup nesting exceeds the safe depth limit.",
        );
      }
    }
    cursor = markupEnd + 1;
  }

  if (openElements.length > 0) throwMalformedColladaXml();
}

function findColladaMarkupEnd(
  source: string,
  contentStart: number,
  terminator: string,
): number {
  const end = source.indexOf(terminator, contentStart);
  if (end < 0) throwMalformedColladaXml();
  return end + terminator.length;
}

function findColladaTagEnd(source: string, contentStart: number): number {
  let quote: "\"" | "'" | undefined;
  for (let index = contentStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
    if (character === "<") throwMalformedColladaXml();
  }
  throwMalformedColladaXml();
}

function throwMalformedColladaXml(): never {
  throw new Error("COLLADA source is not well-formed COLLADA XML.");
}

function validateColladaStructure(root: Element): void {
  let elementCount = 0;
  let nodeCount = 0;
  const pending: PendingColladaElement[] = [
    { element: root, nodeDepth: 0 },
  ];

  while (pending.length > 0) {
    const current = pending.pop()!;
    elementCount += 1;
    if (elementCount > MAX_COLLADA_XML_ELEMENTS) {
      throw new Error("COLLADA XML exceeds the safe element-count limit.");
    }
    if (current.element.localName.toLowerCase() === "instance_node") {
      throw new Error(
        "COLLADA instance_node references are not supported by this experimental importer.",
      );
    }
    const children = Array.from(current.element.children);
    if (
      elementCount + pending.length + children.length >
      MAX_COLLADA_XML_ELEMENTS
    ) {
      throw new Error("COLLADA XML exceeds the safe element-count limit.");
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      const isNode = child.localName.toLowerCase() === "node";
      const nodeDepth = current.nodeDepth + (isNode ? 1 : 0);
      if (isNode) {
        nodeCount += 1;
        if (nodeCount > MAX_COLLADA_NODES) {
          throw new Error("COLLADA contains too many scene nodes.");
        }
        if (nodeDepth > MAX_COLLADA_NODE_DEPTH) {
          throw new Error("COLLADA scene node nesting exceeds the safe depth limit.");
        }
      }
      pending.push({ element: child, nodeDepth });
    }
  }
}

function undoColladaLoaderNormalization(
  scene: THREE.Scene,
  metadata: ColladaAssetMetadata,
): void {
  scene.scale.divideScalar(metadata.metersPerUnit);
  if (metadata.sourceCoordinateSystem === "z-up") {
    scene.rotation.set(0, 0, 0);
  }
}

export class ColladaImporter extends BaseImporter {
  readonly id = "collada";
  readonly name = "COLLADA / DAE";
  readonly extensions = ["dae"] as const;
  readonly experimental = true;

  constructor(
    private readonly dependencies: ColladaImporterDependencies = {},
  ) {
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
    const source = await primary.text();
    this.assertNotAborted(options);
    const assetMetadata = inspectColladaAsset(source);
    this.assertNotAborted(options);

    const resolver = new LocalResourceResolver(files, primary);
    let parsedScene: THREE.Scene | undefined;

    try {
      const loader = this.dependencies.createLoader
        ? await this.dependencies.createLoader(resolver.manager)
        : new (await import("three/addons/loaders/ColladaLoader.js"))
            .ColladaLoader(resolver.manager);
      this.assertNotAborted(options);

      const result = await parseWithLoaderResourceWait(
        resolver.manager,
        () => {
          const parsed = loader.parse(source, "");
          parsedScene = parsed?.scene;
          return parsed;
        },
        options.signal,
      );
      this.assertNotAborted(options);
      if (!result) {
        throw new Error("COLLADA parsing did not produce a scene.");
      }

      parsedScene = result.scene;
      undoColladaLoaderNormalization(parsedScene, assetMetadata);
      const root = this.createRoot(primary, parsedScene);
      root.animations = parsedScene.animations;
      assertRenderableGeometryBudget(root, "COLLADA");

      return this.finishImport(primary, "COLLADA", root, options, [], {
        sourceMetersPerUnit: assetMetadata.metersPerUnit,
        sourceUnitLabel: assetMetadata.sourceUnitLabel,
        sourceCoordinateSystem: assetMetadata.sourceCoordinateSystem,
      });
    } catch (error: unknown) {
      if (parsedScene) disposeLoadedObject(parsedScene);
      if (options.signal?.aborted) throw error;

      const unresolved = resolver.unresolvedResources;
      if (unresolved.length > 0) {
        const detail =
          error instanceof Error ? error.message : "COLLADA parsing failed.";
        throw new Error(
          `${detail} Unresolved local COLLADA resources: ${unresolved.join(", ")}.`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      resolver.dispose();
    }
  }
}
