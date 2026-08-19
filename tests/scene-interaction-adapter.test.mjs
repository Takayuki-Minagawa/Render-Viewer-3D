import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let SceneGraphAdapter;
let SceneInteractionAdapter;
let createDefaultSceneObject;
let createMaterialDefinition;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ SceneGraphAdapter } = await server.ssrLoadModule(
    "/src/three/scene-graph-adapter.ts",
  ));
  ({ SceneInteractionAdapter } = await server.ssrLoadModule(
    "/src/three/scene-interaction-adapter.ts",
  ));
  ({ createDefaultSceneObject } = await server.ssrLoadModule(
    "/src/model/scene-object-commands.ts",
  ));
  ({ createMaterialDefinition } = await server.ssrLoadModule(
    "/src/model/material/material-presets.ts",
  ));
});

after(async () => {
  await server?.close();
});

describe("SceneInteractionAdapter transform transactions", () => {
  it("preserves an in-flight transform across model reconcile until commit", () => {
    const harness = createHarness();
    const { controls, graph, interaction, materials, objects, orbitControls } = harness;

    controls.beginDrag();
    controls.changeObject((object) => {
      object.position.x = 4.25;
      object.rotation.y = THREE.MathUtils.degToRad(31.5);
      object.scale.z = 1.75;
    });

    assert.equal(objects[0].transform.position.x, 0);
    objects[0].name = "Externally renamed";
    graph.applyModel(objects, [], materials);
    interaction.refreshSelection();

    const mesh = graph.getObjectById(objects[0].id);
    assert.equal(mesh.position.x, 4.25);
    assert.equal(THREE.MathUtils.radToDeg(mesh.rotation.y), 31.5);
    assert.equal(mesh.scale.z, 1.75);
    assert.equal(objects[0].transform.position.x, 0);

    interaction.setSelection(null);
    assert.equal(harness.commits.length, 1);
    assert.deepEqual(harness.commits[0], {
      objectId: objects[0].id,
      transform: {
        position: { x: 4.25, y: 1, z: 0 },
        rotationDegrees: { x: 0, y: 31.5, z: 0 },
        scale: { x: 1, y: 1, z: 1.75 },
      },
    });
    assert.equal(objects[0].transform.position.x, 4.25);
    assert.equal(controls.dragging, false);
    assert.equal(orbitControls.enabled, true);

    objects.splice(0, 1);
    graph.applyModel(objects, [], materials);
    interaction.refreshSelection();
    assert.equal(graph.getObjectById("shape-box"), undefined);
    disposeHarness(harness);
  });

  it("retains a hidden object's pending transform until pointerup commits it", () => {
    const harness = createHarness();
    const {
      canvas,
      controls,
      graph,
      interaction,
      materials,
      objects,
      orbitControls,
    } = harness;

    canvas.dispatchEvent(pointerEvent("pointerdown"));
    controls.beginDrag();
    controls.changeObject((object) => {
      object.position.y = 6.5;
    });
    objects[0].visible = false;
    graph.applyModel(objects, [], materials);
    interaction.refreshSelection();

    assert.equal(harness.commits.length, 0);
    assert.equal(objects[0].transform.position.y, 1);
    assert.equal(controls.object, undefined);
    assert.equal(controls.dragging, true);
    assert.equal(orbitControls.enabled, false);

    // TransformControls runs before the adapter's canvas pointerup listener.
    controls.dragging = false;
    canvas.dispatchEvent(pointerEvent("pointerup"));

    assert.equal(harness.commits.length, 1);
    assert.equal(harness.commits[0].transform.position.y, 6.5);
    assert.equal(objects[0].transform.position.y, 6.5);
    assert.equal(objects[0].visible, false);
    assert.equal(controls.object, undefined);
    assert.equal(controls.dragging, false);
    assert.equal(orbitControls.enabled, true);
    disposeHarness(harness);
  });

  it("commits on pointercancel even when an earlier listener reconciles the model", () => {
    const order = [];
    const harness = createHarness((context) => {
      context.canvas.addEventListener("pointercancel", () => {
        order.push("external-model");
        context.graph.applyModel(context.objects, [], context.materials);
        context.interaction.refreshSelection();
      });
    }, order);
    const { canvas, controls, interaction, objects, orbitControls } = harness;

    controls.beginDrag();
    controls.changeObject((object) => {
      object.position.z = -8.75;
    });
    canvas.dispatchEvent(new Event("pointercancel"));

    assert.deepEqual(order, ["external-model", "commit"]);
    assert.equal(harness.commits.length, 1);
    assert.equal(harness.commits[0].transform.position.z, -8.75);
    assert.equal(objects[0].transform.position.z, -8.75);
    assert.equal(controls.dragging, false);
    assert.equal(controls.disconnectCount, 1);
    assert.equal(controls.connectCount, 1);
    assert.equal(orbitControls.enabled, true);
    disposeHarness(harness);
  });
});

class FakeCanvas extends EventTarget {
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  }
}

class FakeTransformControls extends THREE.EventDispatcher {
  mode = "translate";
  axis = null;
  object = undefined;
  helper = new THREE.Object3D();
  disconnectCount = 0;
  connectCount = 0;
  disposeCount = 0;
  #dragging = false;

  get dragging() {
    return this.#dragging;
  }

  set dragging(value) {
    if (value === this.#dragging) return;
    this.#dragging = value;
    this.dispatchEvent({ type: "dragging-changed", value });
  }

  getHelper() {
    return this.helper;
  }

  attach(object) {
    this.object = object;
    return this;
  }

  detach() {
    this.object = undefined;
    this.axis = null;
    return this;
  }

  setMode(mode) {
    this.mode = mode;
  }

  beginDrag() {
    assert.ok(this.object);
    this.axis = "X";
    this.dragging = true;
  }

  changeObject(change) {
    assert.ok(this.object);
    change(this.object);
    this.dispatchEvent({ type: "objectChange" });
  }

  disconnect() {
    this.disconnectCount += 1;
  }

  connect() {
    this.connectCount += 1;
  }

  dispose() {
    this.disposeCount += 1;
  }
}

function createHarness(beforeCreate, commitOrder) {
  const scene = new THREE.Scene();
  const graph = new SceneGraphAdapter(scene);
  const objects = [createDefaultSceneObject("box", "shape-box")];
  const materials = [
    createMaterialDefinition(objects[0].materialId, "Shape Material"),
  ];
  const canvas = new FakeCanvas();
  const controls = new FakeTransformControls();
  const orbitControls = { enabled: true };
  const commits = [];
  const context = {
    canvas,
    controls,
    graph,
    interaction: undefined,
    materials,
    objects,
  };

  graph.applyModel(objects, [], materials);
  beforeCreate?.(context);
  context.interaction = new SceneInteractionAdapter(
    scene,
    new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100),
    canvas,
    graph,
    orbitControls,
    {
      onObjectSelected: () => {},
      onObjectTransformCommitted: (objectId, transform) => {
        commitOrder?.push("commit");
        commits.push({ objectId, transform: structuredClone(transform) });
        const object = objects.find((candidate) => candidate.id === objectId);
        if (object) object.transform = structuredClone(transform);
        graph.applyModel(objects, [], materials);
        context.interaction.refreshSelection();
      },
      createTransformControls: () => controls,
    },
  );
  context.interaction.setSelection(objects[0].id);

  return {
    ...context,
    interaction: context.interaction,
    orbitControls,
    commits,
    scene,
  };
}

function disposeHarness(harness) {
  harness.interaction.dispose();
  harness.graph.dispose();
}

function pointerEvent(type) {
  return Object.assign(new Event(type), {
    pointerId: 1,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
}
