import assert from "node:assert/strict";
import { File } from "node:buffer";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { DOMParser } from "linkedom";
import {
  strToU8,
  zipSync,
} from "three/addons/libs/fflate.module.js";
import { createServer } from "vite";

let DEFAULT_IMPORT_OPTIONS;
let MAX_3MF_ARCHIVE_BYTES;
let ThreeMFImporter;
let inspectZipCentralDirectory;
let validateZipExpandedSizes;
let previousDOMParserDescriptor;
let server;

before(async () => {
  previousDOMParserDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "DOMParser",
  );
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
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
    inspectZipCentralDirectory,
    validateZipExpandedSizes,
  } = await server.ssrLoadModule(
    "/src/importers/zip-preflight.ts",
  ));
  ({ MAX_3MF_ARCHIVE_BYTES, ThreeMFImporter } = await server.ssrLoadModule(
    "/src/importers/ThreeMFImporter.ts",
  ));
});

after(async () => {
  await server?.close();
  if (previousDOMParserDescriptor) {
    Object.defineProperty(globalThis, "DOMParser", previousDOMParserDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "DOMParser");
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

const safeLimits = Object.freeze({
  maxEntries: 8,
  maxEntryUncompressedBytes: 2_000,
  maxTotalUncompressedBytes: 4_000,
  maxCompressionRatio: 20,
});

describe("3MF ZIP preflight", () => {
  it("reports bounded central-directory sizes and names", () => {
    const archive = createCentralDirectoryArchive([
      { name: "[Content_Types].xml", compressed: 100, uncompressed: 200 },
      { name: "_rels/.rels", compressed: 80, uncompressed: 120 },
      { name: "3D/3dmodel.model", compressed: 200, uncompressed: 800 },
    ]);

    assert.deepEqual(inspectZipCentralDirectory(archive, safeLimits), {
      entryCount: 3,
      totalCompressedBytes: 380,
      totalUncompressedBytes: 1_120,
      fileNames: [
        "[Content_Types].xml",
        "_rels/.rels",
        "3D/3dmodel.model",
      ],
      entries: [
        {
          fileName: "[Content_Types].xml",
          compressionMethod: 8,
          payloadOffset: 49,
          compressedBytes: 100,
          uncompressedBytes: 200,
        },
        {
          fileName: "_rels/.rels",
          compressionMethod: 8,
          payloadOffset: 190,
          compressedBytes: 80,
          uncompressedBytes: 120,
        },
        {
          fileName: "3D/3dmodel.model",
          compressionMethod: 8,
          payloadOffset: 316,
          compressedBytes: 200,
          uncompressedBytes: 800,
        },
      ],
    });
  });

  it("rejects declared per-entry expansion abuse", () => {
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "3D/huge.model",
              compressed: 500,
              uncompressed: 2_001,
            },
          ]),
          safeLimits,
        ),
      /per-entry safety limit/u,
    );
  });

  it("measures actual DEFLATE output and enforces actual limits", async () => {
    const payload = strToU8("a".repeat(1_024));
    const archiveBytes = zipSync({ payload }, { level: 6 });
    const archive = archiveBytes.buffer;
    const generousLimits = {
      maxEntries: 8,
      maxEntryUncompressedBytes: 10_000,
      maxTotalUncompressedBytes: 10_000,
      maxCompressionRatio: 10_000,
    };
    const inspected = inspectZipCentralDirectory(archive, generousLimits);

    assert.deepEqual(
      await validateZipExpandedSizes(archive, inspected, generousLimits),
      {
        totalCompressedBytes: inspected.totalCompressedBytes,
        totalUncompressedBytes: 1_024,
      },
    );
    await assert.rejects(
      validateZipExpandedSizes(archive, inspected, {
        ...generousLimits,
        maxEntryUncompressedBytes: 100,
      }),
      /actual per-entry expansion safety limit/u,
    );
    await assert.rejects(
      validateZipExpandedSizes(archive, inspected, {
        ...generousLimits,
        maxTotalUncompressedBytes: 100,
      }),
      /actual expanded size exceeds.*total safety limit/u,
    );
    await assert.rejects(
      validateZipExpandedSizes(archive, inspected, {
        ...generousLimits,
        maxCompressionRatio: 1,
      }),
      /actual 1:1 compression-ratio safety limit/u,
    );
  });

  it("rejects DEFLATE output that differs from the declared size", async () => {
    const limits = {
      maxEntries: 8,
      maxEntryUncompressedBytes: 10_000,
      maxTotalUncompressedBytes: 10_000,
      maxCompressionRatio: 10_000,
    };
    const compressed = zipSync(
      { payload: strToU8("b".repeat(1_024)) },
      { level: 6 },
    );
    const underdeclared = mutateDeclaredUncompressedSize(
      compressed,
      "payload",
      1,
    );
    const underdeclaredArchive = underdeclared.buffer;
    await assert.rejects(
      validateZipExpandedSizes(
        underdeclaredArchive,
        inspectZipCentralDirectory(underdeclaredArchive, limits),
        limits,
      ),
      /expands beyond its declared uncompressed size/u,
    );

    const overdeclared = mutateDeclaredUncompressedSize(
      compressed,
      "payload",
      2_048,
    );
    const overdeclaredArchive = overdeclared.buffer;
    await assert.rejects(
      validateZipExpandedSizes(
        overdeclaredArchive,
        inspectZipCentralDirectory(overdeclaredArchive, limits),
        limits,
      ),
      /actual expanded size does not match its declaration/u,
    );
  });

  it("rejects trailing bytes after the final DEFLATE block", async () => {
    const limits = {
      maxEntries: 8,
      maxEntryUncompressedBytes: 10_000,
      maxTotalUncompressedBytes: 10_000,
      maxCompressionRatio: 10_000,
    };
    const archiveBytes = appendCompressedTrailingBytes(
      zipSync(
        { payload: strToU8("c".repeat(1_024)) },
        { level: 6 },
      ),
      "payload",
      256 * 1_024,
    );
    const archive = archiveBytes.buffer;
    const inspected = inspectZipCentralDirectory(archive, limits);

    await assert.rejects(
      validateZipExpandedSizes(archive, inspected, limits),
      /DEFLATE payload contains trailing compressed data/u,
    );
  });
  it("rejects compression-ratio, encryption, and duplicate-name abuse", () => {
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            { name: "3D/ratio.model", compressed: 10, uncompressed: 201 },
          ]),
          safeLimits,
        ),
      /compression-ratio safety limit/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            { name: "3D/encrypted.model", compressed: 20, uncompressed: 20, flags: 1 },
          ]),
          safeLimits,
        ),
      /Encrypted 3MF ZIP entries/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            { name: "3D/model.model", compressed: 20, uncompressed: 20 },
            { name: "3D/model.model", compressed: 20, uncompressed: 20 },
          ]),
          safeLimits,
        ),
      /duplicate entry/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            { name: "3D/Model.model", compressed: 20, uncompressed: 20 },
            { name: "3d/model.model", compressed: 20, uncompressed: 20 },
          ]),
          safeLimits,
        ),
      /duplicate entry/u,
    );
  });

  it("rejects malformed, multi-disk, and ZIP64 archives", () => {
    assert.throws(
      () => inspectZipCentralDirectory(new ArrayBuffer(16), safeLimits),
      /no valid ZIP central directory/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([], { diskNumber: 1 }),
          safeLimits,
        ),
      /Multi-disk/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([], {
            entriesOnDisk: 0xffff,
            entryCount: 0xffff,
          }),
          safeLimits,
        ),
      /ZIP64/u,
    );
  });

  it("rejects traversal, absolute, and prototype-polluting entry names", () => {
    for (const name of [
      "../escape.model",
      "3D/../../escape.model",
      "/absolute.model",
      "C:/absolute.model",
      "3D\\..\\escape.model",
      "3D//empty.model",
      "__proto__",
      "3D/constructor/model.model",
      "prototype",
    ]) {
      assert.throws(
        () =>
          inspectZipCentralDirectory(
            createCentralDirectoryArchive([
              { name, compressed: 1, uncompressed: 1 },
            ]),
            safeLimits,
          ),
        /unsafe (?:absolute|relative) entry path|dangerous entry key/u,
        name,
      );
    }
  });

  it("validates local headers, stored sizes, and UTF-8 entry names", () => {
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "3D/model.model",
              compressed: 1,
              uncompressed: 1,
              centralLocalOffset: 0xffffffff,
            },
          ]),
          safeLimits,
        ),
      /ZIP64 3MF entries/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "3D/model.model",
              compressed: 1,
              uncompressed: 1,
              localMethod: 0,
            },
          ]),
          safeLimits,
        ),
      /local file header is inconsistent/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "3D/model.model",
              localName: "3D/other.model",
              compressed: 1,
              uncompressed: 1,
            },
          ]),
          safeLimits,
        ),
      /local file name does not match/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "stored.model",
              method: 0,
              compressed: 1,
              uncompressed: 2,
            },
          ]),
          safeLimits,
        ),
      /stored 3MF ZIP entry has inconsistent/u,
    );
    assert.throws(
      () =>
        inspectZipCentralDirectory(
          createCentralDirectoryArchive([
            {
              name: "invalid",
              nameBytes: new Uint8Array([0xff]),
              flags: 0x800,
              compressed: 1,
              uncompressed: 1,
            },
          ]),
          safeLimits,
        ),
      /not valid UTF-8/u,
    );
    assert.deepEqual(
      inspectZipCentralDirectory(
        createCentralDirectoryArchive([
          {
            name: "latin-1",
            nameBytes: new Uint8Array([0xe9]),
            compressed: 1,
            uncompressed: 1,
          },
        ]),
        safeLimits,
      ).fileNames,
      ["é"],
    );
  });

  it("rejects overlapping local records and a trailing fake EOCD signature", () => {
    const overlapping = createCentralDirectoryArchive([
      { name: "a", compressed: 100, uncompressed: 100 },
      {
        name: "b",
        compressed: 1,
        uncompressed: 1,
        centralLocalOffset: 50,
      },
    ]);
    const overlappingBytes = new Uint8Array(overlapping);
    const overlappingView = new DataView(overlapping);
    overlappingView.setUint32(50, 0x04034b50, true);
    overlappingView.setUint16(56, 0, true);
    overlappingView.setUint16(58, 8, true);
    overlappingView.setUint32(68, 1, true);
    overlappingView.setUint32(72, 1, true);
    overlappingView.setUint16(76, 1, true);
    overlappingBytes[80] = "b".charCodeAt(0);
    assert.throws(
      () => inspectZipCentralDirectory(overlapping, safeLimits),
      /local file records overlap or are duplicated/u,
    );

    const fakeEOCD = new Uint8Array(22);
    const fakeView = new DataView(fakeEOCD.buffer);
    fakeView.setUint32(0, 0x06054b50, true);
    fakeView.setUint16(20, 1, true);
    const spoofed = createCentralDirectoryArchive([], {
      commentBytes: fakeEOCD,
    });
    assert.throws(
      () => inspectZipCentralDirectory(spoofed, safeLimits),
      /no valid ZIP central directory/u,
    );
  });
});

describe("ThreeMFImporter", () => {
  it("loads a preflighted archive, normalizes millimeters and Z-up, and keeps materials", async () => {
    let parseCalls = 0;
    const importer = new ThreeMFImporter(async () => ({
      parse() {
        parseCalls += 1;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [0, 0, 0, 1_000, 0, 0, 0, 1_000, 0],
            3,
          ),
        );
        return new THREE.Group().add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color: 0x336699 }),
          ),
        );
      },
    }));
    const archive = createValidThreeMFArchive();
    const file = new File([archive], "fixture.3mf", {
      type: "model/3mf",
    });

    const imported = await importer.import(file, [file], options());
    const bounds = new THREE.Box3().setFromObject(imported.root);

    assert.equal(parseCalls, 1);
    assert.equal(imported.metadata.format, "3MF");
    assert.equal(imported.metadata.objectCount, 1);
    assert.equal(imported.metadata.triangleCount, 1);
    assert.equal(imported.metadata.materialCount, 1);
    assert.ok(Math.abs(bounds.max.x - 1) < 1e-9);
    assert.ok(Math.abs(bounds.min.z + 1) < 1e-9);
    assert.equal(imported.metadata.sourceUnit, "millimeter");
    assert.deepEqual(imported.warnings, []);
  });

  it("rejects oversized or structurally incomplete archives before loading the addon", async () => {
    let factoryCalls = 0;
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      throw new Error("must not load");
    });
    const oversized = new File([""], "oversized.3mf");
    Object.defineProperty(oversized, "size", {
      value: MAX_3MF_ARCHIVE_BYTES + 1,
    });

    await assert.rejects(
      importer.import(oversized, [oversized], options()),
      /compressed archive safety limit/u,
    );

    const incomplete = createCentralDirectoryArchive([
      { name: "3D/3dmodel.model", compressed: 20, uncompressed: 20 },
    ]);
    const incompleteFile = new File([incomplete], "incomplete.3mf");
    await assert.rejects(
      importer.import(incompleteFile, [incompleteFile], options()),
      /required package entries/u,
    );

    const nestedOnly = createCentralDirectoryArchive([
      { name: "[Content_Types].xml", compressed: 1, uncompressed: 1 },
      { name: "_rels/.rels", compressed: 1, uncompressed: 1 },
      {
        name: "3D/submodels/nested.model",
        compressed: 1,
        uncompressed: 1,
      },
    ]);
    const nestedFile = new File([nestedOnly], "nested-only.3mf");
    await assert.rejects(
      importer.import(nestedFile, [nestedFile], options()),
      /root 3D\/\*\.model part/u,
    );

    const multiPart = createCentralDirectoryArchive([
      { name: "[Content_Types].xml", compressed: 1, uncompressed: 1 },
      { name: "_rels/.rels", compressed: 1, uncompressed: 1 },
      { name: "3D/root.model", compressed: 1, uncompressed: 1 },
      {
        name: "3D/submodels/inch.model",
        compressed: 1,
        uncompressed: 1,
      },
    ]);
    const multiPartFile = new File([multiPart], "multi-part.3mf");
    await assert.rejects(
      importer.import(
        multiPartFile,
        [multiPartFile],
        options(),
      ),
      /Multi-part 3MF model packages are not supported/u,
    );
    assert.equal(factoryCalls, 0);
  });

  it("checks abort before loading the addon", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    let factoryCalls = 0;
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      throw new Error("must not load");
    });
    const archive = createValidThreeMFArchive();
    const file = new File([archive], "cancelled.3mf");

    await assert.rejects(
      importer.import(file, [file], options({ signal: controller.signal })),
      /cancelled/u,
    );
    assert.equal(factoryCalls, 0);
  });


  it("rejects underdeclared DEFLATE output before XML parsing or loader creation", async () => {
    let factoryCalls = 0;
    let xmlParseCalls = 0;
    const originalParse = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (...args) {
      xmlParseCalls += 1;
      return originalParse.apply(this, args);
    };
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      throw new Error("must not load");
    });
    const archive = mutateDeclaredUncompressedSize(
      createValidThreeMFArchive({ includeExpansionProbe: true }),
      "3D/expansion-probe.bin",
      1,
    );
    const file = new File([archive], "underdeclared.3mf");
    try {
      await assert.rejects(
        importer.import(file, [file], options()),
        /expands beyond its declared uncompressed size/u,
      );
    } finally {
      DOMParser.prototype.parseFromString = originalParse;
    }
    assert.equal(xmlParseCalls, 0);
    assert.equal(factoryCalls, 0);
  });

  it("rejects oversized parsed geometry and disposes it", async () => {
    const geometry = new THREE.BufferGeometry();

    geometry.getAttribute = (name) =>
      name === "position" ? { count: 2_000_001 } : undefined;
    let disposeCalls = 0;
    geometry.dispose = () => {
      disposeCalls += 1;
    };
    const content = new THREE.Group().add(
      new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()),
    );
    const importer = new ThreeMFImporter(async () => ({
      parse() {
        return content;
      },
    }));
    const archive = createValidThreeMFArchive();
    const file = new File([archive], "oversized-output.3mf");

    await assert.rejects(
      importer.import(file, [file], options()),
      /3MF output exceeds the main-thread geometry safety budget/,
    );
    assert.equal(disposeCalls, 1);
  });

  it("rejects trailing DEFLATE bytes before loader creation", async () => {
    let factoryCalls = 0;
    const importer = new ThreeMFImporter(async () => {
      factoryCalls += 1;
      throw new Error("must not load");
    });
    const archive = appendCompressedTrailingBytes(
      createValidThreeMFArchive({ includeExpansionProbe: true }),
      "3D/expansion-probe.bin",
      256 * 1_024,
    );
    const file = new File([archive], "trailing-deflate.3mf");

    await assert.rejects(
      importer.import(file, [file], options()),
      /DEFLATE payload contains trailing compressed data/u,
    );
    assert.equal(factoryCalls, 0);
  });
});

function createValidThreeMFArchive({ includeExpansionProbe = false } = {}) {
  const entries = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "_rels/.rels": strToU8(
      '<Relationships><Relationship Target="/3D/3dmodel.model"/></Relationships>',
    ),
    "3D/3dmodel.model": strToU8(
      [
        '<model unit="millimeter">',
        "<resources>",
        '<object id="1"><mesh>',
        "<vertices>",
        '<vertex x="0" y="0" z="0"/>',
        '<vertex x="1" y="0" z="0"/>',
        '<vertex x="0" y="1" z="0"/>',
        "</vertices>",
        '<triangles><triangle v1="0" v2="1" v3="2"/></triangles>',
        "</mesh></object>",
        "</resources>",
        '<build><item objectid="1"/></build>',
        "</model>",
      ].join(""),
    ),
  };
  if (includeExpansionProbe) {
    entries["3D/expansion-probe.bin"] = strToU8("x".repeat(4_096));
  }
  return zipSync(entries, { level: 6 });
}

function mutateDeclaredUncompressedSize(archive, targetName, declaredSize) {
  const bytes = Uint8Array.from(archive);
  const view = new DataView(bytes.buffer);
  let eocdOffset = bytes.byteLength - 22;
  while (
    eocdOffset >= 0 &&
    view.getUint32(eocdOffset, true) !== 0x06054b50
  ) {
    eocdOffset -= 1;
  }
  assert.ok(eocdOffset >= 0, "Expected a ZIP end-of-central-directory record");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    if (name === targetName) {
      const localOffset = view.getUint32(offset + 42, true);
      view.setUint32(offset + 24, declaredSize, true);
      view.setUint32(localOffset + 22, declaredSize, true);
      return bytes;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${targetName}`);
}

function appendCompressedTrailingBytes(
  archive,
  targetName,
  trailingByteLength,
) {
  const source = Uint8Array.from(archive);
  const sourceView = new DataView(source.buffer);
  let eocdOffset = source.byteLength - 22;
  while (
    eocdOffset >= 0 &&
    sourceView.getUint32(eocdOffset, true) !== 0x06054b50
  ) {
    eocdOffset -= 1;
  }
  assert.ok(eocdOffset >= 0, "Expected a ZIP end-of-central-directory record");
  const entryCount = sourceView.getUint16(eocdOffset + 10, true);
  const directoryOffset = sourceView.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  let centralOffset = directoryOffset;
  let targetCentralOffset = -1;

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(sourceView.getUint32(centralOffset, true), 0x02014b50);
    const nameLength = sourceView.getUint16(centralOffset + 28, true);
    const extraLength = sourceView.getUint16(centralOffset + 30, true);
    const commentLength = sourceView.getUint16(centralOffset + 32, true);
    const name = decoder.decode(
      source.subarray(
        centralOffset + 46,
        centralOffset + 46 + nameLength,
      ),
    );
    if (name === targetName) targetCentralOffset = centralOffset;
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  assert.ok(targetCentralOffset >= 0, `ZIP entry not found: ${targetName}`);

  const localOffset = sourceView.getUint32(targetCentralOffset + 42, true);
  const compressedBytes = sourceView.getUint32(targetCentralOffset + 20, true);
  const localNameLength = sourceView.getUint16(localOffset + 26, true);
  const localExtraLength = sourceView.getUint16(localOffset + 28, true);
  const payloadOffset = localOffset + 30 + localNameLength + localExtraLength;
  const insertionOffset = payloadOffset + compressedBytes;
  assert.equal(
    insertionOffset,
    directoryOffset,
    "Trailing-data fixture target must be the final local ZIP entry",
  );

  const result = new Uint8Array(source.byteLength + trailingByteLength);
  result.set(source.subarray(0, insertionOffset));
  result.fill(0xa5, insertionOffset, insertionOffset + trailingByteLength);
  result.set(
    source.subarray(insertionOffset),
    insertionOffset + trailingByteLength,
  );
  const view = new DataView(result.buffer);
  const newDirectoryOffset = directoryOffset + trailingByteLength;
  const newCentralOffset = targetCentralOffset + trailingByteLength;
  const newEocdOffset = eocdOffset + trailingByteLength;
  const expandedCompressedBytes = compressedBytes + trailingByteLength;
  view.setUint32(localOffset + 18, expandedCompressedBytes, true);
  view.setUint32(newCentralOffset + 20, expandedCompressedBytes, true);
  view.setUint32(newEocdOffset + 16, newDirectoryOffset, true);
  return result;
}

function createCentralDirectoryArchive(entries, overrides = {}) {
  const encoder = new TextEncoder();
  const encodedNames = entries.map(({ name, nameBytes }) =>
    nameBytes ?? encoder.encode(name),
  );
  const encodedLocalNames = entries.map((entry, index) =>
    entry.localNameBytes ??
    (entry.localName === undefined
      ? encodedNames[index]
      : encoder.encode(entry.localName)),
  );
  const localRecordSize = entries.reduce(
    (total, { compressed }, index) =>
      total + 30 + encodedLocalNames[index].byteLength + compressed,
    0,
  );
  const directorySize = entries.reduce(
    (total, _entry, index) => total + 46 + encodedNames[index].byteLength,
    0,
  );
  const comment =
    overrides.commentBytes ?? encoder.encode(overrides.comment ?? "");
  const archive = new ArrayBuffer(
    localRecordSize + directorySize + 22 + comment.byteLength,
  );
  const bytes = new Uint8Array(archive);
  const view = new DataView(archive);
  const localOffsets = [];
  let offset = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = encodedLocalNames[index];
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 6, entry.localFlags ?? entry.flags ?? 0, true);
    view.setUint16(offset + 8, entry.localMethod ?? entry.method ?? 8, true);
    view.setUint32(offset + 18, entry.compressed, true);
    view.setUint32(offset + 22, entry.uncompressed, true);
    view.setUint16(offset + 26, name.byteLength, true);
    bytes.set(name, offset + 30);
    offset += 30 + name.byteLength + entry.compressed;
  }

  const directoryOffset = offset;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = encodedNames[index];
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 8, entry.flags ?? 0, true);
    view.setUint16(offset + 10, entry.method ?? 8, true);
    view.setUint32(offset + 20, entry.compressed, true);
    view.setUint32(offset + 24, entry.uncompressed, true);
    view.setUint16(offset + 28, name.byteLength, true);
    view.setUint32(
      offset + 42,
      entry.centralLocalOffset ?? localOffsets[index],
      true,
    );
    bytes.set(name, offset + 46);
    offset += 46 + name.byteLength;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, overrides.diskNumber ?? 0, true);
  view.setUint16(offset + 6, overrides.directoryDisk ?? 0, true);
  view.setUint16(
    offset + 8,
    overrides.entriesOnDisk ?? entries.length,
    true,
  );
  view.setUint16(
    offset + 10,
    overrides.entryCount ?? entries.length,
    true,
  );
  view.setUint32(offset + 12, overrides.directorySize ?? directorySize, true);
  view.setUint32(offset + 16, overrides.directoryOffset ?? directoryOffset, true);
  view.setUint16(offset + 20, comment.byteLength, true);
  bytes.set(comment, offset + 22);
  return archive;
}
