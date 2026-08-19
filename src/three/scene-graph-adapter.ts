import * as THREE from "three";
import type { SceneSnapshot } from "../model/scene-model";
import { createGeometry, geometrySignature } from "./geometry-factory";

type ObjectModel = SceneSnapshot["objects"][number];
type LightModel = SceneSnapshot["lights"][number];
type DirectionalLightModel = Extract<LightModel, { type: "directional" }>;

interface MeshEntry {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  geometrySignature: string;
}

type LightEntry =
  | { type: "ambient"; light: THREE.AmbientLight }
  | {
      type: "directional";
      light: THREE.DirectionalLight;
      target: THREE.Object3D;
    };

export class SceneGraphAdapter {
  readonly #scene: THREE.Scene;
  readonly #objects = new Map<string, MeshEntry>();
  readonly #lights = new Map<string, LightEntry>();

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
  }

  applyModel(
    objectModels: SceneSnapshot["objects"],
    lightModels: SceneSnapshot["lights"],
  ): void {
    const objectIds = this.#collectUniqueIds(objectModels, "object");
    const lightIds = this.#collectUniqueIds(lightModels, "light");
    this.#reconcileObjects(objectModels, objectIds);
    this.#reconcileLights(lightModels, lightIds);
  }

  getObjectById(objectId: string): THREE.Object3D | undefined {
    return this.#objects.get(objectId)?.mesh;
  }

  getPickableObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const { mesh } of this.#objects.values()) {
      if (mesh.visible) objects.push(mesh);
    }
    return objects;
  }

  dispose(): void {
    for (const entry of this.#objects.values()) this.#removeObject(entry);
    for (const entry of this.#lights.values()) this.#removeLight(entry);
    this.#objects.clear();
    this.#lights.clear();
  }

  #reconcileObjects(
    models: SceneSnapshot["objects"],
    activeIds: ReadonlySet<string>,
  ): void {
    for (const model of models) {
      const nextSignature = geometrySignature(model.geometry);
      let entry = this.#objects.get(model.id);

      if (!entry) {
        entry = this.#createObject(model, nextSignature);
        this.#objects.set(model.id, entry);
        this.#scene.add(entry.mesh);
      } else if (entry.geometrySignature !== nextSignature) {
        const nextGeometry = createGeometry(model.geometry);
        const previousGeometry = entry.mesh.geometry;
        entry.mesh.geometry = nextGeometry;
        entry.geometrySignature = nextSignature;
        previousGeometry.dispose();
      }

      this.#applyObject(entry.mesh, model);
    }

    for (const [id, entry] of this.#objects) {
      if (activeIds.has(id)) continue;
      this.#removeObject(entry);
      this.#objects.delete(id);
    }
  }

  #reconcileLights(
    models: SceneSnapshot["lights"],
    activeIds: ReadonlySet<string>,
  ): void {
    for (const model of models) {
      let entry = this.#lights.get(model.id);
      if (entry && entry.type !== model.type) {
        this.#removeLight(entry);
        this.#lights.delete(model.id);
        entry = undefined;
      }

      if (!entry) {
        entry = this.#createLight(model);
        this.#lights.set(model.id, entry);
        this.#addLight(entry);
      }

      this.#applyLight(entry, model);
    }

    for (const [id, entry] of this.#lights) {
      if (activeIds.has(id)) continue;
      this.#removeLight(entry);
      this.#lights.delete(id);
    }
  }

  #createObject(model: ObjectModel, signature: string): MeshEntry {
    return {
      mesh: new THREE.Mesh(
        createGeometry(model.geometry),
        new THREE.MeshStandardMaterial(),
      ),
      geometrySignature: signature,
    };
  }

  #applyObject(mesh: MeshEntry["mesh"], model: ObjectModel): void {
    mesh.name = model.name;
    mesh.userData.sceneModelId = model.id;
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
    mesh.material.color.set(model.material.color);
    mesh.material.metalness = model.material.metalness;
    mesh.material.roughness = model.material.roughness;
  }

  #createLight(model: LightModel): LightEntry {
    if (model.type === "ambient") {
      return { type: "ambient", light: new THREE.AmbientLight() };
    }

    const light = new THREE.DirectionalLight();
    const target = new THREE.Object3D();
    light.target = target;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 40;
    light.shadow.camera.left = -10;
    light.shadow.camera.right = 10;
    light.shadow.camera.top = 10;
    light.shadow.camera.bottom = -10;
    light.shadow.bias = -0.0002;
    return { type: "directional", light, target };
  }

  #addLight(entry: LightEntry): void {
    if (entry.type === "ambient") {
      this.#scene.add(entry.light);
      return;
    }
    this.#scene.add(entry.light, entry.target);
  }

  #applyLight(entry: LightEntry, model: LightModel): void {
    entry.light.name = model.name;
    entry.light.color.set(model.color);
    entry.light.intensity = model.enabled ? model.intensity : 0;
    entry.light.visible = model.enabled;

    if (entry.type === "directional" && model.type === "directional") {
      this.#applyDirectionalLight(entry, model);
    }
  }

  #applyDirectionalLight(
    entry: Extract<LightEntry, { type: "directional" }>,
    model: DirectionalLightModel,
  ): void {
    entry.light.castShadow = model.castShadow;
    entry.light.position.set(model.position.x, model.position.y, model.position.z);
    entry.target.position.set(model.target.x, model.target.y, model.target.z);
    entry.target.updateMatrixWorld();
  }

  #removeObject(entry: MeshEntry): void {
    this.#scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
  }

  #removeLight(entry: LightEntry): void {
    this.#scene.remove(entry.light);
    if (entry.type === "directional") {
      this.#scene.remove(entry.target);
      entry.light.shadow.map?.dispose();
    }
  }

  #collectUniqueIds<T extends { readonly id: string }>(
    models: readonly T[],
    kind: string,
  ): Set<string> {
    const ids = new Set<string>();
    for (const model of models) {
      if (ids.has(model.id)) {
        throw new Error(`Duplicate ${kind} id in SceneModel: ${model.id}`);
      }
      ids.add(model.id);
    }
    return ids;
  }
}
