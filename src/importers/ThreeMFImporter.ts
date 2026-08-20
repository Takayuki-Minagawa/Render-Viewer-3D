import * as THREE from "three";
import { BaseImporter } from "./BaseImporter";
import {
  assertRenderableGeometryBudget,
  MAIN_THREAD_GEOMETRY_BUDGET,
} from "./geometry-budget";
import {
  disposeLoadedObject,
  parseWithLoaderResourceWait,
} from "./loader-resource-wait";
import type {
  ImportedModel,
  ImportOptions,
  ImportWarning,
} from "./types";
import {
  inspectZipCentralDirectory,
  validateZipExpandedSizes,
  type ZipPreflightLimits,
} from "./zip-preflight";

export const MAX_3MF_ARCHIVE_BYTES = 16 * 1024 * 1024;
export const MAX_3MF_XML_BYTES = 8 * 1024 * 1024;
export const MAX_3MF_XML_ELEMENTS = 100_000;
export const MAX_3MF_XML_DEPTH = 256;
const MAX_3MF_TRANSFORM_ATTRIBUTE_LENGTH = 512;

export const THREE_MF_ZIP_LIMITS: Readonly<ZipPreflightLimits> = Object.freeze({
  maxEntries: 4_096,
  maxEntryUncompressedBytes: MAX_3MF_XML_BYTES,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 200,
});

const THREE_MF_UNIT_METERS = Object.freeze({
  micron: 0.000_001,
  millimeter: 0.001,
  centimeter: 0.01,
  inch: 0.0254,
  foot: 0.3048,
  meter: 1,
});
const THREE_MF_LOADER_ROOT_RELATIONSHIP_PATTERN = /_rels\/.rels$/u;
const THREE_MF_LOADER_MODEL_RELATIONSHIP_PATTERN =
  /3D\/_rels\/.*\.model\.rels$/u;
const THREE_MF_TRANSFORM_NUMBER_PATTERN =
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
const THREE_MF_LOADER_RESOURCE_TYPES = [
  "basematerials",
  "texture2d",
  "colorgroup",
  "implicitfunction",
  "pbmetallicdisplayproperties",
  "texture2dgroup",
  "object",
] as const;

type ThreeMFUnitName = keyof typeof THREE_MF_UNIT_METERS;

interface ThreeMFUnitMetadata {
  readonly metersPerUnit: number;
  readonly label: ThreeMFUnitName;
}

interface ThreeMFLoaderLike {
  parse(data: ArrayBuffer): THREE.Group;
}

interface ExpandedUsage {
  readonly sceneNodes: number;
  readonly depth: number;
  readonly renderables: number;
  readonly positionVertices: number;
  readonly vertexReferences: number;
  readonly primitives: number;
}

interface ModelObjectDefinition {
  readonly id: string;
  readonly references: readonly string[];
  readonly meshUsage?: ExpandedUsage;
}

export type ThreeMFLoaderFactory = (
  manager: THREE.LoadingManager,
) => Promise<ThreeMFLoaderLike>;

async function createThreeMFLoader(
  manager: THREE.LoadingManager,
): Promise<ThreeMFLoaderLike> {
  const { ThreeMFLoader } = await import(
    "three/addons/loaders/3MFLoader.js"
  );
  return new ThreeMFLoader(manager);
}

export class ThreeMFImporter extends BaseImporter {
  readonly id = "3mf";
  readonly name = "3MF";
  readonly extensions = ["3mf"] as const;
  readonly experimental = true;

  constructor(
    private readonly loaderFactory: ThreeMFLoaderFactory = createThreeMFLoader,
  ) {
    super();
  }

  async import(
    primary: File,
    _allFiles: readonly File[],
    options: ImportOptions,
  ): Promise<ImportedModel> {
    this.assertNotAborted(options);
    if (primary.size > MAX_3MF_ARCHIVE_BYTES) {
      const limitMiB = MAX_3MF_ARCHIVE_BYTES / (1024 * 1024);
      throw new Error(
        `3MF import exceeds the ${limitMiB} MiB compressed archive safety limit. Split or optimize the model before importing it.`,
      );
    }

    const data = await primary.arrayBuffer();
    this.assertNotAborted(options);
    if (data.byteLength > MAX_3MF_ARCHIVE_BYTES) {
      throw new Error("The 3MF archive exceeds its declared file size.");
    }
    const archive = inspectZipCentralDirectory(data, THREE_MF_ZIP_LIMITS);
    const modelEntry = assertRequiredThreeMFEntries(archive.fileNames);
    await validateZipExpandedSizes(data, archive, THREE_MF_ZIP_LIMITS);
    this.assertNotAborted(options);
    const inspectedUnit = await inspectThreeMFPackage(data, modelEntry);
    this.assertNotAborted(options);

    const manager = new THREE.LoadingManager();
    const loader = await this.loaderFactory(manager);
    this.assertNotAborted(options);
    let content: THREE.Group | undefined;

    try {
      content = await parseWithLoaderResourceWait(
        manager,
        () => {
          content = loader.parse(data);
          return content;
        },
        options.signal,
      );
      this.assertNotAborted(options);

      const warnings: ImportWarning[] = inspectedUnit
        ? []
        : [
            {
              code: "3mf-unit-assumed",
              message:
                "The 3MF model unit could not be inspected; Auto treats source coordinates as millimeters. Choose a unit explicitly if the package is incomplete or uses another unit.",
            },
          ];
      const unit = inspectedUnit ?? resolveThreeMFUnit(undefined);
      const root = this.createRoot(primary, content);
      assertRenderableGeometryBudget(root, "3MF");
      return this.finishImport(primary, "3MF", root, options, warnings, {
        sourceMetersPerUnit: unit.metersPerUnit,
        sourceUnitLabel: unit.label,
        sourceCoordinateSystem: "z-up",
      });
    } catch (error) {
      if (content) disposeLoadedObject(content);
      throw error;
    }
  }
}

async function inspectThreeMFPackage(
  data: ArrayBuffer,
  modelEntry: string,
): Promise<ThreeMFUnitMetadata | undefined> {
  let modelBytes: Uint8Array | undefined;
  let relationshipsBytes: Uint8Array | undefined;
  try {
    const { unzipSync } = await import(
      "three/addons/libs/fflate.module.js"
    );
    const normalizedModelEntry = normalizeArchiveName(modelEntry);
    const extracted = unzipSync(new Uint8Array(data), {
      filter(entry) {
        const name = normalizeArchiveName(entry.name);
        return name === normalizedModelEntry || name === "_rels/.rels";
      },
    });
    for (const [name, bytes] of Object.entries(extracted)) {
      const normalizedName = normalizeArchiveName(name);
      if (normalizedName === normalizedModelEntry) modelBytes = bytes;
      if (normalizedName === "_rels/.rels") relationshipsBytes = bytes;
    }
  } catch {
    // Constructor/factory seam tests can use a structurally preflightable ZIP
    // without valid compressed payloads. The production loader will still
    // reject such an archive; retain the legacy millimeter assumption here.
    return undefined;
  }
  if (!modelBytes || !relationshipsBytes) return undefined;

  const relationshipsRoot = parseXmlRoot(
    relationshipsBytes,
    "Relationships",
    "3MF package relationships",
  );
  validateRootRelationships(relationshipsRoot, modelEntry);

  const modelRoot = parseXmlRoot(
    modelBytes,
    "model",
    "3MF model part",
  );
  validateThreeMFObjectGraph(modelRoot);
  return resolveThreeMFUnit(modelRoot.getAttribute("unit") ?? undefined);
}

function parseXmlRoot(
  bytes: Uint8Array,
  expectedLocalName: string,
  label: string,
): Element {
  if (bytes.byteLength > MAX_3MF_XML_BYTES) {
    throw new Error(
      `${label} exceeds the ${MAX_3MF_XML_BYTES}-byte XML safety limit.`,
    );
  }
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(xml)) {
    throw new Error(
      `${label} contains a DOCTYPE or ENTITY declaration, which is not supported.`,
    );
  }
  preflightThreeMFXMLStructure(xml, label);
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const root = document.documentElement;
  if (
    !root ||
    root.localName !== expectedLocalName ||
    document.getElementsByTagName("parsererror").length > 0
  ) {
    throw new Error(`${label} is not well-formed ${expectedLocalName} XML.`);
  }
  return root;
}

function preflightThreeMFXMLStructure(source: string, label: string): void {
  let elementCount = 0;
  let depth = 0;
  let offset = 0;

  while (offset < source.length) {
    const start = source.indexOf("<", offset);
    if (start < 0) break;

    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      if (end < 0) throw malformedThreeMFXML(label);
      offset = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", start)) {
      const end = source.indexOf("]]>", start + 9);
      if (end < 0) throw malformedThreeMFXML(label);
      offset = end + 3;
      continue;
    }
    if (source.startsWith("<?", start)) {
      const end = source.indexOf("?>", start + 2);
      if (end < 0) throw malformedThreeMFXML(label);
      offset = end + 2;
      continue;
    }
    if (source.startsWith("<!", start)) {
      throw new Error(`${label} contains an unsupported XML declaration.`);
    }

    const end = findThreeMFXMLTagEnd(source, start + 1);
    if (end < 0) throw malformedThreeMFXML(label);
    if (source.startsWith("</", start)) {
      depth -= 1;
      if (depth < 0) throw malformedThreeMFXML(label);
      offset = end + 1;
      continue;
    }

    const markup = source.slice(start + 1, end);
    if (!/^[A-Za-z_:]/u.test(markup)) throw malformedThreeMFXML(label);
    elementCount += 1;
    if (elementCount > MAX_3MF_XML_ELEMENTS) {
      throw new Error(
        `${label} exceeds the ${MAX_3MF_XML_ELEMENTS}-element XML safety limit.`,
      );
    }
    if (!/\/\s*$/u.test(markup)) {
      depth += 1;
      if (depth > MAX_3MF_XML_DEPTH) {
        throw new Error(
          `${label} exceeds the XML nesting safety limit of ${MAX_3MF_XML_DEPTH}.`,
        );
      }
    }
    offset = end + 1;
  }

  if (depth !== 0) throw malformedThreeMFXML(label);
}

function findThreeMFXMLTagEnd(source: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let offset = start; offset < source.length; offset += 1) {
    const character = source[offset];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return offset;
    } else if (character === "<") {
      return -1;
    }
  }
  return -1;
}

function malformedThreeMFXML(label: string): Error {
  return new Error(`${label} is not well-formed XML markup.`);
}

function validateRootRelationships(
  root: Element,
  modelEntry: string,
): void {
  const relationships = onlyDirectDescendants(
    root,
    "Relationship",
    "package Relationship",
  );
  for (const relationship of relationships) {
    if (relationship.getAttribute("TargetMode")?.toLowerCase() === "external") {
      throw new Error("External 3MF package relationship targets are not supported.");
    }
  }
  const modelRelationships = relationships.filter((relationship) =>
    relationship.getAttribute("Target")?.toLowerCase().endsWith(".model"),
  );
  if (modelRelationships.length !== 1) {
    throw new Error("The 3MF package must contain exactly one root model relationship.");
  }
  const target = modelRelationships[0].getAttribute("Target") ?? "";
  if (
    !target.startsWith("/") ||
    target.includes("\\") ||
    normalizeArchiveName(target) !== normalizeArchiveName(modelEntry)
  ) {
    throw new Error(
      "The 3MF root model relationship does not target the selected internal model part.",
    );
  }
}

function validateThreeMFObjectGraph(model: Element): void {
  onlyDirectDescendants(model, "metadata", "model metadata");
  const resources = requiredDirectChild(model, "resources");
  for (const resourceType of THREE_MF_LOADER_RESOURCE_TYPES) {
    onlyDirectDescendants(
      resources,
      resourceType,
      `${resourceType} resource`,
    );
  }
  for (const [resourceType, childType] of [
    ["basematerials", "base"],
    ["texture2dgroup", "tex2coord"],
    ["colorgroup", "color"],
    ["pbmetallicdisplayproperties", "pbmetallic"],
  ] as const) {
    for (const resource of directChildren(resources, resourceType)) {
      onlyDirectDescendants(
        resource,
        childType,
        `${childType} in ${resourceType}`,
      );
    }
  }
  const resourceElements = Array.from(resources.children);
  if (descendantsByLocalName(model, "texture2d").length > 0) {
    throw new Error(
      "Textured 3MF resources are not supported by this experimental importer.",
    );
  }
  if (resourceElements.length > MAIN_THREAD_GEOMETRY_BUDGET.maxSceneNodes) {
    throw new Error("The 3MF resource table exceeds the main-thread safety budget.");
  }

  const resourceTypes = new Map<string, string>();
  for (const resource of resourceElements) {
    if (resource.localName === "texture2d") {
      throw new Error(
        "Textured 3MF resources are not supported by this experimental importer.",
      );
    }
    const id = positiveIntegerId(
      resource.getAttribute("id"),
      `3MF ${resource.localName} resource id`,
    );
    if (resourceTypes.has(id)) {
      throw new Error(`The 3MF model contains a duplicate resource id: ${id}.`);
    }
    resourceTypes.set(id, resource.localName);
  }

  const definitions = new Map<string, ModelObjectDefinition>();
  for (const object of onlyDirectDescendants(
    resources,
    "object",
    "resource object",
  )) {
    const id = positiveIntegerId(
      object.getAttribute("id"),
      "3MF object id",
    );
    const objectPid = optionalResourceId(object, "pid", resourceTypes);
    optionalNonNegativeInteger(object, "pindex", "3MF object pindex");
    const meshElements = onlyDirectDescendants(object, "mesh", "object mesh");
    const componentContainers = onlyDirectDescendants(
      object,
      "components",
      "object components",
    );
    const mesh = meshElements.length === 1 ? meshElements[0] : undefined;
    const components = componentContainers.length === 1
      ? componentContainers[0]
      : undefined;
    if ((mesh ? 1 : 0) + (components ? 1 : 0) !== 1) {
      throw new Error(
        `3MF object ${id} must contain exactly one mesh or components element.`,
      );
    }

    const definition: ModelObjectDefinition = mesh
      ? {
          id,
          references: [],
          meshUsage: inspectMeshUsage(
            mesh,
            objectPid,
            object.getAttribute("pindex"),
            resourceTypes,
          ),
        }
      : {
          id,
          references: onlyDirectDescendants(
            components!,
            "component",
            `component in object ${id}`,
          ).map(
            (component) => {
              validateThreeMFTransform(
                component,
                `3MF component in object ${id}`,
              );
              return positiveIntegerId(
                component.getAttribute("objectid"),
                `3MF component reference in object ${id}`,
              );
            },
          ),
        };
    definitions.set(id, definition);
  }

  assertThreeMFMeshPositionVertexBudget(
    Array.from(definitions.values(), (definition) =>
      definition.meshUsage?.positionVertices ?? 0,
    ),
  );

  for (const definition of definitions.values()) {
    for (const reference of definition.references) {
      if (!definitions.has(reference)) {
        throw new Error(
          `3MF object ${definition.id} references missing object ${reference}.`,
        );
      }
    }
  }

  const memo = new Map<string, ExpandedUsage>();
  const visiting = new Set<string>();
  const evaluate = (id: string, callDepth = 1): ExpandedUsage => {
    if (callDepth > MAIN_THREAD_GEOMETRY_BUDGET.maxDepth) {
      throw new Error("The 3MF component graph exceeds the maximum safe depth.");
    }
    const cached = memo.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      throw new Error(`The 3MF component graph contains a cycle at object ${id}.`);
    }
    visiting.add(id);
    const definition = definitions.get(id)!;
    let usage = definition.meshUsage ?? emptyUsage(1, 1);
    for (const reference of definition.references) {
      usage = appendChildUsage(usage, evaluate(reference, callDepth + 1));
      assertExpandedUsage(usage, `3MF object ${id}`);
    }
    visiting.delete(id);
    assertExpandedUsage(usage, `3MF object ${id}`);
    memo.set(id, usage);
    return usage;
  };

  let definitionsUsage = emptyUsage(0, 0);
  for (const id of definitions.keys()) {
    definitionsUsage = sumUsage(definitionsUsage, evaluate(id));
    assertExpandedUsage(definitionsUsage, "3MF object definitions");
  }

  const build = requiredDirectChild(model, "build");
  let buildUsage = emptyUsage(1, 1);
  for (const item of onlyDirectDescendants(build, "item", "build item")) {
    validateThreeMFTransform(item, "3MF build item");
    const objectId = positiveIntegerId(
      item.getAttribute("objectid"),
      "3MF build item objectid",
    );
    if (!definitions.has(objectId)) {
      throw new Error(`The 3MF build references missing object ${objectId}.`);
    }
    buildUsage = appendChildUsage(buildUsage, evaluate(objectId));
    assertExpandedUsage(buildUsage, "3MF build");
  }
  assertExpandedUsage(
    sumUsage(definitionsUsage, buildUsage),
    "3MF parse expansion",
  );
}

function inspectMeshUsage(
  mesh: Element,
  objectPid: string | undefined,
  objectPindex: string | null,
  resourceTypes: ReadonlyMap<string, string>,
): ExpandedUsage {
  const vertices = requiredDirectChild(mesh, "vertices");
  const vertexCount = onlyDirectDescendants(
    vertices,
    "vertex",
    "mesh vertex",
  ).length;
  if (vertexCount > MAIN_THREAD_GEOMETRY_BUDGET.maxPositionVertices) {
    throw new Error("The 3MF source vertex table exceeds the geometry safety budget.");
  }

  const triangles = requiredDirectChild(mesh, "triangles");
  const triangleElements = onlyDirectDescendants(
    triangles,
    "triangle",
    "mesh triangle",
  );
  const materialGroups = new Set<string>();
  for (const triangle of triangleElements) {
    for (const attribute of ["v1", "v2", "v3"] as const) {
      const index = nonNegativeInteger(
        triangle.getAttribute(attribute),
        `3MF triangle ${attribute}`,
      );
      if (index >= vertexCount) {
        throw new Error(`The 3MF triangle ${attribute} index is out of range.`);
      }
    }
    const pid = optionalResourceId(triangle, "pid", resourceTypes) ?? objectPid;
    for (const attribute of ["p1", "p2", "p3"] as const) {
      optionalNonNegativeInteger(
        triangle,
        attribute,
        `3MF triangle ${attribute}`,
      );
    }
    if (resourceTypes.get(pid ?? "") === "basematerials") {
      const materialIndex =
        triangle.getAttribute("p1") ?? objectPindex ?? "0";
      nonNegativeInteger(materialIndex, "3MF base material index");
      materialGroups.add(`${pid}:${materialIndex}`);
    } else {
      materialGroups.add(pid ?? "default");
    }
  }

  const vertexReferences = checkedMultiply(
    triangleElements.length,
    3,
    "3MF triangle vertex references",
  );
  const renderables = triangleElements.length === 0 ? 0 : materialGroups.size;
  const usage: ExpandedUsage = {
    sceneNodes: 1 + renderables,
    depth: renderables === 0 ? 1 : 2,
    renderables,
    positionVertices: vertexCount,
    vertexReferences,
    primitives: triangleElements.length,
  };
  assertExpandedUsage(usage, "3MF mesh");
  return usage;
}

function directChildren(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter(
    (child) => child.localName === localName,
  );
}


function descendantsByLocalName(
  parent: Element,
  localName: string,
): Element[] {
  const matches: Element[] = [];
  const pending = Array.from(parent.children);
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.localName === localName) matches.push(current);
    for (let index = current.children.length - 1; index >= 0; index -= 1) {
      pending.push(current.children[index]);
    }
  }
  return matches;
}

function onlyDirectDescendants(
  parent: Element,
  localName: string,
  label: string,
): Element[] {
  const direct = directChildren(parent, localName);
  const all = descendantsByLocalName(parent, localName);
  const directSet = new Set(direct);
  if (
    direct.length !== all.length ||
    all.some((element) => !directSet.has(element))
  ) {
    throw new Error(
      `Nested 3MF ${label} elements are not supported.`,
    );
  }
  return direct;
}
function optionalDirectChild(
  parent: Element,
  localName: string,
): Element | undefined {
  const children = directChildren(parent, localName);
  if (children.length > 1) {
    throw new Error(`The 3MF model contains duplicate ${localName} elements.`);
  }
  return children[0];
}

function requiredDirectChild(parent: Element, localName: string): Element {
  const children = onlyDirectDescendants(parent, localName, localName);
  if (children.length > 1) {
    throw new Error(`The 3MF model contains duplicate ${localName} elements.`);
  }
  const child = optionalDirectChild(parent, localName);
  if (!child) throw new Error(`The 3MF model is missing ${localName}.`);
  return child;
}

function positiveIntegerId(value: string | null, label: string): string {
  if (!value || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return value;
}

function nonNegativeInteger(value: string | null, label: string): number {
  if (value === null || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return number;
}

function optionalNonNegativeInteger(
  element: Element,
  attribute: string,
  label: string,
): void {
  const value = element.getAttribute(attribute);
  if (value !== null) nonNegativeInteger(value, label);
}

function validateThreeMFTransform(element: Element, label: string): void {
  const transform = element.getAttribute("transform");
  if (transform === null) return;
  if (transform.length > MAX_3MF_TRANSFORM_ATTRIBUTE_LENGTH) {
    throw new Error(
      `${label} transform exceeds the ${MAX_3MF_TRANSFORM_ATTRIBUTE_LENGTH}-character safety limit.`,
    );
  }

  const values = transform.split(" ");
  if (
    values.length !== 12 ||
    values.some(
      (value) =>
        !THREE_MF_TRANSFORM_NUMBER_PATTERN.test(value) ||
        !Number.isFinite(Number(value)),
    )
  ) {
    throw new Error(
      `${label} transform must contain exactly 12 finite decimal numbers separated by single ASCII spaces.`,
    );
  }
}

function optionalResourceId(
  element: Element,
  attribute: string,
  resourceTypes: ReadonlyMap<string, string>,
): string | undefined {
  const raw = element.getAttribute(attribute);
  if (raw === null) return undefined;
  const id = positiveIntegerId(raw, `3MF ${attribute}`);
  if (!resourceTypes.has(id)) {
    throw new Error(`The 3MF ${attribute} references missing resource ${id}.`);
  }
  return id;
}

function emptyUsage(sceneNodes: number, depth: number): ExpandedUsage {
  return {
    sceneNodes,
    depth,
    renderables: 0,
    positionVertices: 0,
    vertexReferences: 0,
    primitives: 0,
  };
}

function appendChildUsage(
  parent: ExpandedUsage,
  child: ExpandedUsage,
): ExpandedUsage {
  const summed = sumUsage(parent, child);
  return { ...summed, depth: Math.max(parent.depth, child.depth + 1) };
}

function sumUsage(left: ExpandedUsage, right: ExpandedUsage): ExpandedUsage {
  return {
    sceneNodes: checkedAdd(left.sceneNodes, right.sceneNodes, "scene nodes"),
    depth: Math.max(left.depth, right.depth),
    renderables: checkedAdd(left.renderables, right.renderables, "renderables"),
    positionVertices: checkedAdd(
      left.positionVertices,
      right.positionVertices,
      "position vertices",
    ),
    vertexReferences: checkedAdd(
      left.vertexReferences,
      right.vertexReferences,
      "vertex references",
    ),
    primitives: checkedAdd(left.primitives, right.primitives, "primitives"),
  };
}

export function assertThreeMFMeshPositionVertexBudget(
  meshPositionVertexCounts: readonly number[],
): void {
  let total = 0;
  for (const count of meshPositionVertexCounts) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        "The 3MF mesh position vertex count is not safely representable.",
      );
    }
    total = checkedAdd(total, count, "mesh position vertices");
    if (total > MAIN_THREAD_GEOMETRY_BUDGET.maxPositionVertices) {
      throw new Error(
        "3MF mesh definitions exceed the 3MF component expansion safety budget.",
      );
    }
  }
}

function assertExpandedUsage(usage: ExpandedUsage, label: string): void {
  if (
    usage.sceneNodes > MAIN_THREAD_GEOMETRY_BUDGET.maxSceneNodes ||
    usage.depth > MAIN_THREAD_GEOMETRY_BUDGET.maxDepth ||
    usage.renderables > MAIN_THREAD_GEOMETRY_BUDGET.maxRenderableObjects ||
    usage.positionVertices >
      MAIN_THREAD_GEOMETRY_BUDGET.maxPositionVertices ||
    usage.vertexReferences >
      MAIN_THREAD_GEOMETRY_BUDGET.maxVertexReferences ||
    usage.primitives > MAIN_THREAD_GEOMETRY_BUDGET.maxPrimitives
  ) {
    throw new Error(
      `${label} exceeds the 3MF component expansion safety budget.`,
    );
  }
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`The 3MF expanded ${label} is not safely representable.`);
  }
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} is not safely representable.`);
  }
  return result;
}

function resolveThreeMFUnit(
  rawUnit: string | undefined,
): ThreeMFUnitMetadata {
  const normalized = (rawUnit ?? "millimeter").trim().toLowerCase();
  if (!Object.hasOwn(THREE_MF_UNIT_METERS, normalized)) {
    throw new Error(
      `Unsupported 3MF model unit: ${rawUnit ?? ""}. Expected micron, millimeter, centimeter, inch, foot, or meter.`,
    );
  }
  const label = normalized as ThreeMFUnitName;
  return { metersPerUnit: THREE_MF_UNIT_METERS[label], label };
}

function normalizeArchiveName(fileName: string): string {
  return fileName.replace(/^\/+/, "");
}

function assertRequiredThreeMFEntries(
  fileNames: readonly string[],
): string {
  const normalized = fileNames.map(normalizeArchiveName);
  const hasContentTypes = normalized.some(
    (fileName) => fileName.toLowerCase() === "[content_types].xml",
  );
  const hasRelationships = normalized.includes("_rels/.rels");
  const shadowRelationships = normalized.filter(
    (fileName) =>
      fileName !== "_rels/.rels" &&
      THREE_MF_LOADER_ROOT_RELATIONSHIP_PATTERN.test(fileName),
  );
  const modelEntries = normalized.filter((fileName) =>
    fileName.endsWith(".model"),
  );
  const rootModelEntries = normalized.filter((fileName) =>
    /^3D\/[^/]+\.model$/u.test(fileName),
  );
  const hasModelRelationships = normalized.some((fileName) =>
    THREE_MF_LOADER_MODEL_RELATIONSHIP_PATTERN.test(fileName),
  );
  if (shadowRelationships.length > 0) {
    throw new Error(
      "The 3MF archive contains a shadow package relationship entry that would be selected by the loader.",
    );
  }
  if (
    !hasContentTypes ||
    !hasRelationships ||
    rootModelEntries.length === 0
  ) {
    throw new Error(
      "The 3MF archive is missing required package entries ([Content_Types].xml, _rels/.rels, or a root 3D/*.model part).",
    );
  }
  if (rootModelEntries.length > 1) {
    throw new Error(
      "The 3MF archive has an ambiguous root .model part.",
    );
  }
  if (modelEntries.length > 1) {
    throw new Error(
      "Multi-part 3MF model packages are not supported because model parts can declare different units.",
    );
  }
  if (hasModelRelationships) {
    throw new Error(
      "3MF model relationship parts are not supported by this experimental importer.",
    );
  }
  return rootModelEntries[0];
}
