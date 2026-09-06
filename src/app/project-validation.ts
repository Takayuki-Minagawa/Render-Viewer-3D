import { createDefaultSceneModel } from "../model/default-scene";
import { migrateSceneModel } from "../model/material/material-migration";
import { normalizeMaterialColorMap } from "../model/material/material-color-map";
import type { SceneModel } from "../model/scene-model";

type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as RecordValue;
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) throw new Error("Invalid text field.");
  return value;
}
function number(value: unknown, min = -1e9, max = 1e9): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Invalid numeric field.");
  return value;
}
function bool(value: unknown): void { if (typeof value !== "boolean") throw new Error("Invalid boolean field."); }
function list(value: unknown, max = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid or oversized list.");
  return value;
}
function vector(value: unknown, min = -1e9, max = 1e9): void {
  const v = record(value); for (const key of ["x", "y", "z"]) number(v[key], min, max);
}
function transform(value: unknown): void {
  const v = record(value); vector(v.position); vector(v.rotationDegrees); vector(v.scale, 0.000001, 1000);
}
function color(value: unknown): void {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Invalid color.");
}
/** Bound recursion, total properties and non-finite values before model-specific use. */
export function validateJsonTree(value: unknown): void {
  let count = 0;
  const walk = (node: unknown, depth: number): void => {
    if (++count > 1_000_000 || depth > 256) throw new Error("Project structure limit exceeded.");
    if (typeof node === "number") { if (!Number.isFinite(node)) throw new Error("Non-finite project value."); }
    else if (typeof node === "string") { if (node.length > 1_000_000) throw new Error("Oversized project string."); }
    else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (child === undefined && !Array.isArray(node)) continue;
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid project key.");
        walk(child, depth + 1);
      }
    } else if (node !== null && typeof node !== "boolean") throw new Error("Invalid JSON value.");
  };
  walk(value, 0);
}
function shape(value: unknown, template: unknown): void {
  if (template === null) return; // Nullable/extension slots contain already bounded JSON.
  if (Array.isArray(template)) {
    const values = list(value);
    if (template.length) { if (values.length !== template.length) throw new Error("Invalid tuple."); values.forEach((v, i) => shape(v, template[i])); }
  } else if (typeof template === "object") {
    const v = record(value);
    for (const [key, child] of Object.entries(record(template))) shape(v[key], child);
  } else if (typeof value !== typeof template) throw new Error("Missing or invalid model field.");
}

export function validateScene(source: unknown): SceneModel {
  validateJsonTree(source);
  const raw = record(source);
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new Error("Unsupported scene version.");
  // Validate legacy material leaves before migration accesses them.
  if (raw.schemaVersion === 1) for (const object of list(raw.objects)) {
    const material = record(record(object).material); color(material.color); number(material.metalness, 0, 1); number(material.roughness, 0, 1);
  }
  const model = migrateSceneModel(raw as unknown as SceneModel);
  const defaults = createDefaultSceneModel();
  text(model.name); color(model.backgroundColor); bool(model.shadowsEnabled);
  if (model.exposure !== undefined) number(model.exposure, 0, 10);
  if (model.environment != null) { text(record(model.environment).assetId); text(record(model.environment).name); }
  shape(model.helpers, defaults.helpers);
  const camera = record(model.camera);
  vector(camera.position); vector(camera.target); number(camera.fov, 1, 179);
  if (camera.up !== undefined) {
    vector(camera.up, -1, 1);
    if (Object.values(record(camera.up)).reduce<number>((sum, n) => sum + Number(n) ** 2, 0) < 1e-12) throw new Error("Camera up must be nonzero.");
  }
  number(camera.near, 0.000001); number(camera.far, number(camera.near) + 0.000001);
  if (camera.projection !== undefined && !["perspective", "orthographic"].includes(String(camera.projection))) throw new Error("Invalid projection.");
  if (camera.orthographicHeight !== undefined) number(camera.orthographicHeight, 0.000001);
  const materialIds = new Set<string>();
  const colorImageIds = new Set<string>(); const numericImageIds = new Set<string>();
  for (const entry of list(model.materials)) {
    const material = record(entry); const id = text(material.id);
    if (materialIds.has(id)) throw new Error("Duplicate material id."); materialIds.add(id);
    text(material.name); shape(material.preview, defaults.materials[0].preview);
    text(material.category);
    for (const tag of list(material.tags, 256)) text(tag);
    if (material.presetId !== null && !["matte", "matte-plastic", "glossy-plastic", "metal", "glass", "frosted-glass", "wood-base", "concrete"].includes(String(material.presetId))) throw new Error("Invalid material preset.");
    shape(material.pov, defaults.materials[0].pov);
    color(record(material.preview).baseColor);
    if (material.colorMap !== null && !normalizeMaterialColorMap(material.colorMap as Parameters<typeof normalizeMaterialColorMap>[0])) throw new Error("Invalid image descriptor.");
    if (material.colorMap) colorImageIds.add(text(record(material.colorMap).assetId));
    if (material.maps !== undefined) for (const [channel, descriptor] of Object.entries(record(material.maps))) {
      if (!["normal", "roughness", "metalness", "ao"].includes(channel) || !normalizeMaterialColorMap(descriptor as Parameters<typeof normalizeMaterialColorMap>[0])) throw new Error("Invalid PBR image descriptor.");
      numericImageIds.add(text(record(descriptor).assetId));
    }
  }
  if ([...colorImageIds].some(id => numericImageIds.has(id))) throw new Error("Color and numeric images must have separate asset ids.");
  const objectIds = new Set<string>();
  let primitiveVertices = 0;
  for (const entry of list(model.objects)) {
    const object = record(entry); const id = text(object.id);
    if (objectIds.has(id)) throw new Error("Duplicate object id."); objectIds.add(id);
    text(object.name); bool(object.visible); bool(object.castShadow); bool(object.receiveShadow); transform(object.transform);
    if (!materialIds.has(text(object.materialId))) throw new Error("Missing object material.");
    const geometry = record(object.geometry);
    const fields: Record<string, string[]> = { box: ["width", "height", "depth"], sphere: ["radius", "widthSegments", "heightSegments"], cylinder: ["radiusTop", "radiusBottom", "height", "radialSegments"], cone: ["radius", "height", "radialSegments"], plane: ["width", "height"], torus: ["radius", "tubeRadius", "radialSegments", "tubularSegments"] };
    const keys = fields[text(geometry.type)]; if (!keys) throw new Error("Unsupported geometry.");
    for (const key of keys) {
      const minimum = key === "heightSegments" && geometry.type === "sphere" ? 2 : key.endsWith("Segments") ? 3 : 0;
      const value = number(geometry[key], minimum, key.endsWith("Segments") ? 256 : 10000);
      if (key.endsWith("Segments") && !Number.isInteger(value)) throw new Error("Invalid segment count.");
    }
    primitiveVertices += geometry.type === "sphere" ? (Number(geometry.widthSegments) + 1) * (Number(geometry.heightSegments) + 1) :
      geometry.type === "torus" ? (Number(geometry.radialSegments) + 1) * (Number(geometry.tubularSegments) + 1) : (Number(geometry.radialSegments) || 6) * 8;
    if (primitiveVertices > 2_000_000) throw new Error("Primitive geometry budget exceeded.");
  }
  const assetIds = new Set<string>();
  for (const entry of list(model.imports, 1000)) {
    const imported = record(entry); const id = text(imported.id); const assetId = text(imported.assetId);
    if (objectIds.has(id) || assetIds.has(assetId)) throw new Error("Duplicate imported object or asset.");
    objectIds.add(id); assetIds.add(assetId); text(imported.name); text(imported.format); bool(imported.visible); transform(imported.transform);
    if (!["imported", "custom"].includes(String(imported.materialMode))) throw new Error("Invalid material mode.");
    if (imported.customMaterialId !== null && !materialIds.has(text(imported.customMaterialId))) throw new Error("Missing imported material.");
    if (imported.materialMode === "custom" && imported.customMaterialId === null) throw new Error("Missing custom material.");
    const metadata = record(imported.metadata); text(metadata.fileName); text(metadata.format); number(metadata.sizeBytes, 0);
    for (const key of ["objectCount", "triangleCount", "materialCount"]) number(metadata[key], 0);
    for (const warning of list(imported.warnings)) { text(record(warning).code); text(record(warning).message); }
    let count = 0;
    const ids = new Set<string>();
    const walk = (nodes: unknown): void => { for (const node of list(nodes)) {
      if (++count > 10000) throw new Error("Hierarchy limit exceeded.");
      const n = record(node); const nodeId = text(n.id); if (ids.has(nodeId)) throw new Error("Duplicate hierarchy node."); ids.add(nodeId);
      text(n.name); text(n.objectType); bool(n.mesh); number(n.triangleCount, 0); walk(n.children);
    } };
    walk(imported.hierarchy);
    if (imported.nodeOverrides !== undefined) for (const [nodeId, rawOverride] of Object.entries(record(imported.nodeOverrides))) {
      if (!ids.has(nodeId)) throw new Error("Unknown node override.");
      const override = record(rawOverride);
      if (Object.keys(override).some(key => !["visible", "materialId"].includes(key))) throw new Error("Invalid node override property.");
      if (override.visible !== undefined) bool(override.visible);
      if (override.materialId !== undefined && !materialIds.has(text(override.materialId))) throw new Error("Missing node material.");
    }
    if (imported.isolatedNodeId != null && !ids.has(text(imported.isolatedNodeId))) throw new Error("Unknown isolated node.");
  }
  const lightIds = new Set<string>();
  for (const entry of list(model.lights, 32)) {
    const light = record(entry); const id = text(light.id); if (lightIds.has(id)) throw new Error("Duplicate light id."); lightIds.add(id);
    text(light.name); color(light.color); number(light.intensity, 0, 1000); bool(light.enabled);
    if (light.type === "directional") { vector(light.position); vector(light.target); bool(light.castShadow); }
    else if (light.type !== "ambient") throw new Error("Unsupported light.");
  }
  return model;
}
