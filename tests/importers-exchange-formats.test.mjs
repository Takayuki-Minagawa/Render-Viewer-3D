import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { DOMParser } from "linkedom";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let FBXImporter;
let ColladaImporter;
let DEFAULT_IMPORT_OPTIONS;
let preflightBinaryFBX;
let FBX_BINARY_PREFLIGHT_LIMITS;
let previousDOMParserDescriptor;

before(async () => {
  previousDOMParserDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "DOMParser",
  );
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    writable: true,
    value: DOMParser,
  });
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ FBXImporter } = await server.ssrLoadModule(
    "/src/importers/FBXImporter.ts",
  ));
  ({ ColladaImporter } = await server.ssrLoadModule(
    "/src/importers/ColladaImporter.ts",
  ));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
  ({ preflightBinaryFBX, FBX_BINARY_PREFLIGHT_LIMITS } =
    await server.ssrLoadModule(
      "/src/importers/fbx-binary-preflight.ts",
    ));
});

after(async () => {
  await server?.close();
  if (previousDOMParserDescriptor) {
    Object.defineProperty(
      globalThis,
      "DOMParser",
      previousDOMParserDescriptor,
    );
  } else {
    delete globalThis.DOMParser;
  }
});

function options(overrides = {}) {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
    ...overrides,
  };
}

function asciiFBXWithUpAxis(axis) {
  return [
    "GlobalSettings: {",
    "  Properties70: {",
    `    P: "UpAxis", "int", "Integer", "",${axis}`,
    "  }",
    "}",
  ].join("\n");
}

const FBX_BINARY_MAGIC = new TextEncoder().encode(
  "Kaydara FBX Binary  \0\u001a\0",
);

function concatenateBytes(...parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function uint32Bytes(value) {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}

function int16Property(value) {
  const result = new Uint8Array(3);
  result[0] = "Y".charCodeAt(0);
  new DataView(result.buffer).setInt16(1, value, true);
  return result;
}

function zlibPayload(data) {
  return new Uint8Array(deflateSync(data));
}

function writeNodeField(view, offset, value, modern) {
  if (modern) {
    view.setBigUint64(
      offset,
      typeof value === "bigint" ? value : BigInt(value),
      true,
    );
  } else {
    view.setUint32(offset, Number(value), true);
  }
}

function binaryArrayProperty({
  type = "f",
  elementCount,
  encoding = 1,
  payload = new Uint8Array(),
  declaredCompressedBytes = payload.byteLength,
}) {
  return concatenateBytes(
    Uint8Array.of(type.charCodeAt(0)),
    uint32Bytes(elementCount),
    uint32Bytes(encoding),
    uint32Bytes(declaredCompressedBytes),
    payload,
  );
}

function encodeBinaryNode(definition, version, startOffset) {
  const modern = version >= 7500;
  const nodeHeaderBytes = modern ? 25 : 13;
  const name = new TextEncoder().encode(definition.name ?? "Node");
  const properties = definition.properties ?? [];
  const propertyBytes = concatenateBytes(...properties);
  let nextOffset =
    startOffset + nodeHeaderBytes + name.byteLength + propertyBytes.byteLength;
  const children = [];
  for (const childDefinition of definition.children ?? []) {
    const child = encodeBinaryNode(childDefinition, version, nextOffset);
    children.push(child.bytes);
    nextOffset += child.bytes.byteLength;
  }
  if ((definition.children?.length ?? 0) > 0) {
    children.push(new Uint8Array(nodeHeaderBytes));
    nextOffset += nodeHeaderBytes;
  }

  const header = new Uint8Array(nodeHeaderBytes);
  const view = new DataView(header.buffer);
  const fieldBytes = modern ? 8 : 4;
  writeNodeField(
    view,
    0,
    definition.endOffsetOverride ?? nextOffset,
    modern,
  );
  writeNodeField(
    view,
    fieldBytes,
    definition.propertyCountOverride ?? properties.length,
    modern,
  );
  writeNodeField(
    view,
    fieldBytes * 2,
    definition.propertyListBytesOverride ?? propertyBytes.byteLength,
    modern,
  );
  view.setUint8(nodeHeaderBytes - 1, name.byteLength);

  return {
    bytes: concatenateBytes(header, name, propertyBytes, ...children),
  };
}

function binaryFBX({
  version = 7400,
  nodes = [{}],
  leadingNullRecords = 0,
} = {}) {
  const header = concatenateBytes(FBX_BINARY_MAGIC, uint32Bytes(version));
  const nodeHeaderBytes = version >= 7500 ? 25 : 13;
  const parts = [header];
  let nextOffset = header.byteLength;
  for (let index = 0; index < leadingNullRecords; index += 1) {
    parts.push(new Uint8Array(nodeHeaderBytes));
    nextOffset += nodeHeaderBytes;
  }
  for (const definition of nodes) {
    const node = encodeBinaryNode(definition, version, nextOffset);
    parts.push(node.bytes);
    nextOffset += node.bytes.byteLength;
  }
  parts.push(
    new Uint8Array(nodeHeaderBytes),
    // Matches the minimum footer window that FBXLoader excludes from parsing.
    new Uint8Array(176),
  );
  return concatenateBytes(...parts);
}

function nestedBinaryNode(depth) {
  let node = {};
  for (let level = 1; level < depth; level += 1) {
    node = { children: [node] };
  }
  return node;
}

function triangleMesh(material = new THREE.MeshStandardMaterial()) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      3,
    ),
  );
  return new THREE.Mesh(geometry, material);
}

function oversizedGeometryFixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.getAttribute = (name) =>
    name === "position" ? { count: 2_000_001 } : undefined;
  const disposal = { count: 0 };
  geometry.dispose = () => {
    disposal.count += 1;
  };
  return {
    mesh: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()),
    disposal,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installObjectUrlSpies() {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created = [];
  const revoked = [];

  URL.createObjectURL = (value) => {
    const url = `blob:exchange-test-${created.length + 1}`;
    created.push({ url, value });
    return url;
  };
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
  };

  return {
    created,
    revoked,
    restore() {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}

function createDisposableFixture() {
  const counts = {
    geometry: 0,
    material: 0,
    texture: 0,
    image: 0,
    skeleton: 0,
    instancedMesh: 0,
    light: 0,
    shadowMap: 0,
  };
  const image = {
    close() {
      counts.image += 1;
    },
  };
  const texture = new THREE.Texture(image);
  texture.dispose = () => {
    counts.texture += 1;
  };
  const material = new THREE.MeshStandardMaterial({ map: texture });
  material.normalMap = texture;
  material.dispose = () => {
    counts.material += 1;
  };
  const first = triangleMesh(material);
  first.geometry.dispose = () => {
    counts.geometry += 1;
  };
  const second = new THREE.Mesh(first.geometry, material);
  const skeleton = new THREE.Skeleton([new THREE.Bone()]);
  skeleton.boneTexture = texture;
  const originalSkeletonDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => {
    counts.skeleton += 1;
    originalSkeletonDispose();
  };
  const skinned = new THREE.SkinnedMesh(first.geometry, material);
  skinned.bind(skeleton);
  const instanced = new THREE.InstancedMesh(first.geometry, material, 1);
  instanced.morphTexture = texture;
  instanced.dispose = () => {
    counts.instancedMesh += 1;
  };
  const light = new THREE.DirectionalLight();
  const shadowMap = new THREE.WebGLRenderTarget(1, 1);
  shadowMap.dispose = () => {
    counts.shadowMap += 1;
  };
  light.shadow.map = shadowMap;
  const originalLightDispose = light.dispose.bind(light);
  light.dispose = () => {
    counts.light += 1;
    originalLightDispose();
  };

  const root = new THREE.Group();
  root.add(first, second, skinned, instanced, light);
  return { root, counts };
}

describe("FBXImporter", () => {
  it("preflights 32/64-bit records, compressed arrays, and scalar Y before parsing", async () => {
    for (const version of [7400, 7500]) {
      let loaderFactoryCalls = 0;
      let tgaFactoryCalls = 0;
      let parseCalls = 0;
      const scene = new THREE.Group();
      scene.userData.unitScaleFactor = 100;
      scene.add(triangleMesh());
      const importer = new FBXImporter({
        createLoader() {
          loaderFactoryCalls += 1;
          return {
            parse() {
              parseCalls += 1;
              return scene;
            },
          };
        },
        createTgaLoader(manager) {
          tgaFactoryCalls += 1;
          return new THREE.Loader(manager);
        },
      });
      const source = binaryFBX({
        version,
        nodes: [
          {
            properties: [
              int16Property(1234),
              binaryArrayProperty({
                elementCount: 8,
                payload: zlibPayload(new Uint8Array(8 * 4)),
              }),
            ],
          },
        ],
      });
      const primary = new File([source], `binary-${version}.fbx`);

      const imported = await importer.import(
        primary,
        [primary],
        options(),
      );

      assert.equal(imported.metadata.triangleCount, 1);
      assert.equal(loaderFactoryCalls, 1);
      assert.equal(tgaFactoryCalls, 1);
      assert.equal(parseCalls, 1);
    }
  });

  it("rejects understated zlib output before creating either loader", async () => {
    let loaderFactoryCalls = 0;
    let tgaFactoryCalls = 0;
    const importer = new FBXImporter({
      createLoader() {
        loaderFactoryCalls += 1;
        return { parse: () => new THREE.Group() };
      },
      createTgaLoader(manager) {
        tgaFactoryCalls += 1;
        return new THREE.Loader(manager);
      },
    });
    const actualOutput = new Uint8Array(1024 * 1024);
    actualOutput.fill(0x5a);
    const compressedBomb = zlibPayload(actualOutput);
    const source = binaryFBX({
      nodes: [
        {
          properties: [
            binaryArrayProperty({
              // The declaration claims one float (4 bytes), while the zlib
              // stream actually expands to one MiB.
              elementCount: 1,
              payload: compressedBomb,
            }),
          ],
        },
      ],
    });
    const primary = new File([source], "understated-array.fbx");

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /actual expansion exceeds its declared 4-byte size/u,
    );
    assert.equal(loaderFactoryCalls, 0);
    assert.equal(tgaFactoryCalls, 0);
  });

  it("rejects unsafe binary array declarations before creating either loader", async () => {
    const unsafeCases = [
      {
        name: "ratio",
        source: binaryFBX({
          leadingNullRecords: 1,
          nodes: [
            {
              properties: [
                binaryArrayProperty({
                  elementCount: 1_000,
                  payload: new Uint8Array(1),
                }),
              ],
            },
          ],
        }),
        expected: /200:1 compression-ratio safety limit/u,
      },
      {
        name: "expanded",
        source: binaryFBX({
          nodes: [
            {
              properties: [
                binaryArrayProperty({
                  elementCount: 20_000_000,
                  payload: new Uint8Array(400_000),
                }),
              ],
            },
          ],
        }),
        expected: /per-array safety limit/u,
      },
      {
        name: "compressed",
        source: binaryFBX({
          nodes: [
            {
              properties: [
                binaryArrayProperty({
                  elementCount: 0,
                  declaredCompressedBytes: 32 * 1024 * 1024 + 1,
                }),
              ],
            },
          ],
        }),
        expected: /compressed-payload safety limit/u,
      },
      {
        name: "truncated",
        source: binaryFBX({
          nodes: [
            {
              properties: [
                binaryArrayProperty({
                  elementCount: 256,
                  declaredCompressedBytes: 256,
                }),
              ],
            },
          ],
        }),
        expected: /array property payload is truncated or out of bounds/u,
      },
      {
        name: "legacy-oob-node",
        source: binaryFBX({
          version: 7400,
          nodes: [{ endOffsetOverride: 0xffff_ffff }],
        }),
        expected: /node end offset is out of bounds/u,
      },
      {
        name: "modern-unsafe-offset",
        source: binaryFBX({
          version: 7500,
          nodes: [
            {
              endOffsetOverride:
                BigInt(Number.MAX_SAFE_INTEGER) + 1n,
            },
          ],
        }),
        expected: /node end offset is not safely representable/u,
      },
    ];

    for (const { name, source, expected } of unsafeCases) {
      let loaderFactoryCalls = 0;
      let tgaFactoryCalls = 0;
      const importer = new FBXImporter({
        createLoader() {
          loaderFactoryCalls += 1;
          return { parse: () => new THREE.Group() };
        },
        createTgaLoader(manager) {
          tgaFactoryCalls += 1;
          return new THREE.Loader(manager);
        },
      });
      const primary = new File([source], `${name}.fbx`);

      await assert.rejects(
        importer.import(primary, [primary], options()),
        expected,
      );
      assert.equal(loaderFactoryCalls, 0, name);
      assert.equal(tgaFactoryCalls, 0, name);
    }
  });

  it("caps cumulative expanded arrays, binary node count, and binary depth", async () => {
    const cumulativeSource = binaryFBX({
      nodes: [
        {
          properties: Array.from({ length: 4 }, () =>
            binaryArrayProperty({
              elementCount: 10_000_000,
              payload: new Uint8Array(200_000),
            }),
          ),
        },
      ],
    });
    await assert.rejects(
      preflightBinaryFBX(cumulativeSource.buffer),
      /arrays expand .* total safety limit/u,
    );

    const twoNodes = binaryFBX({ nodes: [{}, {}] });
    await assert.rejects(
      preflightBinaryFBX(twoNodes.buffer, {
        ...FBX_BINARY_PREFLIGHT_LIMITS,
        maxNodes: 1,
      }),
      /more than 1 nodes/u,
    );

    const deepTree = binaryFBX({ nodes: [nestedBinaryNode(5)] });
    await assert.rejects(
      preflightBinaryFBX(deepTree.buffer, {
        ...FBX_BINARY_PREFLIGHT_LIMITS,
        maxDepth: 4,
      }),
      /node depth exceeds the safety limit of 4/u,
    );
  });

  it("preserves loader hierarchy and animations while applying UnitScaleFactor once", async () => {
    const scene = new THREE.Group();
    scene.name = "FBX Fixture";
    scene.userData.unitScaleFactor = 2.54;
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const animation = new THREE.AnimationClip("Fixture Animation", 1, []);
    scene.animations = [animation];
    let tgaHandler;

    const importer = new FBXImporter({
      createLoader(manager) {
        return {
          parse(source, path) {
            assert.ok(source instanceof ArrayBuffer);
            assert.equal(path, "");
            tgaHandler = manager.getHandler("fixture.TGA");
            return scene;
          },
        };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File([asciiFBXWithUpAxis(2)], "fixture.FBX");
    const imported = await importer.import(primary, [primary], options());

    assert.ok(tgaHandler, "the TGA handler must be registered before parse");
    assert.equal(importer.canImport(primary), true);
    assert.equal(imported.root.name, "fixture.FBX");
    assert.equal(imported.root.children[0], scene);
    assert.deepEqual(imported.root.animations, [animation]);
    assert.equal(scene.rotation.x, 0);
    assert.equal(scene.scale.x, 1);
    assert.ok(Math.abs(imported.root.scale.x - 0.0254) < 1e-12);
    assert.ok(Math.abs(imported.root.rotation.x + Math.PI / 2) < 1e-12);
    assert.equal(imported.root.userData.fbxUnitScaleFactor, 2.54);
    assert.equal(imported.metadata.format, "FBX");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.equal(imported.metadata.unit, "meter");
    assert.equal(imported.metadata.sourceUnit, "2.54 centimeters per unit");
    assert.deepEqual(imported.warnings, []);
  });

  it("waits for local sidecars before resolving and revoking object URLs", async () => {
    const urls = installObjectUrlSpies();
    const parseStarted = deferred();
    let finishSidecar;
    try {
      const importer = new FBXImporter({
        createLoader(manager) {
          return {
            parse() {
              const embeddedUrl = URL.createObjectURL(new Blob(["embedded"]));
              const url = manager.resolveURL("textures/diffuse.png");
              manager.itemStart(embeddedUrl);
              manager.itemStart(url);
              finishSidecar = () => {
                manager.itemEnd(embeddedUrl);
                manager.itemEnd(url);
              };
              parseStarted.resolve();
              const root = new THREE.Group();
              root.userData.unitScaleFactor = 100;
              root.add(triangleMesh());
              return root;
            },
          };
        },
        createTgaLoader(manager) {
          return new THREE.Loader(manager);
        },
      });
      const primary = new File(["fixture"], "model.fbx");
      const sidecar = new File(["png"], "textures/diffuse.png", {
        type: "image/png",
      });
      const importing = importer.import(
        primary,
        [primary, sidecar],
        options(),
      );
      let settled = false;
      void importing.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await parseStarted.promise;
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(urls.created.length, 2);
      assert.deepEqual(urls.revoked, []);

      finishSidecar();
      await importing;
      assert.equal(settled, true);
      assert.deepEqual(urls.revoked, [
        urls.created[0].url,
        urls.created[1].url,
      ]);
    } finally {
      urls.restore();
    }
  });

  it("revokes embedded Blob URLs created during parse even when unreferenced", async () => {
    const urls = installObjectUrlSpies();
    try {
      const importer = new FBXImporter({
        createLoader() {
          return {
            parse() {
              URL.createObjectURL(new Blob(["unreferenced"]));
              const root = new THREE.Group();
              root.userData.unitScaleFactor = 100;
              root.add(triangleMesh());
              return root;
            },
          };
        },
        createTgaLoader(manager) {
          return new THREE.Loader(manager);
        },
      });
      const primary = new File(["fixture"], "embedded.fbx");

      await importer.import(primary, [primary], options());
      assert.equal(urls.created.length, 1);
      assert.deepEqual(urls.revoked, [urls.created[0].url]);
    } finally {
      urls.restore();
    }
  });

  it("aborts manager waits and disposes parsed resources exactly once", async () => {
    const urls = installObjectUrlSpies();
    const parseStarted = deferred();
    const controller = new AbortController();
    const fixture = createDisposableFixture();
    let abortCount = 0;
    try {
      const importer = new FBXImporter({
        createLoader(manager) {
          const originalAbort = manager.abort.bind(manager);
          let pendingUrl;
          manager.abort = () => {
            abortCount += 1;
            if (pendingUrl) manager.itemEnd(pendingUrl);
            return originalAbort();
          };
          return {
            parse() {
              pendingUrl = manager.resolveURL("texture.png");
              manager.itemStart(pendingUrl);
              parseStarted.resolve();
              return fixture.root;
            },
          };
        },
        createTgaLoader(manager) {
          return new THREE.Loader(manager);
        },
      });
      const primary = new File(["fixture"], "model.fbx");
      const sidecar = new File(["png"], "texture.png");
      const importing = importer.import(
        primary,
        [primary, sidecar],
        options({ signal: controller.signal }),
      );

      await parseStarted.promise;
      controller.abort(new DOMException("cancelled", "AbortError"));
      await assert.rejects(importing, /cancelled/);

      assert.equal(abortCount, 1);
      assert.deepEqual(fixture.counts, {
        geometry: 1,
        material: 1,
        texture: 1,
        image: 1,
        skeleton: 1,
        instancedMesh: 1,
        light: 1,
        shadowMap: 1,
      });
      assert.deepEqual(urls.revoked, [urls.created[0].url]);
    } finally {
      urls.restore();
    }
  });

  it("reports sidecar load errors, releases URLs, and cleans the temporary scene", async () => {
    const urls = installObjectUrlSpies();
    const fixture = createDisposableFixture();
    try {
      const importer = new FBXImporter({
        createLoader(manager) {
          return {
            parse() {
              const url = manager.resolveURL("broken.png");
              manager.itemStart(url);
              queueMicrotask(() => {
                manager.itemError(url);
                manager.itemEnd(url);
              });
              return fixture.root;
            },
          };
        },
        createTgaLoader(manager) {
          return new THREE.Loader(manager);
        },
      });
      const primary = new File(["fixture"], "model.fbx");
      const sidecar = new File(["invalid"], "broken.png");

      await assert.rejects(
        importer.import(primary, [primary, sidecar], options()),
        /Failed to load local model sidecar resource/,
      );
      assert.deepEqual(fixture.counts, {
        geometry: 1,
        material: 1,
        texture: 1,
        image: 1,
        skeleton: 1,
        instancedMesh: 1,
        light: 1,
        shadowMap: 1,
      });
      assert.deepEqual(urls.revoked, [urls.created[0].url]);
    } finally {
      urls.restore();
    }
  });

  it("rejects missing and external resource references explicitly", async () => {
    for (const [reference, expected] of [
      ["missing.png", /Referenced local model resource was not selected/],
      ["https://example.test/texture.png", /External model resources are not loaded/],
    ]) {
      const importer = new FBXImporter({
        createLoader(manager) {
          return {
            parse() {
              manager.resolveURL(reference);
              return new THREE.Group();
            },
          };
        },
        createTgaLoader(manager) {
          return new THREE.Loader(manager);
        },
      });
      const primary = new File(["fixture"], "model.fbx");
      await assert.rejects(
        importer.import(primary, [primary], options()),
        expected,
      );
    }
  });

  it("enforces the 32 MiB budget across all selected files before loading", async () => {
    let factoryCalls = 0;
    const importer = new FBXImporter({
      createLoader() {
        factoryCalls += 1;
        return { parse: () => new THREE.Group() };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File(["fixture"], "model.fbx");
    const sidecar = new File([""], "texture.png");
    Object.defineProperty(sidecar, "size", {
      value: 32 * 1024 * 1024 + 1,
    });

    await assert.rejects(
      importer.import(primary, [primary, sidecar], options()),
      /32 MiB main-thread safety limit/,
    );
    assert.equal(factoryCalls, 0);
  });

  it("honors explicit unit and axis overrides after undoing loader corrections", async () => {
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 2.54;
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const importer = new FBXImporter({
      createLoader() {
        return { parse: () => scene };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File([asciiFBXWithUpAxis(2)], "override.fbx");
    const imported = await importer.import(
      primary,
      [primary],
      options({ unit: "meter", coordinateSystem: "y-up" }),
    );

    assert.equal(scene.scale.x, 1);
    assert.equal(scene.rotation.x, 0);
    assert.equal(imported.root.scale.x, 1);
    assert.equal(imported.root.rotation.x, 0);
    assert.equal(
      imported.metadata.sourceUnit,
      "2.54 centimeters per unit",
    );
  });

  it("preserves an authored exact -90-degree root rotation in an ASCII Y-up FBX", async () => {
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const importer = new FBXImporter({
      createLoader() {
        return { parse: () => scene };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File(
      [asciiFBXWithUpAxis(1)],
      "authored-y-up-rotation.fbx",
    );

    const imported = await importer.import(
      primary,
      [primary],
      options(),
    );

    assert.equal(scene.rotation.x, -Math.PI / 2);
    assert.equal(imported.root.rotation.x, 0);
    assert.equal(imported.root.scale.x, 1);
    assert.equal(imported.metadata.sourceUnit, "100 centimeters per unit");
  });

  it("rejects an explicitly declared unsupported ASCII UpAxis before parse", async () => {
    let parseCalls = 0;
    const importer = new FBXImporter({
      createLoader() {
        return {
          parse() {
            parseCalls += 1;
            return new THREE.Group();
          },
        };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File(
      [asciiFBXWithUpAxis(0)],
      "x-up.fbx",
    );

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /Unsupported FBX UpAxis value: 0/u,
    );
    assert.equal(parseCalls, 0);
  });

  it("counts FBX lines without triangles and warns that Custom PBR is mesh-only", async () => {
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3),
    );
    const material = new THREE.LineBasicMaterial({ color: 0x336699 });
    const line = new THREE.Line(geometry, material);
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    scene.add(line);
    const importer = new FBXImporter({
      createLoader() {
        return { parse: () => scene };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File(
      [asciiFBXWithUpAxis(1)],
      "line.fbx",
    );

    const imported = await importer.import(
      primary,
      [primary],
      options(),
    );

    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 0);
    assert.equal(imported.metadata.materialCount, 1);
    assert.equal(line.material, material);
    assert.deepEqual(
      imported.warnings.map(({ code }) => code),
      ["fbx-line-custom-material-unsupported"],
    );
  });

  it("keeps a deep-tree budget error while iteratively disposing its resources", async () => {
    const geometry = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        3,
      ),
    );
    const material = new THREE.MeshBasicMaterial();
    let geometryDisposals = 0;
    let materialDisposals = 0;
    geometry.dispose = () => {
      geometryDisposals += 1;
    };
    material.dispose = () => {
      materialDisposals += 1;
    };
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    let parent = scene;
    for (let index = 0; index < 300; index += 1) {
      const child = new THREE.Group();
      parent.add(child);
      parent = child;
    }
    parent.add(new THREE.Mesh(geometry, material));
    const importer = new FBXImporter({
      createLoader() {
        return { parse: () => scene };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File([asciiFBXWithUpAxis(1)], "deep.fbx");

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /FBX output exceeds the main-thread geometry safety budget/u,
    );
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
  });

  it("rejects oversized parsed geometry and disposes it", async () => {
    const fixture = oversizedGeometryFixture();
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    scene.add(fixture.mesh);
    const importer = new FBXImporter({
      createLoader() {
        return { parse: () => scene };
      },
      createTgaLoader(manager) {
        return new THREE.Loader(manager);
      },
    });
    const primary = new File(["fixture"], "oversized.fbx");

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /FBX output exceeds the main-thread geometry safety budget/,
    );
    assert.equal(fixture.disposal.count, 1);
  });
});

describe("ColladaImporter", () => {
  it("uses result.scene animations without applying loader-owned unit or Z-up conversions twice", async () => {
    const scene = new THREE.Scene();
    scene.name = "DAE Fixture";
    scene.scale.setScalar(0.01);
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const animation = new THREE.AnimationClip("DAE Animation", 1, []);
    scene.animations = [animation];
    const importer = new ColladaImporter({
      createLoader() {
        return {
          parse(source, path) {
            assert.match(source, /<unit meter="0.01"/);
            assert.match(source, /<up_axis>Z_UP<\/up_axis>/);
            assert.equal(path, "");
            return { scene };
          },
        };
      },
    });
    const source = [
      "<COLLADA>",
      "<asset><unit meter=\"0.01\"/><up_axis>Z_UP</up_axis></asset>",
      "</COLLADA>",
    ].join("");
    const primary = new File([source], "fixture.DAE");
    const imported = await importer.import(primary, [primary], options());

    assert.equal(importer.canImport(primary), true);
    assert.equal(imported.root.children[0], scene);
    assert.deepEqual(imported.root.animations, [animation]);
    assert.equal(imported.root.scale.x, 0.01);
    assert.ok(Math.abs(imported.root.rotation.x + Math.PI / 2) < 1e-12);
    assert.equal(scene.scale.x, 1);
    assert.equal(scene.rotation.x, 0);
    assert.equal(imported.metadata.format, "COLLADA");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.equal(imported.metadata.unit, "meter");
    assert.equal(imported.metadata.sourceUnit, "0.01 meters per unit");
    assert.deepEqual(imported.warnings, []);
  });

  it("handles quoted delimiters, processing instructions, comments, and CDATA", async () => {
    const scene = new THREE.Scene();
    scene.scale.setScalar(0.02);
    scene.add(triangleMesh());
    const importer = new ColladaImporter({
      createLoader() {
        return { parse: () => ({ scene }) };
      },
    });
    const source = [
      "<COLLADA label=\"quoted > delimiter\">",
      "<?inspection fake=\"quoted > delimiter\"?>",
      "<!-- <!DOCTYPE COLLADA><asset><unit name=\"fake\" meter=\"9\"/><up_axis>Z_UP</up_axis></asset> -->",
      "<![CDATA[<!ENTITY fake \"value\"><asset><unit meter=\"7\"/><up_axis>Z_UP</up_axis></asset>]]>",
      "<asset>",
      "<unit name=\"two centimeters\" meter=\"0.02\"/>",
      "<up_axis>Y_UP</up_axis>",
      "</asset>",
      "</COLLADA>",
    ].join("");
    const primary = new File([source], "comment-metadata.dae");

    const imported = await importer.import(
      primary,
      [primary],
      options(),
    );

    assert.equal(scene.scale.x, 1);
    assert.equal(scene.rotation.x, 0);
    assert.equal(imported.root.scale.x, 0.02);
    assert.equal(imported.root.rotation.x, 0);
    assert.equal(imported.metadata.sourceUnit, "two centimeters");
  });

  it("rejects non-COLLADA and malformed XML before invoking the loader", async () => {
    let factoryCalls = 0;
    let parseCalls = 0;
    const importer = new ColladaImporter({
      createLoader() {
        factoryCalls += 1;
        return {
          parse() {
            parseCalls += 1;
            return { scene: new THREE.Scene() };
          },
        };
      },
    });
    const primary = new File(["<not-collada/>"], "invalid-root.dae");
    await assert.rejects(
      importer.import(primary, [primary], options()),
      /not well-formed COLLADA XML/u,
    );
    assert.equal(factoryCalls, 0);
    assert.equal(parseCalls, 0);
  });

  it("rejects wide and deeply nested malformed markup before DOM construction or loader creation", async () => {
    const parser = globalThis.DOMParser;
    let domParserConstructions = 0;
    let factoryCalls = 0;
    globalThis.DOMParser = class CountingDOMParser {
      constructor() {
        domParserConstructions += 1;
        this.delegate = new parser();
      }

      parseFromString(source, type) {
        return this.delegate.parseFromString(source, type);
      }
    };
    const importer = new ColladaImporter({
      createLoader() {
        factoryCalls += 1;
        return { parse: () => ({ scene: new THREE.Scene() }) };
      },
    });
    const fixtures = [
      [
        `<COLLADA>${"<extra/>".repeat(100_000)}`,
        /element-count limit/u,
      ],
      [
        [
          "<COLLADA label=\"quoted > delimiter\">",
          "<?inspection fake=\"<extra/>\"?>",
          "<!-- <extra><extra/></extra> -->",
          "<![CDATA[<extra><extra/></extra>]]>",
          "<extra>".repeat(256),
        ].join(""),
        /XML markup nesting exceeds the safe depth limit/u,
      ],
    ];

    try {
      for (const [source, expected] of fixtures) {
        const primary = new File([source], "lexical-budget.dae");
        await assert.rejects(
          importer.import(primary, [primary], options()),
          expected,
        );
      }
    } finally {
      globalThis.DOMParser = parser;
    }

    assert.equal(domParserConstructions, 0);
    assert.equal(factoryCalls, 0);
  });

  it("rejects DTDs, instance_node expansion, and excessive node depth before parse", async () => {
    const deepNodes = [
      "<COLLADA><library_visual_scenes><visual_scene>",
      "<node>".repeat(257),
      "</node>".repeat(257),
      "</visual_scene></library_visual_scenes></COLLADA>",
    ].join("");
    for (const [source, expected] of [
      [
        "<!DOCTYPE COLLADA [<!ENTITY fake 'value'>]><COLLADA/>",
        /DOCTYPE and ENTITY declarations are not supported/u,
      ],
      [
        [
          "<COLLADA><library_nodes>",
          "<node id=\"a\"><instance_node url=\"#a\"/></node>",
          "</library_nodes></COLLADA>",
        ].join(""),
        /instance_node references are not supported/u,
      ],
      [deepNodes, /nesting exceeds the safe depth limit/u],
    ]) {
      let factoryCalls = 0;
      let parseCalls = 0;
      const importer = new ColladaImporter({
        createLoader() {
          factoryCalls += 1;
          return {
            parse() {
              parseCalls += 1;
              return { scene: new THREE.Scene() };
            },
          };
        },
      });
      const primary = new File([source], "unsafe-structure.dae");
      await assert.rejects(
        importer.import(primary, [primary], options()),
        expected,
      );
      assert.equal(factoryCalls, 0);
      assert.equal(parseCalls, 0);
    }
  });

  it("honors explicit unit and axis overrides after undoing loader normalization", async () => {
    const scene = new THREE.Scene();
    scene.scale.setScalar(0.01);
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const importer = new ColladaImporter({
      createLoader() {
        return { parse: () => ({ scene }) };
      },
    });
    const primary = new File(
      [
        "<COLLADA><asset>",
        "<unit name=\"centimeter\" meter=\"0.01\"/>",
        "<up_axis>Z_UP</up_axis>",
        "</asset></COLLADA>",
      ],
      "override.dae",
    );
    const imported = await importer.import(
      primary,
      [primary],
      options({ unit: "meter", coordinateSystem: "y-up" }),
    );

    assert.equal(scene.scale.x, 1);
    assert.equal(scene.rotation.x, 0);
    assert.equal(imported.root.scale.x, 1);
    assert.equal(imported.root.rotation.x, 0);
    assert.equal(imported.metadata.sourceUnit, "centimeter");
  });

  it("rejects invalid meter and unsupported X_UP metadata before parse", async () => {
    for (const [asset, expected] of [
      ["<unit meter=\"NaN\"/>", /meter must be a positive finite number/],
      ["<up_axis>X_UP</up_axis>", /X_UP assets are not supported/],
    ]) {
      let parseCalls = 0;
      const importer = new ColladaImporter({
        createLoader() {
          return {
            parse() {
              parseCalls += 1;
              return { scene: new THREE.Scene() };
            },
          };
        },
      });
      const primary = new File(
        [`<COLLADA><asset>${asset}</asset></COLLADA>`],
        "invalid.dae",
      );
      await assert.rejects(
        importer.import(primary, [primary], options()),
        expected,
      );
      assert.equal(parseCalls, 0);
    }
  });

  it("rejects oversized parsed geometry and disposes it", async () => {
    const fixture = oversizedGeometryFixture();
    const scene = new THREE.Scene().add(fixture.mesh);
    const importer = new ColladaImporter({
      createLoader() {
        return { parse: () => ({ scene }) };
      },
    });
    const primary = new File(["<COLLADA/>"] , "oversized.dae");

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /COLLADA output exceeds the main-thread geometry safety budget/,
    );
    assert.equal(fixture.disposal.count, 1);
  });

  it("rejects ambiguous local basenames with an actionable error", async () => {
    const importer = new ColladaImporter({
      createLoader(manager) {
        return {
          parse() {
            manager.resolveURL("diffuse.png");
            return { scene: new THREE.Scene() };
          },
        };
      },
    });
    const primary = new File(["<COLLADA/>"] , "model.dae");
    const first = new File(["one"], "diffuse.png");
    const second = new File(["two"], "diffuse.png");
    Object.defineProperty(first, "webkitRelativePath", {
      value: "materials/a/diffuse.png",
    });
    Object.defineProperty(second, "webkitRelativePath", {
      value: "materials/b/diffuse.png",
    });

    await assert.rejects(
      importer.import(primary, [primary, first, second], options()),
      /Ambiguous local model resource/,
    );
  });
});
