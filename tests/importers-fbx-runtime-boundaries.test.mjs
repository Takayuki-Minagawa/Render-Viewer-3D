import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let server;
let FBXImporter;
let DEFAULT_IMPORT_OPTIONS;
let FBX_BINARY_PREFLIGHT_LIMITS;
let inspectBinaryFBX;
let parseWithLoaderResourceWait;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ FBXImporter } = await server.ssrLoadModule(
    "/src/importers/FBXImporter.ts",
  ));
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
  ({ FBX_BINARY_PREFLIGHT_LIMITS, inspectBinaryFBX } =
    await server.ssrLoadModule(
      "/src/importers/fbx-binary-preflight.ts",
    ));
  ({ parseWithLoaderResourceWait } = await server.ssrLoadModule(
    "/src/importers/loader-resource-wait.ts",
  ));
});

after(async () => {
  await server?.close();
});

function options() {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
  };
}

const FBX_BINARY_MAGIC = new TextEncoder().encode(
  "Kaydara FBX Binary  \0\u001a\0",
);

function concatenateBytes(...parts) {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
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

function int32Property(value) {
  const result = new Uint8Array(5);
  result[0] = "I".charCodeAt(0);
  new DataView(result.buffer).setInt32(1, value, true);
  return result;
}

function float32Property(value) {
  const result = new Uint8Array(5);
  result[0] = "F".charCodeAt(0);
  new DataView(result.buffer).setFloat32(1, value, true);
  return result;
}

function stringProperty(value) {
  const bytes = new TextEncoder().encode(value);
  return concatenateBytes(
    Uint8Array.of("S".charCodeAt(0)),
    uint32Bytes(bytes.byteLength),
    bytes,
  );
}

function binaryArrayProperty() {
  return concatenateBytes(
    Uint8Array.of("f".charCodeAt(0)),
    uint32Bytes(0),
    uint32Bytes(1),
    uint32Bytes(0),
  );
}

function encodeBinaryNode(definition, startOffset) {
  const nodeHeaderBytes = 13;
  const name = new TextEncoder().encode(definition.name ?? "Node");
  const properties = definition.properties ?? [];
  const propertyBytes = concatenateBytes(...properties);
  let nextOffset =
    startOffset + nodeHeaderBytes + name.byteLength + propertyBytes.byteLength;
  const children = [];
  for (const childDefinition of definition.children ?? []) {
    const child = encodeBinaryNode(childDefinition, nextOffset);
    children.push(child);
    nextOffset += child.byteLength;
  }
  if ((definition.children?.length ?? 0) > 0) {
    children.push(new Uint8Array(nodeHeaderBytes));
    nextOffset += nodeHeaderBytes;
  }

  const header = new Uint8Array(nodeHeaderBytes);
  const view = new DataView(header.buffer);
  view.setUint32(0, nextOffset, true);
  view.setUint32(4, properties.length, true);
  view.setUint32(8, propertyBytes.byteLength, true);
  view.setUint8(12, name.byteLength);
  return concatenateBytes(header, name, propertyBytes, ...children);
}

function binaryFBX(nodes) {
  const header = concatenateBytes(FBX_BINARY_MAGIC, uint32Bytes(7400));
  const parts = [header];
  let nextOffset = header.byteLength;
  for (const definition of nodes) {
    const node = encodeBinaryNode(definition, nextOffset);
    parts.push(node);
    nextOffset += node.byteLength;
  }
  parts.push(new Uint8Array(13), new Uint8Array(176));
  return concatenateBytes(...parts);
}

function upAxisProperty(value, valueProperty = int32Property(value)) {
  return {
    name: "P",
    properties: [
      stringProperty("UpAxis"),
      stringProperty("int"),
      stringProperty("Integer"),
      stringProperty(""),
      valueProperty,
    ],
  };
}

function binaryFBXWithAxes(values) {
  return binaryFBX([
    {
      name: "GlobalSettings",
      children: [
        {
          name: "Properties70",
          children: values.map((value) =>
            typeof value === "object"
              ? upAxisProperty(1, value.property)
              : upAxisProperty(value),
          ),
        },
      ],
    },
  ]);
}

function triangleMesh() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 1, 0, 0, 0, 1, 0],
      3,
    ),
  );
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function importerForScene(scene, overrides = {}) {
  return new FBXImporter({
    createLoader() {
      return { parse: () => scene };
    },
    createTgaLoader(manager) {
      return new THREE.Loader(manager);
    },
    ...overrides,
  });
}

describe("FBX binary runtime boundaries", () => {
  it("extracts binary UpAxis and preserves an authored Y-up root rotation", async () => {
    const source = binaryFBXWithAxes([1]);
    assert.deepEqual(await inspectBinaryFBX(source.buffer), {
      isBinary: true,
      sourceCoordinateSystem: "y-up",
    });

    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const primary = new File([source], "authored-y-up.fbx");
    const imported = await importerForScene(scene).import(
      primary,
      [primary],
      options(),
    );

    assert.equal(scene.rotation.x, -Math.PI / 2);
    assert.equal(imported.root.rotation.x, 0);
  });

  it("removes one loader Z-up correction and reapplies it exactly once", async () => {
    const scene = new THREE.Group();
    scene.userData.unitScaleFactor = 100;
    scene.rotation.x = -Math.PI / 2;
    scene.add(triangleMesh());
    const source = binaryFBXWithAxes([2]);
    const primary = new File([source], "z-up.fbx");
    const imported = await importerForScene(scene).import(
      primary,
      [primary],
      options(),
    );

    assert.equal(scene.rotation.x, 0);
    assert.ok(Math.abs(imported.root.rotation.x + Math.PI / 2) < 1e-12);
  });

  it("rejects unsupported, invalid, duplicate, and conflicting binary axes before loader creation", async () => {
    const cases = [
      [binaryFBXWithAxes([0]), /Unsupported FBX UpAxis value: 0/u],
      [binaryFBXWithAxes([3]), /Invalid binary FBX UpAxis value: 3/u],
      [binaryFBXWithAxes([1, 1]), /duplicate UpAxis declarations/u],
      [binaryFBXWithAxes([1, 2]), /conflicting UpAxis declarations/u],
      [
        binaryFBXWithAxes([{ property: float32Property(1) }]),
        /invalid UpAxis declaration/u,
      ],
    ];

    for (const [source, expected] of cases) {
      let factoryCalls = 0;
      const importer = new FBXImporter({
        createLoader() {
          factoryCalls += 1;
          return { parse: () => new THREE.Group() };
        },
        createTgaLoader(manager) {
          factoryCalls += 1;
          return new THREE.Loader(manager);
        },
      });
      const primary = new File([source], "unsafe-axis.fbx");

      await assert.rejects(
        importer.import(primary, [primary], options()),
        expected,
      );
      assert.equal(factoryCalls, 0);
    }
  });

  it("caps compressed-array descriptors before loader creation", async () => {
    let factoryCalls = 0;
    const importer = new FBXImporter({
      binaryPreflightLimits: {
        ...FBX_BINARY_PREFLIGHT_LIMITS,
        maxCompressedArrays: 1,
      },
      createLoader() {
        factoryCalls += 1;
        return { parse: () => new THREE.Group() };
      },
      createTgaLoader(manager) {
        factoryCalls += 1;
        return new THREE.Loader(manager);
      },
    });
    const source = binaryFBX([
      {
        properties: [binaryArrayProperty(), binaryArrayProperty()],
      },
    ]);
    const primary = new File([source], "many-arrays.fbx");

    await assert.rejects(
      importer.import(primary, [primary], options()),
      /more than 1 compressed arrays/u,
    );
    assert.equal(factoryCalls, 0);
  });

  it("keeps externally owned Blob URLs and revokes only URLs created during parse", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const revoked = [];
    URL.createObjectURL = () => "blob:created-during-parse";
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
    };

    try {
      const manager = new THREE.LoadingManager();
      const externalUrl = "blob:owned-by-caller";
      const result = await parseWithLoaderResourceWait(manager, () => {
        manager.itemStart(externalUrl);
        manager.itemEnd(externalUrl);
        const embeddedUrl = URL.createObjectURL(new Blob(["embedded"]));
        manager.itemStart(embeddedUrl);
        manager.itemEnd(embeddedUrl);
        return embeddedUrl;
      });

      assert.equal(result, "blob:created-during-parse");
      assert.deepEqual(revoked, ["blob:created-during-parse"]);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
