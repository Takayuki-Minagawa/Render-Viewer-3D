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
  createTransformControls?: (
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
  ) => TransformControls;
}

interface PointerStart {
  id: number;
  x: number;
  y: number;
}

interface PendingTransform {
  readonly objectId: string;
  readonly transform: TransformModel;
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
  #pendingTransform: PendingTransform | null = null;
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
    this.#transformControls = options.createTransformControls
      ? options.createTransformControls(camera, canvas)
      : new TransformControls(camera, canvas);
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
      try {
        this.#commitTransform();
      } finally {
        this.#endTransformInteraction();
      }
    }
    this.#selectedObjectId = objectId;
    this.refreshSelection();
  }

  setTransformMode(mode: TransformMode): void {
    if (mode !== this.#transformControls.mode && this.#transformControls.dragging) {
      try {
        this.#commitTransform();
      } finally {
        this.#endTransformInteraction();
      }
    }
    this.#transformControls.setMode(mode);
  }

  refreshSelection(): void {
    const objectId = this.#selectedObjectId;
    const object = objectId ? this.#graph.getObjectById(objectId) : undefined;

    if (!objectId || !object) {
      this.#endTransformInteraction();
      this.#transformControls.detach();
      this.#selectionHelper.visible = false;
      return;
    }

    if (!object.visible) {
      if (
        this.#transformControls.dragging &&
        this.#pendingTransform?.objectId === objectId
      ) {
        // Keep the model-shaped draft until the active pointer finishes. A
        // synchronous commit here would re-enter the SceneStore notification.
        this.#transformControls.detach();
        this.#selectionHelper.visible = false;
        return;
      }

      this.#endTransformInteraction();
      this.#transformControls.detach();
      this.#selectionHelper.visible = false;
      return;
    }

    if (this.#transformControls.object !== object) {
      this.#transformControls.attach(object);
    }
    this.#restorePendingTransform(objectId, object);
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
        const hadTransformTransaction =
          this.#transformControls.dragging || this.#pendingTransform !== null;

        try {
          if (hadTransformTransaction) this.#commitTransform();
        } finally {
          if (hadTransformTransaction) this.#endTransformInteraction();
          // TransformControls does not listen for pointercancel. Reconnecting
          // clears the pointermove handler it installs only while dragging.
          this.#transformControls.disconnect();
          this.#transformControls.connect(this.#canvas);
        }
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
        this.#rememberPendingTransform();
        return;
      }
      this.#restoreOrbitControls();
    });
    this.#transformControls.addEventListener("objectChange", () => {
      const object = this.#transformControls.object;
      if (!object) return;
      this.#rememberPendingTransform();
      this.#selectionHelper.setFromObject(object);
    });
    this.#transformControls.addEventListener("mouseUp", () => {
      this.#commitTransform();
    });
  }

  #rememberPendingTransform(): void {
    const objectId = this.#selectedObjectId;
    const object = this.#transformControls.object;
    if (
      !this.#transformControls.dragging ||
      !objectId ||
      !object ||
      this.#graph.getObjectById(objectId) !== object
    ) {
      return;
    }

    this.#pendingTransform = {
      objectId,
      transform: this.#captureTransformModel(object),
    };
  }

  #restorePendingTransform(objectId: string, object: THREE.Object3D): void {
    const pending = this.#pendingTransform;
    if (!pending || pending.objectId !== objectId) return;

    const { position, rotationDegrees, scale } = pending.transform;
    object.position.set(position.x, position.y, position.z);
    object.rotation.set(
      THREE.MathUtils.degToRad(rotationDegrees.x),
      THREE.MathUtils.degToRad(rotationDegrees.y),
      THREE.MathUtils.degToRad(rotationDegrees.z),
    );
    object.scale.set(scale.x, scale.y, scale.z);
    object.updateMatrixWorld(true);
  }

  #commitTransform(): void {
    const objectId = this.#selectedObjectId;
    const graphObject = objectId
      ? this.#graph.getObjectById(objectId)
      : undefined;
    const controlsObject = this.#transformControls.object;
    if (!objectId || !graphObject) return;

    const previousPending = this.#pendingTransform;
    let source: TransformModel;
    if (previousPending?.objectId === objectId) {
      source = previousPending.transform;
    } else if (controlsObject === graphObject) {
      source = this.#captureTransformModel(graphObject);
    } else {
      return;
    }

    const transform = this.#roundTransformModel(source);
    this.#pendingTransform = null;

    try {
      this.#options.onObjectTransformCommitted(objectId, transform);
    } catch (error) {
      this.#pendingTransform = previousPending;
      throw error;
    }
  }

  #endTransformInteraction(): void {
    if (this.#transformControls.dragging) {
      this.#transformControls.dragging = false;
      this.#transformControls.axis = null;
    }
    this.#pendingTransform = null;
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
      if (this.#pendingTransform) {
        try {
          this.#commitTransform();
        } finally {
          this.#endTransformInteraction();
        }
      }
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

  #captureTransformModel(object: THREE.Object3D): TransformModel {
    return {
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      },
      rotationDegrees: {
        x: THREE.MathUtils.radToDeg(object.rotation.x),
        y: THREE.MathUtils.radToDeg(object.rotation.y),
        z: THREE.MathUtils.radToDeg(object.rotation.z),
      },
      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z,
      },
    };
  }

  #roundTransformModel(transform: TransformModel): TransformModel {
    return {
      position: {
        x: this.#round(transform.position.x),
        y: this.#round(transform.position.y),
        z: this.#round(transform.position.z),
      },
      rotationDegrees: {
        x: this.#round(transform.rotationDegrees.x),
        y: this.#round(transform.rotationDegrees.y),
        z: this.#round(transform.rotationDegrees.z),
      },
      scale: {
        x: this.#round(transform.scale.x),
        y: this.#round(transform.scale.y),
        z: this.#round(transform.scale.z),
      },
    };
  }

  #round(value: number): number {
    return Number(value.toFixed(4));
  }
}
