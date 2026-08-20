import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { createServer } from "vite";

let DEFAULT_IMPORT_OPTIONS;
let FBXImporter;
let server;

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
});

after(async () => {
  await server?.close();
});

describe("FBXImporter file-format fixture", () => {
  it("parses a real ASCII FBX triangle with unit metadata", async () => {
    const primary = new File([fbxFixture()], "triangle.fbx", {
      type: "application/octet-stream",
    });
    const imported = await new FBXImporter().import(
      primary,
      [primary],
      {
        ...DEFAULT_IMPORT_OPTIONS,
        centerModel: false,
        placeOnGround: false,
      },
    );
    const mesh = findMesh(imported.root);
    const bounds = new THREE.Box3().setFromObject(imported.root);

    assert.equal(imported.metadata.format, "FBX");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.ok(imported.metadata.materialCount >= 1);
    assert.ok(mesh.geometry.getAttribute("normal"));
    assert.ok(Math.abs(bounds.max.x - 0.01) < 1e-9);
    assert.ok(Math.abs(bounds.max.y - 0.01) < 1e-9);
    assert.ok(Math.abs(imported.root.scale.x - 0.01) < 1e-12);
    assert.equal(imported.metadata.sourceUnit, "1 centimeters per unit");
    assert.deepEqual(imported.warnings, []);
  });
});

function findMesh(root) {
  let mesh;
  root.traverse((object) => {
    if (!mesh && object.isMesh) mesh = object;
  });
  assert.ok(mesh, "Expected the FBX fixture to contain a mesh");
  return mesh;
}

function fbxFixture() {
  return `;;;;;;;;;;;;;;;;;;;;;;;;
; FBX 7.4.0 project file
FBXHeaderExtension: {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
  Creator: "Render Viewer test"
}
GlobalSettings: {
  Version: 1000
  Properties70: {
    P: "UpAxis", "int", "Integer", "",1
    P: "UpAxisSign", "int", "Integer", "",1
    P: "FrontAxis", "int", "Integer", "",2
    P: "FrontAxisSign", "int", "Integer", "",-1
    P: "CoordAxis", "int", "Integer", "",0
    P: "CoordAxisSign", "int", "Integer", "",1
    P: "UnitScaleFactor", "double", "Number", "",1
  }
}
Definitions: {
  Version: 100
  Count: 3
  ObjectType: "Geometry" {
    Count: 1
  }
  ObjectType: "Model" {
    Count: 2
  }
  ObjectType: "Material" {
    Count: 1
  }
}
Objects: {
  Geometry: 1, "Geometry::Triangle", "Mesh" {
    Vertices: *9 {
      a: 0,0,0,1,0,0,0,1,0
    }
    PolygonVertexIndex: *3 {
      a: 0,1,-3
    }
    GeometryVersion: 124
    LayerElementMaterial: 0 {
      Version: 101
      Name: ""
      MappingInformationType: "AllSame"
      ReferenceInformationType: "IndexToDirect"
      Materials: *1 {
        a: 0
      }
    }
    Layer: 0 {
      Version: 100
      LayerElement: {
        Type: "LayerElementMaterial"
        TypedIndex: 0
      }
    }
  }
  Model: 2, "Model::Triangle", "Mesh" {
    Version: 232
    Properties70: {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
      P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
      P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
    }
    Shading: T
    Culling: "CullingOff"
  }
  Material: 3, "Material::Fixture Blue", "" {
    Version: 102
    ShadingModel: "phong"
    MultiLayer: 0
    Properties70: {
      P: "DiffuseColor", "Color", "", "A",0.2,0.4,0.6
    }
  }
}
  Model: 4, "Model::Fixture Root", "Null" {
    Version: 232
    Properties70: {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
      P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
      P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
    }
    Shading: T
    Culling: "CullingOff"
  }
Connections: {
  C: "OO",1,2
  C: "OO",2,4
  C: "OO",4,0
  C: "OO",3,2
}
Takes: {
}
`.replace(/^(?:  )+/gmu, (indentation) =>
    "\t".repeat(indentation.length / 2),
  );
}
