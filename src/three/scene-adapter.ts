import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformMode } from "../app/editor-store";
import type { CameraModel, DeepReadonly, SceneSnapshot, TransformModel, Vec3Model } from "../model/scene-model";
import { calculateCameraFit } from "./camera-fit";
import { ImportedAssetStore } from "./imported-asset-store";
import type { MaterialImageAssetStore } from "./material/image-asset-store";
import { SceneGraphAdapter } from "./scene-graph-adapter";
import { SceneInteractionAdapter } from "./scene-interaction-adapter";
import { createNeutralEnvironment, type NeutralEnvironment } from "./material/neutral-environment";
import { DemandRenderer } from "./demand-renderer";
import { AnimationPlayer } from "./animation-player";
import { createExportSnapshot, downloadBlob } from "./scene-export";
import { ViewportTools } from "../ui/viewport-tools";
import { prepareHdrEnvironment } from "./hdr-environment";
import { configureGLTFRenderer } from "../importers/gltf-decoders";

interface CameraPose {
  position: Vec3Model;
  target: Vec3Model;
  near: number;
  far: number;
  projection: "perspective" | "orthographic";
  up: Vec3Model;
  orthographicHeight?: number;
}
interface SceneAdapterOptions {
  onImportedNodeSelected?: (rootId: string, nodeId: string) => void;
  onShadowsChanged?: (enabled: boolean) => void;
  importedAssets?: ImportedAssetStore;
  materialImages?: MaterialImageAssetStore;
  onCameraInteractionEnd: (pose: CameraPose) => void;
  onObjectSelected: (objectId: string | null) => void;
  onObjectTransformCommitted: (objectId: string, transform: TransformModel) => void;
}
const DEFAULT_MIN_DISTANCE = 2.5;
const DEFAULT_MAX_DISTANCE = 45;
type View = "front" | "back" | "left" | "right" | "top" | "bottom" | "isometric";

export class SceneAdapter {
  readonly #scene = new THREE.Scene();
  #camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #environment: NeutralEnvironment;
  #controls: OrbitControls;
  readonly #sceneGraph: SceneGraphAdapter;
  readonly #interaction: SceneInteractionAdapter;
  readonly #resizeObserver: ResizeObserver;
  readonly #grid = new THREE.GridHelper(24, 24, 0x526078, 0x303846);
  readonly #axes = new THREE.AxesHelper(2.5);
  readonly #container: HTMLElement;
  readonly #onCameraInteractionEnd: (pose: CameraPose) => void;
  readonly #demand: DemandRenderer;
  readonly #player = new AnimationPlayer();
  readonly #abort = new AbortController();
  readonly #measurement = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd166, depthTest: false }));
  readonly #points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffd166, size: 8, sizeAttenuation: false, depthTest: false }));
  #tools: ViewportTools | undefined;
  #model: SceneSnapshot;
  #selectedId: string | null = null;
  #clipEntries: { root: THREE.Object3D; clip: THREE.AnimationClip }[] = [];
  #measuring = false;
  #measurePoints: THREE.Vector3[] = [];
  #pixelRatio = 2;
  #fov = 45;
  #orthographicHeight = 10;
  #frameCount = 0;
  #lastStatsTime = 0;
  #importDuration: number | null = null;
  #disposed = false;
  #environmentGeneration = 0;
  #ownedEnvironment: THREE.Texture | null = null;

  constructor(container: HTMLElement, model: SceneSnapshot, options: SceneAdapterOptions) {
    this.#container = container; this.#model = model;
    this.#pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.#onCameraInteractionEnd = options.onCameraInteractionEnd;
    this.#camera = new THREE.PerspectiveCamera(model.camera.fov, 1, model.camera.near, model.camera.far);
    this.#renderer = this.#createRenderer();
    this.#renderer.shadowMap.enabled = model.shadowsEnabled;
    configureGLTFRenderer(this.#renderer);
    options.materialImages?.setMaxTextureSize(this.#renderer.capabilities.maxTextureSize);
    this.#environment = createNeutralEnvironment(this.#renderer);
    this.#scene.environment = this.#environment.texture;
    this.#demand = new DemandRenderer((delta) => this.#render(delta));
    this.#controls = this.#createControls(model.camera);
    this.#sceneGraph = new SceneGraphAdapter(this.#scene, options.importedAssets, options.materialImages);
    this.#interaction = new SceneInteractionAdapter(this.#scene, this.#camera, this.#renderer.domElement, this.#sceneGraph, this.#controls, {
      onObjectSelected: options.onObjectSelected,
      onImportedNodeSelected: options.onImportedNodeSelected,
      onObjectTransformCommitted: options.onObjectTransformCommitted,
      onRenderRequested: () => this.requestRender(),
      isPointVisible: (point) => this.#renderer.clippingPlanes.every((plane) => plane.distanceToPoint(point) >= 0),
      onSurfacePicked: (intersection) => this.#pickMeasurement(intersection),
    });
    this.#measurement.renderOrder = 1001; this.#points.renderOrder = 1002;
    this.#scene.add(this.#grid, this.#axes, this.#measurement, this.#points);
    this.#container.append(this.#renderer.domElement);
    this.#tools = new ViewportTools(container, {
      png: async (helpers) => downloadBlob(await this.exportPng(helpers), "render-viewer.png"),
      glb: async () => downloadBlob(await this.exportGlb(), "render-viewer.glb"),
      projection: (projection) => { this.#switchProjection(projection); this.#commitCamera(); },
      view: (view) => this.setStandardView(view),
      fit: () => { if (this.#selectedId) this.fitToObject(this.#selectedId); },
      clipping: (axis, offset, reverse) => this.setClipping(axis, offset, reverse),
      measure: (enabled) => { this.#measuring = enabled; this.#syncTransformEnabled(); this.requestRender(); },
      clearMeasurement: () => this.clearMeasurement(),
      clip: (index) => this.#selectClip(index),
      play: () => { this.#player.play(); this.requestRender(); },
      pause: () => { this.#player.pause(); this.requestRender(); },
      stop: () => this.#selectClip(-1),
      seek: (time) => { this.#player.seek(time); this.requestRender(); },
      speed: (speed) => this.#player.setSpeed(speed),
      quality: (ratio, shadows) => { this.#pixelRatio = ratio; this.#renderer.shadowMap.enabled = shadows; options.onShadowsChanged?.(shadows); this.#resize(); },
    });
    this.#tools.setPixelRatio(this.#pixelRatio);
    this.applyModel(model);
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(container); this.#resize();
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.#demand.pause(); else this.requestRender(); }, { signal: this.#abort.signal });
    window.addEventListener("pageshow", () => this.requestRender(), { signal: this.#abort.signal });
    this.#renderer.domElement.addEventListener("webglcontextrestored", () => this.requestRender(), { signal: this.#abort.signal });
  }

  requestRender(): void { if (!this.#disposed && !document.hidden) this.#demand.request(); }
  setLocale(locale: "ja" | "en"): void { this.#tools?.setLocale(locale); }
  setImportDuration(milliseconds: number): void { if (Number.isFinite(milliseconds)) this.#importDuration = milliseconds; this.requestRender(); }
  getRenderCount(): number { return this.#frameCount; }
  /** Exposure and environment are preview settings; caller persists descriptors when needed. */
  setExposure(exposure: number): void { if (Number.isFinite(exposure)) this.#renderer.toneMappingExposure = Math.max(0, Math.min(10, exposure)); this.requestRender(); }
  prepareEnvironment(file: File): Promise<THREE.Texture> { return prepareHdrEnvironment(file); }
  async loadEnvironment(file: File | null): Promise<void> {
    const generation = ++this.#environmentGeneration;
    if (!file) { this.setEnvironment(null); return; }
    const texture = await prepareHdrEnvironment(file);
    if (this.#disposed || generation !== this.#environmentGeneration) { texture.dispose(); return; }
    this.setEnvironment(texture);
  }
  setEnvironment(texture: THREE.Texture | null): void {
    this.#environmentGeneration++;
    if (this.#ownedEnvironment === texture && texture !== null) { this.requestRender(); return; }
    this.#ownedEnvironment?.dispose(); this.#ownedEnvironment = texture;
    if (texture) texture.mapping = THREE.EquirectangularReflectionMapping;
    this.#scene.environment = texture ?? this.#environment.texture; this.requestRender();
  }

  applyModel(model: SceneSnapshot): void {
    // Release mixer bindings before a replaced/deleted asset can be disposed.
    const animatedRoot = this.#player.root;
    if (animatedRoot && !model.imports.some((item) => item.id === this.#selectedId && item.assetId === this.#model.imports.find((previous) => previous.id === item.id)?.assetId)) this.#selectClip(-1);
    const shadowsChanged = this.#model.shadowsEnabled !== model.shadowsEnabled;
    this.#model = model;
    this.#scene.background = new THREE.Color(model.backgroundColor);
    this.setExposure(model.exposure ?? 1.05);
    if (shadowsChanged) this.#renderer.shadowMap.enabled = model.shadowsEnabled;
    this.#tools?.setShadows(this.#renderer.shadowMap.enabled);
    this.#grid.visible = model.helpers.gridVisible; this.#axes.visible = model.helpers.axesVisible;
    this.#applyCamera(model.camera);
    this.#sceneGraph.applyModel(model.objects, model.lights, model.materials, model.imports);
    this.#interaction.refreshSelection(); this.#refreshClips(); this.requestRender();
  }
  setSelection(objectId: string | null): void {
    if (this.#selectedId !== objectId) this.#selectClip(-1);
    this.#selectedId = objectId; this.#interaction.setSelection(objectId); this.#refreshClips(); this.requestRender();
  }
  resetCameraConstraints(): void { this.#controls.minDistance = DEFAULT_MIN_DISTANCE; this.#controls.maxDistance = DEFAULT_MAX_DISTANCE; }
  setTransformMode(mode: TransformMode): void { this.#interaction.setTransformMode(mode); this.requestRender(); }

  fitToObject(objectId: string): boolean {
    const object = this.#sceneGraph.getObjectById(objectId); if (!object) return false;
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object, true);
    let fit;
    try { fit = calculateCameraFit(bounds, this.#fov, this.#aspect(), this.#camera.position.clone().sub(this.#controls.target)); } catch { return false; }
    this.#camera.position.copy(fit.position); this.#camera.near = fit.near; this.#camera.far = fit.far;
    this.#orthographicHeight = 2 * fit.position.distanceTo(fit.target) * Math.tan(THREE.MathUtils.degToRad(this.#fov / 2));
    this.#camera.zoom = 1;
    this.#controls.target.copy(fit.target); this.#controls.minDistance = fit.minDistance; this.#controls.maxDistance = fit.maxDistance;
    this.#updateProjection(); this.#controls.update(); this.#commitCamera(); this.requestRender(); return true;
  }
  setStandardView(view: View): void {
    const direction = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], isometric: [1, 1, 1] }[view];
    const distance = Math.max(this.#camera.position.distanceTo(this.#controls.target), 0.001);
    this.#camera.up.set(0, 1, 0);
    if (view === "top") this.#camera.up.set(0, 0, -1);
    if (view === "bottom") this.#camera.up.set(0, 0, 1);
    this.#camera.position.copy(this.#controls.target).add(new THREE.Vector3(...direction).normalize().multiplyScalar(distance));
    this.#replaceControlsForUp();
    this.#camera.lookAt(this.#controls.target); this.#controls.update(); this.#commitCamera(); this.requestRender();
  }
  setClipping(axis: "off" | "x" | "y" | "z", offset: number, reverse = false): void {
    if (!Number.isFinite(offset)) return;
    const planes: THREE.Plane[] = [];
    if (axis !== "off") { const normal = new THREE.Vector3(); normal[axis] = reverse ? -1 : 1; planes.push(new THREE.Plane(normal, -offset * (reverse ? -1 : 1))); }
    this.#renderer.clippingPlanes = planes; this.requestRender();
  }
  clearMeasurement(): void {
    this.#measurePoints = [];
    this.#measurement.geometry.dispose(); this.#measurement.geometry = new THREE.BufferGeometry();
    this.#points.geometry.dispose(); this.#points.geometry = new THREE.BufferGeometry();
    this.#tools?.setMeasurement(null, 0); this.requestRender();
  }
  async exportPng(includeHelpers = false): Promise<Blob> {
    const helpers = [this.#grid, this.#axes, this.#measurement, this.#points, ...this.#interaction.getHelpers()];
    const visible = helpers.map((helper) => helper.visible);
    try {
      if (!includeHelpers) helpers.forEach((helper) => { helper.visible = false; });
      this.#renderer.render(this.#scene, this.#camera);
      // toBlob captures synchronously before helpers are restored or another frame renders.
      return await new Promise<Blob>((resolve, reject) => this.#renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed")), "image/png"));
    } finally { helpers.forEach((helper, index) => { helper.visible = visible[index]!; }); this.requestRender(); }
  }
  async exportGlb(): Promise<Blob> {
    const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
    const roots = [...this.#model.objects, ...this.#model.imports].map((model) => this.#sceneGraph.getObjectById(model.id)).filter((root): root is THREE.Object3D => Boolean(root?.visible));
    const snapshot = createExportSnapshot(roots);
    const decompressed: THREE.Texture[] = [];
    try {
      const textureUtils = await import("three/addons/utils/WebGLTextureUtils.js");
      const data = await new GLTFExporter().setTextureUtils({ decompress: (texture, size) => { const readable = textureUtils.decompress(texture as THREE.CompressedTexture, size); decompressed.push(readable); return readable; } }).parseAsync(snapshot.scene, { binary: true, animations: snapshot.clips, onlyVisible: true });
      if (!(data instanceof ArrayBuffer)) throw new Error("GLB export returned an unexpected format");
      return new Blob([data], { type: "model/gltf-binary" });
    } finally { snapshot.dispose(); decompressed.forEach((texture) => texture.dispose()); }
  }
  dispose(): void {
    this.#disposed = true; this.#demand.dispose(); this.#abort.abort(); this.#player.clear(); this.#tools?.dispose();
    configureGLTFRenderer(null); this.#resizeObserver.disconnect(); this.#interaction.dispose(); this.#controls.dispose();
    this.#sceneGraph.dispose();
    for (const object of [this.#grid, this.#axes, this.#measurement, this.#points]) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); }
    this.#scene.environment = null; this.#ownedEnvironment?.dispose(); this.#environment.dispose(); this.#renderer.dispose(); this.#renderer.domElement.remove();
  }
  #createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.domElement.className = "viewport-canvas"; renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "3D viewport: drag to orbit, right drag to pan, wheel to zoom");
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; return renderer;
  }
  #createControls(model: DeepReadonly<CameraModel>): OrbitControls {
    const controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    controls.target.set(model.target.x, model.target.y, model.target.z); controls.enableDamping = false;
    controls.minDistance = DEFAULT_MIN_DISTANCE; controls.maxDistance = DEFAULT_MAX_DISTANCE;
    controls.maxPolarAngle = Math.PI; controls.screenSpacePanning = true;
    controls.addEventListener("change", () => this.requestRender());
    controls.addEventListener("end", () => this.#commitCamera()); return controls;
  }
  #switchProjection(projection: "perspective" | "orthographic"): void {
    if ((this.#camera instanceof THREE.OrthographicCamera) === (projection === "orthographic")) return;
    const old = this.#camera;
    if (projection === "orthographic") this.#orthographicHeight = 2 * old.position.distanceTo(this.#controls.target) * Math.tan(THREE.MathUtils.degToRad(this.#fov / 2));
    this.#camera = projection === "orthographic" ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera(this.#fov);
    this.#camera.position.copy(old.position); this.#camera.quaternion.copy(old.quaternion); this.#camera.up.copy(old.up);
    this.#camera.near = old.near; this.#camera.far = old.far;
    this.#controls.object = this.#camera; this.#interaction.setCamera(this.#camera); this.#updateProjection(); this.#controls.update();
    this.#tools?.setProjection(projection); this.requestRender();
  }
  #applyCamera(model: DeepReadonly<CameraModel>): void {
    this.#fov = model.fov; this.#switchProjection(model.projection ?? "perspective");
    if (model.orthographicHeight && Number.isFinite(model.orthographicHeight)) this.#orthographicHeight = model.orthographicHeight;
    const up = model.up ?? { x: 0, y: 1, z: 0 };
    if (this.#camera.up.x !== up.x || this.#camera.up.y !== up.y || this.#camera.up.z !== up.z) {
      this.#camera.up.set(up.x, up.y, up.z); this.#replaceControlsForUp();
    }
    this.#camera.near = model.near; this.#camera.far = model.far; this.#camera.zoom = 1;
    this.#camera.position.set(model.position.x, model.position.y, model.position.z);
    this.#controls.target.set(model.target.x, model.target.y, model.target.z); this.#updateProjection(); this.#controls.update();
  }
  #replaceControlsForUp(): void {
    const old = this.#controls;
    const target = old.target.clone();
    const min = old.minDistance, max = old.maxDistance;
    old.dispose();
    this.#controls = this.#createControls(this.#model.camera);
    this.#controls.target.copy(target); this.#controls.minDistance = min; this.#controls.maxDistance = max;
    this.#interaction.setOrbitControls(this.#controls);
  }
  #commitCamera(): void {
    const orthographic = this.#camera instanceof THREE.OrthographicCamera;
    this.#onCameraInteractionEnd({ up: this.#toVec3Model(this.#camera.up), position: this.#toVec3Model(this.#camera.position), target: this.#toVec3Model(this.#controls.target), near: this.#camera.near, far: this.#camera.far, projection: orthographic ? "orthographic" : "perspective", ...(orthographic ? { orthographicHeight: this.#orthographicHeight / this.#camera.zoom } : {}) });
  }
  #aspect(): number { return Math.max(1, this.#container.clientWidth) / Math.max(1, this.#container.clientHeight); }
  #updateProjection(): void {
    if (this.#camera instanceof THREE.PerspectiveCamera) { this.#camera.fov = this.#fov; this.#camera.aspect = this.#aspect(); }
    else { const half = Math.max(1e-8, this.#orthographicHeight / 2); this.#camera.top = half; this.#camera.bottom = -half; this.#camera.left = -half * this.#aspect(); this.#camera.right = half * this.#aspect(); }
    this.#camera.updateProjectionMatrix();
  }
  #resize(): void {
    const width = Math.max(1, Math.floor(this.#container.clientWidth)); const height = Math.max(1, Math.floor(this.#container.clientHeight));
    this.#renderer.setPixelRatio(this.#pixelRatio); this.#renderer.setSize(width, height, false);
    this.#updateProjection(); this.requestRender();
  }
  #render(delta: number): boolean {
    this.#player.update(delta);
    if (this.#player.root) this.#interaction.refreshSelection();
    this.#renderer.render(this.#scene, this.#camera); this.#frameCount++;
    this.#tools?.setPlayback(this.#player.time, this.#player.duration, this.#player.playing);
    const now = performance.now();
    if (!this.#player.playing || now - this.#lastStatsTime >= 250) {
      this.#lastStatsTime = now;
      const info = this.#renderer.info;
      this.#tools?.setStats(`Draw calls: ${info.render.calls} · Triangles: ${info.render.triangles.toLocaleString()}\nGeometry: ${info.memory.geometries} · Textures: ${info.memory.textures}\nFrames: ${this.#frameCount}${this.#importDuration === null ? "" : ` · Import: ${this.#importDuration.toFixed(0)} ms`}`);
    }
    return this.#player.playing;
  }
  #refreshClips(): void {
    const root = this.#selectedId ? this.#sceneGraph.getObjectById(this.#selectedId) : undefined;
    const entries: { root: THREE.Object3D; clip: THREE.AnimationClip }[] = [];
    root?.traverse((node) => { for (const clip of node.animations) entries.push({ root: node, clip }); });
    this.#clipEntries = entries;
    this.#tools?.setClips(entries.map(({ clip }) => clip.name || "Animation"));
  }
  #selectClip(index: number): void {
    this.#tools?.setSelectedClip(index);
    this.#player.clear();
    const entry = this.#clipEntries[index]; if (entry) this.#player.select(entry.root, entry.clip);
    this.#syncTransformEnabled(); this.requestRender();
  }
  #syncTransformEnabled(): void { this.#interaction.setTransformEnabled(!this.#measuring && this.#player.root === null); }
  #pickMeasurement(intersection: THREE.Intersection | undefined): boolean {
    if (!this.#measuring) return false;
    if (!intersection || !(intersection.object instanceof THREE.Mesh)) return true;
    if (this.#measurePoints.length === 2) this.clearMeasurement();
    this.#measurePoints.push(intersection.point.clone());
    this.#measurement.geometry.dispose(); this.#measurement.geometry = new THREE.BufferGeometry().setFromPoints(this.#measurePoints);
    this.#points.geometry.dispose(); this.#points.geometry = new THREE.BufferGeometry().setFromPoints(this.#measurePoints);
    this.#tools?.setMeasurement(this.#measurePoints.length === 2 ? this.#measurePoints[0]!.distanceTo(this.#measurePoints[1]!) : null, this.#measurePoints.length);
    this.requestRender(); return true;
  }
  #toVec3Model(vector: THREE.Vector3): Vec3Model { return { x: Number(vector.x.toFixed(8)), y: Number(vector.y.toFixed(8)), z: Number(vector.z.toFixed(8)) }; }
}
