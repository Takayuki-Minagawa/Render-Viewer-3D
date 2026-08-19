import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  CameraModel,
  DirectionalLightModel,
  GeometryModel,
  LightModel,
  SceneModel,
  SceneObjectModel,
  Vec3Model,
} from "../model/scene-model";

interface CameraPose {
  position: Vec3Model;
  target: Vec3Model;
}

interface SceneAdapterOptions {
  onCameraInteractionEnd: (pose: CameraPose) => void;
}

interface DirectionalLightBundle {
  light: THREE.DirectionalLight;
  target: THREE.Object3D;
}

export class SceneAdapter {
  readonly #scene = new THREE.Scene();
  readonly #camera: THREE.PerspectiveCamera;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #controls: OrbitControls;
  readonly #resizeObserver: ResizeObserver;
  readonly #objectMap = new Map<string, THREE.Mesh>();
  readonly #lightMap = new Map<string, THREE.Light | DirectionalLightBundle>();
  readonly #grid = new THREE.GridHelper(24, 24, 0x526078, 0x303846);
  readonly #axes = new THREE.AxesHelper(2.5);
  readonly #container: HTMLElement;
  readonly #onCameraInteractionEnd: (pose: CameraPose) => void;

  constructor(
    container: HTMLElement,
    model: Readonly<SceneModel>,
    options: SceneAdapterOptions,
  ) {
    this.#container = container;
    this.#onCameraInteractionEnd = options.onCameraInteractionEnd;
    this.#camera = this.#createCamera(model.camera);
    this.#renderer = this.#createRenderer();
    this.#controls = this.#createControls(model.camera);

    this.#scene.add(this.#grid, this.#axes);
    this.#createSceneObjects(model);
    this.#createLights(model.lights);
    this.applyModel(model);

    this.#container.append(this.#renderer.domElement);
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#container);
    this.#resize();
    this.#renderer.setAnimationLoop(() => this.#render());
  }

  applyModel(model: Readonly<SceneModel>): void {
    this.#scene.background = new THREE.Color(model.backgroundColor);
    this.#renderer.shadowMap.enabled = model.shadowsEnabled;
    this.#grid.visible = model.helpers.gridVisible;
    this.#axes.visible = model.helpers.axesVisible;
    this.#applyCamera(model.camera);

    for (const objectModel of model.objects) {
      const mesh = this.#objectMap.get(objectModel.id);
      if (mesh) this.#applyObjectModel(mesh, objectModel);
    }
    for (const lightModel of model.lights) this.#applyLightModel(lightModel);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#resizeObserver.disconnect();
    this.#controls.dispose();

    for (const mesh of this.#objectMap.values()) {
      mesh.geometry.dispose();
      this.#disposeMaterial(mesh.material);
    }

    this.#grid.geometry.dispose();
    this.#disposeMaterial(this.#grid.material);
    this.#axes.geometry.dispose();
    this.#disposeMaterial(this.#axes.material);
    this.#objectMap.clear();
    this.#lightMap.clear();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #createCamera(model: Readonly<CameraModel>): THREE.PerspectiveCamera {
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

  #createControls(model: Readonly<CameraModel>): OrbitControls {
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

  #createSceneObjects(model: Readonly<SceneModel>): void {
    for (const objectModel of model.objects) {
      const mesh = new THREE.Mesh(
        this.#createGeometry(objectModel.geometry),
        new THREE.MeshStandardMaterial(),
      );
      mesh.name = objectModel.name;
      mesh.userData.sceneModelId = objectModel.id;
      this.#objectMap.set(objectModel.id, mesh);
      this.#scene.add(mesh);
    }
  }

  #createGeometry(model: GeometryModel): THREE.BufferGeometry {
    switch (model.type) {
      case "box":
        return new THREE.BoxGeometry(model.width, model.height, model.depth);
      case "plane":
        return new THREE.PlaneGeometry(model.width, model.height);
    }
  }

  #createLights(models: readonly LightModel[]): void {
    for (const model of models) {
      if (model.type === "ambient") {
        const light = new THREE.AmbientLight();
        light.name = model.name;
        this.#lightMap.set(model.id, light);
        this.#scene.add(light);
        continue;
      }

      const light = new THREE.DirectionalLight();
      const target = new THREE.Object3D();
      light.name = model.name;
      light.target = target;
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 40;
      light.shadow.camera.left = -10;
      light.shadow.camera.right = 10;
      light.shadow.camera.top = 10;
      light.shadow.camera.bottom = -10;
      light.shadow.bias = -0.0002;
      this.#lightMap.set(model.id, { light, target });
      this.#scene.add(light, target);
    }
  }

  #applyCamera(model: Readonly<CameraModel>): void {
    this.#camera.fov = model.fov;
    this.#camera.near = model.near;
    this.#camera.far = model.far;
    this.#camera.position.set(model.position.x, model.position.y, model.position.z);
    this.#camera.updateProjectionMatrix();
    this.#controls.target.set(model.target.x, model.target.y, model.target.z);
    this.#controls.update();
  }

  #applyObjectModel(mesh: THREE.Mesh, model: Readonly<SceneObjectModel>): void {
    mesh.visible = model.visible;
    mesh.position.set(
      model.transform.position.x,
      model.transform.position.y,
      model.transform.position.z,
    );
    mesh.rotation.set(
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.x),
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.y),
      THREE.MathUtils.degToRad(model.transform.rotationDegrees.z),
    );
    mesh.scale.set(
      model.transform.scale.x,
      model.transform.scale.y,
      model.transform.scale.z,
    );
    mesh.castShadow = model.castShadow;
    mesh.receiveShadow = model.receiveShadow;

    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.set(model.material.color);
    material.metalness = model.material.metalness;
    material.roughness = model.material.roughness;
  }

  #applyLightModel(model: Readonly<LightModel>): void {
    const mapped = this.#lightMap.get(model.id);
    if (!mapped) return;

    if (model.type === "ambient" && mapped instanceof THREE.AmbientLight) {
      mapped.color.set(model.color);
      mapped.intensity = model.enabled ? model.intensity : 0;
      mapped.visible = model.enabled;
      return;
    }

    if (model.type === "directional" && !(mapped instanceof THREE.Light)) {
      this.#applyDirectionalLight(mapped, model);
    }
  }

  #applyDirectionalLight(
    bundle: DirectionalLightBundle,
    model: Readonly<DirectionalLightModel>,
  ): void {
    bundle.light.color.set(model.color);
    bundle.light.intensity = model.enabled ? model.intensity : 0;
    bundle.light.visible = model.enabled;
    bundle.light.castShadow = model.castShadow;
    bundle.light.position.set(model.position.x, model.position.y, model.position.z);
    bundle.target.position.set(model.target.x, model.target.y, model.target.z);
    bundle.target.updateMatrixWorld();
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
