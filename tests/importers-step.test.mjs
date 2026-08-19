import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let STEPImporter;
let stepTessellationOptions;
let MAX_STEP_INPUT_BYTES;
let DEFAULT_IMPORT_OPTIONS;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    STEPImporter,
    stepTessellationOptions,
    MAX_STEP_INPUT_BYTES,
  } = await server.ssrLoadModule("/src/importers/STEPImporter.ts"));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
});

after(async () => {
  await server?.close();
});

function primaryFile() {
  return new File(["ISO-10303-21;END-ISO-10303-21;"], "part.step", {
    type: "model/step",
  });
}

function options(overrides = {}) {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createWorkerFactory(worker, onSpawn) {
  return () => {
    onSpawn?.();
    return {
      ready: Promise.resolve(worker),
      terminate: () => worker.terminate(),
    };
  };
}

function fixtureMesh() {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1000, 0, 0,
      0, 1000, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
    vertexCount: 3,
    triangleCount: 1,
  };
}

function findMesh(root) {
  let mesh;
  root.traverse((object) => {
    if (!mesh && object.isMesh) {
      mesh = object;
    }
  });
  assert.ok(mesh);
  return mesh;
}

describe("STEPImporter", () => {
  it("maps quality to OCCT deflection settings", () => {
    assert.deepEqual(stepTessellationOptions("low"), {
      linearDeflection: 0.5,
      angularDeflection: 0.8,
      relative: false,
    });
    assert.deepEqual(stepTessellationOptions("medium"), {
      linearDeflection: 0.1,
      angularDeflection: 0.5,
      relative: false,
    });
    assert.deepEqual(stepTessellationOptions("high"), {
      linearDeflection: 0.03,
      angularDeflection: 0.25,
      relative: false,
    });
  });

  it("rejects oversized input before reading it or creating a worker", async () => {
    let arrayBufferCalls = 0;
    let workerFactoryCalls = 0;
    const primary = {
      name: "oversized.step",
      size: MAX_STEP_INPUT_BYTES + 1,
      async arrayBuffer() {
        arrayBufferCalls += 1;
        return new ArrayBuffer(0);
      },
    };
    const importer = new STEPImporter(() => {
      workerFactoryCalls += 1;
      throw new Error("worker factory must not be called");
    });

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /128 MiB worker input safety limit/u,
    );
    assert.equal(arrayBufferCalls, 0);
    assert.equal(workerFactoryCalls, 0);
  });

  it("terminates the worker handle immediately while spawn is pending", { timeout: 1_000 }, async () => {
    const calls = [];
    const started = deferred();
    const pending = deferred();
    const controller = new AbortController();
    const importer = new STEPImporter(() => {
      calls.push("spawn");
      started.resolve();
      return {
        ready: pending.promise,
        terminate() {
          calls.push("terminate");
        },
      };
    });
    const primary = primaryFile();
    const importing = importer.import(
      primary,
      [primary],
      options({ signal: controller.signal }),
    );

    await started.promise;
    const reason = new Error("stop spawn");
    controller.abort(reason);

    await assert.rejects(importing, (error) => error === reason);
    assert.deepEqual(calls, ["spawn", "terminate"]);
  });

  it("converts copied worker arrays and always releases the shape", async () => {
    const calls = [];
    const shape = 42;
    const occtMesh = fixtureMesh();
    const worker = {
      async importStep(data) {
        calls.push("importStep");
        assert.ok(data instanceof ArrayBuffer);
        return shape;
      },
      async tessellate(receivedShape, quality) {
        calls.push("tessellate");
        assert.equal(receivedShape, shape);
        assert.deepEqual(quality, stepTessellationOptions("high"));
        return occtMesh;
      },
      async release(receivedShape) {
        calls.push("release");
        assert.equal(receivedShape, shape);
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const importer = new STEPImporter(
      createWorkerFactory(worker, () => calls.push("spawn")),
    );
    const primary = primaryFile();

    const imported = await importer.import(
      primary,
      [primary],
      options({ quality: "high" }),
    );
    const mesh = findMesh(imported.root);

    assert.deepEqual(calls, [
      "spawn",
      "importStep",
      "tessellate",
      "release",
      "terminate",
    ]);
    assert.equal(mesh.geometry.index.array, occtMesh.indices);
    assert.equal(
      mesh.geometry.getAttribute("position").array,
      occtMesh.positions,
    );
    assert.equal(
      mesh.geometry.getAttribute("normal").array,
      occtMesh.normals,
    );
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.unit, "meter");
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      ["step-assembly-flattened", "coordinate-system-unavailable"],
    );
  });

  it("releases and terminates when tessellation fails", async () => {
    const calls = [];
    const failure = new Error("tessellation failed");
    const worker = {
      async importStep() {
        calls.push("importStep");
        return 7;
      },
      async tessellate() {
        calls.push("tessellate");
        throw failure;
      },
      async release() {
        calls.push("release");
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const importer = new STEPImporter(createWorkerFactory(worker));
    const primary = primaryFile();

    await assert.rejects(
      importer.import(primary, [primary], options()),
      (error) => error === failure,
    );
    assert.deepEqual(calls, [
      "importStep",
      "tessellate",
      "release",
      "terminate",
    ]);
  });

  it("terminates without releasing when STEP parsing never returns a handle", async () => {
    const calls = [];
    const failure = new Error("STEP parsing failed");
    const worker = {
      async importStep() {
        calls.push("importStep");
        throw failure;
      },
      async tessellate() {
        calls.push("tessellate");
        return fixtureMesh();
      },
      async release() {
        calls.push("release");
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const importer = new STEPImporter(createWorkerFactory(worker));
    const primary = primaryFile();

    await assert.rejects(
      importer.import(primary, [primary], options()),
      (error) => error === failure,
    );
    assert.deepEqual(calls, ["importStep", "terminate"]);
  });

  it("rejects malformed tessellation arrays but still cleans up", async () => {
    const calls = [];
    const worker = {
      async importStep() {
        return 9;
      },
      async tessellate() {
        return {
          ...fixtureMesh(),
          indices: new Uint32Array([0, 1]),
        };
      },
      async release() {
        calls.push("release");
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const importer = new STEPImporter(createWorkerFactory(worker));
    const primary = primaryFile();

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /invalid triangle indices/u,
    );
    assert.deepEqual(calls, ["release", "terminate"]);
  });

  it("aborts a pending STEP parse and terminates the worker once", { timeout: 1_000 }, async () => {
    const calls = [];
    const started = deferred();
    const pending = deferred();
    const worker = {
      importStep() {
        calls.push("importStep");
        started.resolve();
        return pending.promise;
      },
      async tessellate() {
        calls.push("tessellate");
        return fixtureMesh();
      },
      async release() {
        calls.push("release");
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const controller = new AbortController();
    const importer = new STEPImporter(createWorkerFactory(worker));
    const primary = primaryFile();
    const importing = importer.import(
      primary,
      [primary],
      options({ signal: controller.signal }),
    );

    await started.promise;
    const reason = new Error("stop parsing");
    controller.abort(reason);

    await assert.rejects(importing, (error) => error === reason);
    assert.deepEqual(calls, ["importStep", "terminate"]);
  });

  it("aborts pending tessellation without releasing a terminated worker", { timeout: 1_000 }, async () => {
    const calls = [];
    const started = deferred();
    const pending = deferred();
    const worker = {
      async importStep() {
        calls.push("importStep");
        return 11;
      },
      tessellate() {
        calls.push("tessellate");
        started.resolve();
        return pending.promise;
      },
      async release() {
        calls.push("release");
      },
      terminate() {
        calls.push("terminate");
      },
    };
    const controller = new AbortController();
    const importer = new STEPImporter(createWorkerFactory(worker));
    const primary = primaryFile();
    const importing = importer.import(
      primary,
      [primary],
      options({ signal: controller.signal }),
    );

    await started.promise;
    const reason = new Error("stop tessellation");
    controller.abort(reason);

    await assert.rejects(importing, (error) => error === reason);
    assert.deepEqual(calls, ["importStep", "tessellate", "terminate"]);
  });
});
