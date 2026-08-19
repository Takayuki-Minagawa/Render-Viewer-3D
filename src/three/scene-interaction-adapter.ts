import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { TransformMode } from "../app/editor-store";
import type { TransformModel } from "../model/scene-model";
import type { SceneGraphAdapter } from "./scene-graph-adapter";

interface SceneInteractionOptions {
  onObjectSelected: (objectId: string | null) => void;
  onObjectTransformCommitted: (
    objectId: string,
    transform: TransformModel,
  ) => void;
}

interface PointerStart {
  id: number;
  x: number;
  y: number;
}

export class SceneInteractionAdapter {
  readonly #scene: THREE.Scene;
  readonly #camera: THREE.Camera;
  readonly #canvas: HTMLCanvasElement;
  readonly #graph: SceneGraphAdapter;
  readonly #orbitControls: OrbitControls;
  readonly #options: SceneInteractionOptions;
  readonly #raycaster = new THREE.Raycaster();
  readonly #pointer = new THREE.Vector2();
  readonly #transformControls: TransformControls;
  readonly #transformHelper: THREE.Object3D;
  readonly #selectionHelper = new THREE.BoxHelper(
    new THREE.Object3D(),
    0x8aa8ff,
  );
  readonly #abortController = new AbortController();
  #selectedObjectId: string | null = null;
  #pointerStart: PointerStart | null = null;
  #draggedTransform = false;
  #orbitEnabledBeforeTransform: boolean | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    graph: SceneGraphAdapter,
    orbitControls: OrbitControls,
    options: SceneInteractionOptions,
  ) {
    this.#scene = scene;
    this.#camera = camera;
    this.#canvas = canvas;
    this.#graph = graph;
    this.#orbitControls = orbitControls;
    this.#options = options;
    this.#transformControls = new TransformControls(camera, canvas);
    this.#transformHelper = this.#transformControls.getHelper();
    this.#selectionHelper.visible = false;
    this.#selectionHelper.material.depthTest = false;
    this.#selectionHelper.material.transparent = true;
    this.#selectionHelper.material.opacity = 0.85;
    this.#selectionHelper.renderOrder = 1000;

    this.#scene.add(this.#transformHelper, this.#selectionHelper);
    this.#bindEvents();
  }

  setSelection(objectId: string | null): void {
    if (objectId !== this.#selectedObjectId && this.#transformControls.dragging) {
      this.#commitTransform();
      this.#endTransformInteraction();
    }
    this.#selectedObjectId = objectId;
    this.refreshSelection();
  }

  setTransformMode(mode: TransformMode): void {
    if (mode !== this.#transformControls.mode && this.#transformControls.dragging) {
      this.#commitTransform();
      this.#endTransformInteraction();
    }
    this.#transformControls.setMode(mode);
  }

  refreshSelection(): void {
    const object = this.#selectedObjectId
      ? this.#graph.getObjectById(this.#selectedObjectId)
      : undefined;

    if (!object || !object.visible) {
      this.#endTransformInteraction();
      this.#transformControls.detach();
      this.#selectionHelper.visible = false;
      return;
    }

    if (this.#transformControls.object !== object) {
      this.#transformControls.attach(object);
    }
    this.#selectionHelper.setFromObject(object);
    this.#selectionHelper.visible = true;
  }

  dispose(): void {
    this.#abortController.abort();
    this.#endTransformInteraction();
    this.#transformControls.detach();
    this.#scene.remove(this.#transformHelper, this.#selectionHelper);
    this.#transformControls.dispose();
    this.#selectionHelper.dispose();
  }

  #bindEvents(): void {
    const options = { signal: this.#abortController.signal };
    this.#canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        this.#pointerStart = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      },
      options,
    );
    this.#canvas.addEventListener(
      "pointerup",
      (event) => this.#handlePointerUp(event),
      options,
    );
    this.#canvas.addEventListener(
      "pointercancel",
      () => {
        this.#pointerStart = null;
        this.#draggedTransform = false;
        if (!this.#transformControls.dragging) return;

        this.#commitTransform();
        this.#endTransformInteraction();
        // TransformControls does not listen for pointercancel. Reconnecting
        // clears the pointermove handler it installs only while dragging.
        this.#transformControls.disconnect();
        this.#transformControls.connect(this.#canvas);
      },
      options,
    );

    this.#transformControls.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      if (dragging) {
        if (this.#orbitEnabledBeforeTransform === null) {
          this.#orbitEnabledBeforeTransform = this.#orbitControls.enabled;
        }
        this.#orbitControls.enabled = false;
        this.#draggedTransform = true;
        return;
      }
      this.#restoreOrbitControls();
    });
    this.#transformControls.addEventListener("objectChange", () => {
      const object = this.#transformControls.object;
      if (object) this.#selectionHelper.setFromObject(object);
    });
    this.#transformControls.addEventListener("mouseUp", () => {
      this.#commitTransform();
    });
  }

  #commitTransform(): void {
    const objectId = this.#selectedObjectId;
    const object = this.#transformControls.object;
    if (
      !objectId ||
      !object ||
      this.#graph.getObjectById(objectId) !== object
    ) {
      return;
    }

    this.#options.onObjectTransformCommitted(
      objectId,
      this.#toTransformModel(object),
    );
  }

  #endTransformInteraction(): void {
    if (this.#transformControls.dragging) {
      this.#transformControls.dragging = false;
      this.#transformControls.axis = null;
    }
    this.#restoreOrbitControls();
  }

  #restoreOrbitControls(): void {
    if (this.#orbitEnabledBeforeTransform === null) return;
    this.#orbitControls.enabled = this.#orbitEnabledBeforeTransform;
    this.#orbitEnabledBeforeTransform = null;
  }

  #handlePointerUp(event: PointerEvent): void {
    const start = this.#pointerStart;
    this.#pointerStart = null;
    if (!start || start.id !== event.pointerId || event.button !== 0) return;

    if (this.#draggedTransform) {
      this.#draggedTransform = false;
      return;
    }
    if (this.#transformControls.axis !== null) return;

    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 4) return;

    const bounds = this.#canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.#pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#pointer, this.#camera);
    const intersection = this.#raycaster.intersectObjects(
      this.#graph.getPickableObjects(),
      false,
    )[0];
    this.#options.onObjectSelected(
      (intersection?.object.userData.sceneModelId as string | undefined) ?? null,
    );
  }

  #toTransformModel(object: THREE.Object3D): TransformModel {
    return {
      position: {
        x: this.#round(object.position.x),
        y: this.#round(object.position.y),
        z: this.#round(object.position.z),
      },
      rotationDegrees: {
        x: this.#round(THREE.MathUtils.radToDeg(object.rotation.x)),
        y: this.#round(THREE.MathUtils.radToDeg(object.rotation.y)),
        z: this.#round(THREE.MathUtils.radToDeg(object.rotation.z)),
      },
      scale: {
        x: this.#round(object.scale.x),
        y: this.#round(object.scale.y),
        z: this.#round(object.scale.z),
      },
    };
  }

  #round(value: number): number {
    return Number(value.toFixed(4));
  }
}
