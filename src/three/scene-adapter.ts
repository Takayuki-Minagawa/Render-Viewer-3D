import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TransformMode } from "../app/editor-store";
import type {
  CameraModel,
  DeepReadonly,
  SceneSnapshot,
  TransformModel,
  Vec3Model,
} from "../model/scene-model";
import { SceneGraphAdapter } from "./scene-graph-adapter";
import { SceneInteractionAdapter } from "./scene-interaction-adapter";

interface CameraPose {
  position: Vec3Model;
  target: Vec3Model;
}

interface SceneAdapterOptions {
  onCameraInteractionEnd: (pose: CameraPose) => void;
  onObjectSelected: (objectId: string | null) => void;
  onObjectTransformCommitted: (
    objectId: string,
    transform: TransformModel,
  ) => void;
}

export class SceneAdapter {
  readonly #scene = new THREE.Scene();
  readonly #camera: THREE.PerspectiveCamera;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #controls: OrbitControls;
  readonly #sceneGraph: SceneGraphAdapter;
  readonly #interaction: SceneInteractionAdapter;
  readonly #resizeObserver: ResizeObserver;
  readonly #grid = new THREE.GridHelper(24, 24, 0x526078, 0x303846);
  readonly #axes = new THREE.AxesHelper(2.5);
  readonly #container: HTMLElement;
  readonly #onCameraInteractionEnd: (pose: CameraPose) => void;

  constructor(
    container: HTMLElement,
    model: SceneSnapshot,
    options: SceneAdapterOptions,
  ) {
    this.#container = container;
    this.#onCameraInteractionEnd = options.onCameraInteractionEnd;
    this.#camera = this.#createCamera(model.camera);
    this.#renderer = this.#createRenderer();
    this.#controls = this.#createControls(model.camera);
    this.#sceneGraph = new SceneGraphAdapter(this.#scene);
    this.#interaction = new SceneInteractionAdapter(
      this.#scene,
      this.#camera,
      this.#renderer.domElement,
      this.#sceneGraph,
      this.#controls,
      {
        onObjectSelected: options.onObjectSelected,
        onObjectTransformCommitted: options.onObjectTransformCommitted,
      },
    );

    this.#scene.add(this.#grid, this.#axes);
    this.applyModel(model);

    this.#container.append(this.#renderer.domElement);
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#container);
    this.#resize();
    this.#renderer.setAnimationLoop(() => this.#render());
  }

  applyModel(model: SceneSnapshot): void {
    this.#scene.background = new THREE.Color(model.backgroundColor);
    this.#renderer.shadowMap.enabled = model.shadowsEnabled;
    this.#grid.visible = model.helpers.gridVisible;
    this.#axes.visible = model.helpers.axesVisible;
    this.#applyCamera(model.camera);

    this.#sceneGraph.applyModel(model.objects, model.lights);
    this.#interaction.refreshSelection();
  }

  setSelection(objectId: string | null): void {
    this.#interaction.setSelection(objectId);
  }

  setTransformMode(mode: TransformMode): void {
    this.#interaction.setTransformMode(mode);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#resizeObserver.disconnect();
    this.#interaction.dispose();
    this.#controls.dispose();

    this.#sceneGraph.dispose();
    this.#grid.geometry.dispose();
    this.#disposeMaterial(this.#grid.material);
    this.#axes.geometry.dispose();
    this.#disposeMaterial(this.#axes.material);
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #createCamera(model: DeepReadonly<CameraModel>): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(model.fov, 1, model.near, model.far);
    camera.position.set(model.position.x, model.position.y, model.position.z);
    return camera;
  }

  #createRenderer(): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.domElement.className = "viewport-canvas";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      "aria-label",
      "3Dビュー。ドラッグで回転、右ドラッグで移動、ホイールでズームできます。",
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    return renderer;
  }

  #createControls(model: DeepReadonly<CameraModel>): OrbitControls {
    const controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    controls.target.set(model.target.x, model.target.y, model.target.z);
    controls.enableDamping = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;
    controls.addEventListener("end", () => {
      this.#onCameraInteractionEnd({
        position: this.#toVec3Model(this.#camera.position),
        target: this.#toVec3Model(controls.target),
      });
    });
    controls.update();
    return controls;
  }

  #applyCamera(model: DeepReadonly<CameraModel>): void {
    this.#camera.fov = model.fov;
    this.#camera.near = model.near;
    this.#camera.far = model.far;
    this.#camera.position.set(model.position.x, model.position.y, model.position.z);
    this.#camera.updateProjectionMatrix();
    this.#controls.target.set(model.target.x, model.target.y, model.target.z);
    this.#controls.update();
  }

  #resize(): void {
    const width = Math.max(1, Math.floor(this.#container.clientWidth));
    const height = Math.max(1, Math.floor(this.#container.clientHeight));
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #render(): void {
    this.#controls.update();
    this.#renderer.render(this.#scene, this.#camera);
  }

  #toVec3Model(vector: THREE.Vector3): Vec3Model {
    return {
      x: Number(vector.x.toFixed(4)),
      y: Number(vector.y.toFixed(4)),
      z: Number(vector.z.toFixed(4)),
    };
  }

  #disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    const materials = Array.isArray(material) ? material : [material];
    for (const item of materials) item.dispose();
  }
}
