import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import { DOMParser } from "linkedom";
import * as THREE from "three";
import {
  strToU8,
  zipSync,
} from "three/addons/libs/fflate.module.js";
import { createServer } from "vite";

let DEFAULT_IMPORT_OPTIONS;
let assertThreeMFMeshPositionVertexBudget;
let ThreeMFImporter;
let previousDOMParserDescriptor;
let server;

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
  ({ DEFAULT_IMPORT_OPTIONS } = await server.ssrLoadModule(
    "/src/importers/types.ts",
  ));
  ({
    ThreeMFImporter,
    assertThreeMFMeshPositionVertexBudget,
  } = await server.ssrLoadModule(
      "/src/importers/ThreeMFImporter.ts",
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

describe("ThreeMFImporter browser-format fixture", () => {
  it("rejects two individually bounded mesh position tables whose aggregate exceeds the budget", () => {
    assert.doesNotThrow(() =>
      assertThreeMFMeshPositionVertexBudget([1_000_000, 1_000_000]),
    );
    assert.throws(
      () =>
        assertThreeMFMeshPositionVertexBudget([
          1_000_001,
          1_000_000,
        ]),
      /mesh definitions exceed the 3MF component expansion safety budget/u,
    );
  });

  it("parses a real 3MF package with the Three.js addon", async () => {
    const archive = createThreeMFFixture();
    const primary = new File([archive], "triangle.3mf", {
      type: "model/3mf",
    });
    const imported = await new ThreeMFImporter().import(
      primary,
      [primary],
      importOptions(),
    );
    const mesh = findMesh(imported.root);
    const bounds = new THREE.Box3().setFromObject(imported.root);

    assert.equal(imported.metadata.format, "3MF");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.equal(mesh.material.color.getHex(), 0x336699);
    assert.ok(Math.abs(bounds.max.x - 1) < 1e-9);
    assert.ok(Math.abs(bounds.min.z + 1) < 1e-9);
    assert.equal(imported.metadata.sourceUnit, "millimeter");
    assert.deepEqual(imported.warnings, []);
  });

  it("uses model unit for Auto and preserves it under an explicit override", async () => {
    const archive = createThreeMFFixture({
      unit: "centimeter",
      extent: 100,
    });
    const autoFile = new File([archive], "centimeter-auto.3mf");
    const autoImported = await new ThreeMFImporter().import(
      autoFile,
      [autoFile],
      importOptions(),
    );
    const autoBounds = new THREE.Box3().setFromObject(autoImported.root);
    assert.ok(Math.abs(autoBounds.max.x - 1) < 1e-9);
    assert.equal(autoImported.metadata.sourceUnit, "centimeter");

    const explicitFile = new File([archive], "centimeter-explicit.3mf");
    const explicitImported = await new ThreeMFImporter().import(
      explicitFile,
      [explicitFile],
      importOptions({ unit: "meter" }),
    );
    const explicitBounds = new THREE.Box3().setFromObject(
      explicitImported.root,
    );
    assert.ok(Math.abs(explicitBounds.max.x - 100) < 1e-9);
    assert.equal(explicitImported.metadata.sourceUnit, "centimeter");
  });

  it("accepts exact finite 12-number component and build transforms", async () => {
    const transform = "1 0 0 0 1 0 0 0 1 2.5 -3 4";
    const meshObject = [
      '<object id="1"><mesh>',
      '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>',
      '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
      "</mesh></object>",
    ].join("");
    const componentObject =
      `<object id="2"><components><component objectid="1" transform="${transform}"/></components></object>`;
    let factoryCalls = 0;
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      return { parse: () => new THREE.Group() };
    });
    const archive = createThreeMFPackageFromModel(
      modelWithObjects(meshObject + componentObject, "2", transform),
    );
    const primary = new File([archive], "valid-transforms.3mf");

    await importer.import(primary, [primary], importOptions());
    assert.equal(factoryCalls, 1);
  });

  it("rejects unsafe component and build transforms before loader creation", async () => {
    const identity = "1 0 0 0 1 0 0 0 1 0 0 0";
    const invalidTransforms = [
      "",
      `NaN ${identity.slice(2)}`,
      `Infinity ${identity.slice(2)}`,
      "1 0 0 0 1 0 0 0 1 0 0",
      `${identity} 0`,
      identity.replace("1 0", "1  0"),
      `1garbage ${identity.slice(2)}`,
      `1e309 ${identity.slice(2)}`,
      "1".repeat(513),
    ];
    const meshObject = [
      '<object id="1"><mesh>',
      '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>',
      '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
      "</mesh></object>",
    ].join("");

    for (const target of ["component", "item"]) {
      for (const transform of invalidTransforms) {
        const objects = target === "component"
          ? meshObject +
            `<object id="2"><components><component objectid="1" transform="${transform}"/></components></object>`
          : meshObject;
        const buildObjectId = target === "component" ? "2" : "1";
        const buildTransform = target === "item" ? transform : undefined;
        let factoryCalls = 0;
        const importer = new ThreeMFImporter(async () => {
          factoryCalls += 1;
          return { parse: () => new THREE.Group() };
        });
        const archive = createThreeMFPackageFromModel(
          modelWithObjects(objects, buildObjectId, buildTransform),
        );
        const primary = new File([archive], `unsafe-${target}-transform.3mf`);

        await assert.rejects(
          importer.import(primary, [primary], importOptions()),
          /transform (?:exceeds|must contain exactly 12 finite decimal numbers)/u,
        );
        assert.equal(factoryCalls, 0);
      }
    }
  });

  it("rejects prototype-chain names as unsupported model units", async () => {
    const archive = createThreeMFFixture({ unit: "constructor" });
    const primary = new File([archive], "bad-unit.3mf");
    await assert.rejects(
      new ThreeMFImporter().import(
        primary,
        [primary],
        importOptions(),
      ),
      /Unsupported 3MF model unit: constructor/u,
    );
  });

  it("rejects wide and deeply nested model XML before DOM construction or loader creation", async () => {
    const parser = globalThis.DOMParser;
    let domParseCalls = 0;
    globalThis.DOMParser = class CountingDOMParser {
      parseFromString(source, type) {
        domParseCalls += 1;
        return new parser().parseFromString(source, type);
      }
    };

    const modelPrefix = [
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
      "<model unit=\"millimeter\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">",
      "<resources>",
    ].join("");
    const modelSuffix = "</resources><build/></model>";
    const sources = [
      [
        `${modelPrefix}${"<metadata/>".repeat(100_001)}${modelSuffix}`,
        /100000-element XML safety limit/u,
      ],
      [
        [
          modelPrefix,
          "<extension>".repeat(257),
          "</extension>".repeat(257),
          modelSuffix,
        ].join(""),
        /XML nesting safety limit of 256/u,
      ],
    ];

    try {
      for (const [source, expected] of sources) {
        let factoryCalls = 0;
        const importer = new ThreeMFImporter(async () => {
          factoryCalls += 1;
          return { parse: () => new THREE.Group() };
        });
        const archive = createThreeMFPackageFromModel(source);
        const primary = new File([archive], "unsafe-xml.3mf");
        const callsBeforeImport = domParseCalls;

        await assert.rejects(
          importer.import(primary, [primary], importOptions()),
          expected,
        );
        assert.equal(
          domParseCalls - callsBeforeImport,
          1,
          "only package relationships should reach DOMParser",
        );
        assert.equal(factoryCalls, 0);
      }
    } finally {
      globalThis.DOMParser = parser;
    }
  });

  it("rejects unsafe relationships, IDs, cycles, and exponential component expansion before loading", async () => {
    const meshObject = [
      "<object id=\"1\" type=\"model\"><mesh>",
      "<vertices><vertex x=\"0\" y=\"0\" z=\"0\"/><vertex x=\"1\" y=\"0\" z=\"0\"/><vertex x=\"0\" y=\"1\" z=\"0\"/></vertices>",
      "<triangles><triangle v1=\"0\" v2=\"1\" v3=\"2\"/></triangles>",
      "</mesh></object>",
    ].join("");
    const exponentialObjects = [meshObject];
    for (let id = 2; id <= 17; id += 1) {
      exponentialObjects.push(
        `<object id="${id}" type="model"><components>` +
          `<component objectid="${id - 1}"/>` +
          `<component objectid="${id - 1}"/>` +
          "</components></object>",
      );
    }

    for (const [archive, expected] of [
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            "<object id=\"1\"><components><component objectid=\"1\"/></components></object>",
            "1",
          ),
        ),
        /component graph contains a cycle/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            "<object id=\"1\"><components><wrapper><component objectid=\"1\"/></wrapper></components></object>",
            "1",
          ),
        ),
        /Nested 3MF component in object 1 elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(exponentialObjects.join(""), "17"),
        ),
        /component expansion safety budget/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            "<object id=\"constructor\"><mesh><vertices/><triangles/></mesh></object>",
            "1",
          ),
        ),
        /object resource id must be a positive integer/u,
      ],
      [
        createThreeMFPackageFromModel(
          [
            '<model unit="millimeter">',
            '<metadata><resources><object id="constructor"/></resources></metadata>',
            `<resources>${meshObject}</resources>`,
            '<build><item objectid="1"/></build>',
            "</model>",
          ].join(""),
        ),
        /Nested 3MF resources elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          [
            '<model unit="millimeter">',
            '<metadata><build><item objectid="constructor"/></build></metadata>',
            `<resources>${meshObject}</resources>`,
            '<build><item objectid="1"/></build>',
            "</model>",
          ].join(""),
        ),
        /Nested 3MF build elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            `<extension><basematerials id="constructor"/></extension>${meshObject}`,
            "1",
          ),
        ),
        /Nested 3MF basematerials resource elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            `<extension><metadata name="shadow">shadow</metadata></extension>${meshObject}`,
            "1",
          ),
        ),
        /Nested 3MF model metadata elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            '<basematerials id="2"><wrapper><base name="shadow" displaycolor="#FFFFFFFF"/></wrapper></basematerials>' +
              meshObject,
            "1",
          ),
        ),
        /Nested 3MF base in basematerials elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            '<texture2dgroup id="2"><wrapper><tex2coord u="0" v="0"/></wrapper></texture2dgroup>' +
              meshObject,
            "1",
          ),
        ),
        /Nested 3MF tex2coord in texture2dgroup elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            '<colorgroup id="2"><wrapper><color color="#FFFFFFFF"/></wrapper></colorgroup>' +
              meshObject,
            "1",
          ),
        ),
        /Nested 3MF color in colorgroup elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            '<pbmetallicdisplayproperties id="2"><wrapper><pbmetallic name="shadow"/></wrapper></pbmetallicdisplayproperties>' +
              meshObject,
            "1",
          ),
        ),
        /Nested 3MF pbmetallic in pbmetallicdisplayproperties elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            [
              '<object id="1"><mesh>',
              '<extension><vertices><vertex x="0" y="0" z="0"/></vertices></extension>',
              '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>',
              '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
              "</mesh></object>",
            ].join(""),
            "1",
          ),
        ),
        /Nested 3MF vertices elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(
            [
              '<object id="1"><mesh>',
              '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices>',
              '<extension><triangles><triangle v1="0" v2="1" v3="2"/></triangles></extension>',
              '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
              "</mesh></object>",
            ].join(""),
            "1",
          ),
        ),
        /Nested 3MF triangles elements are not supported/u,
      ],
      [
        createThreeMFPackageFromModel(
          `<!DOCTYPE model [<!ENTITY x "x">]>${modelWithObjects(meshObject, "1")}`,
        ),
        /DOCTYPE or ENTITY declaration/u,
      ],
      [
        createThreeMFPackageFromModel(
          modelWithObjects(meshObject, "1"),
          { targetMode: "External" },
        ),
        /External 3MF package relationship targets are not supported/u,
      ],
    ]) {
      let factoryCalls = 0;
      const importer = new ThreeMFImporter(async () => {
        factoryCalls += 1;
        return { parse: () => new THREE.Group() };
      });
      const primary = new File([archive], "unsafe-graph.3mf");
      await assert.rejects(
        importer.import(primary, [primary], importOptions()),
        expected,
      );
      assert.equal(factoryCalls, 0);
    }
  });

  it("keeps wide resource selector validation linear", async () => {
    const siblings = Array.from(
      { length: 4_000 },
      (_, index) => `<basematerials id="${index + 2}"/>`,
    ).join("");
    const model = modelWithObjects(
      [
        siblings,
        '<extension><basematerials id="constructor"/></extension>',
        '<object id="1"><mesh><vertices/><triangles/></mesh></object>',
      ].join(""),
      "1",
    );
    let factoryCalls = 0;
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      return { parse: () => new THREE.Group() };
    });
    const archive = createThreeMFPackageFromModel(model);
    const primary = new File([archive], "wide-resources.3mf");

    await assert.rejects(
      importer.import(primary, [primary], importOptions()),
      /Nested 3MF basematerials resource elements are not supported/u,
    );
    assert.equal(factoryCalls, 0);
  });
});

function importOptions(overrides = {}) {
  return {
    ...DEFAULT_IMPORT_OPTIONS,
    centerModel: false,
    placeOnGround: false,
    ...overrides,
  };
}

function findMesh(root) {
  let mesh;
  root.traverse((object) => {
    if (!mesh && object.isMesh) mesh = object;
  });
  assert.ok(mesh, "Expected the 3MF fixture to contain a mesh");
  return mesh;
}

function createThreeMFFixture({
  unit = "millimeter",
  extent = 1_000,
} = {}) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="2">
      <base name="Fixture Blue" displaycolor="#336699FF"/>
    </basematerials>
    <object id="1" type="model" pid="2" pindex="0">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="${extent}" y="0" z="0"/>
          <vertex x="0" y="${extent}" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" pid="2" p1="0"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(relationships),
      "3D/3dmodel.model": strToU8(model),
    },
    { level: 0 },
  );
}

function modelWithObjects(objects, buildObjectId, buildTransform) {
  const transform = buildTransform === undefined
    ? ""
    : ` transform="${buildTransform}"`;
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<model unit=\"millimeter\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">",
    `<resources>${objects}</resources>`,
    `<build><item objectid="${buildObjectId}"${transform}/></build>`,
    "</model>",
  ].join("");
}

function createThreeMFPackageFromModel(
  model,
  { targetMode } = {},
) {
  const contentTypes = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
    "<Default Extension=\"model\" ContentType=\"application/vnd.ms-package.3dmanufacturing-3dmodel+xml\"/>",
    "</Types>",
  ].join("");
  const mode = targetMode ? ` TargetMode="${targetMode}"` : "";
  const relationships = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
    `<Relationship Target="/3D/3dmodel.model"${mode} Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
    "</Relationships>",
  ].join("");
  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(relationships),
      "3D/3dmodel.model": strToU8(model),
    },
    { level: 0 },
  );
}
