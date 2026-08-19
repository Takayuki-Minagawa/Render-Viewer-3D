import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let server;
let MaterialImageAssetStore;
let inspectMaterialImageFile;
let inspectMaterialImageHeader;
let MATERIAL_TEXTURE_MAX_FILE_BYTES;
let MATERIAL_TEXTURE_MAX_DIMENSION;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    MaterialImageAssetStore,
    inspectMaterialImageFile,
    inspectMaterialImageHeader,
  } = await server.ssrLoadModule(
    "/src/three/material/image-asset-store.ts",
  ));
  ({ MATERIAL_TEXTURE_MAX_FILE_BYTES, MATERIAL_TEXTURE_MAX_DIMENSION } =
    await server.ssrLoadModule("/src/model/material/material-color-map.ts"));
});

after(async () => {
  await server?.close();
});

describe("material image header validation", () => {
  for (const fixture of [
    {
      label: "PNG",
      bytes: () => pngBytes(321, 123),
      mimeType: "image/png",
    },
    {
      label: "JPEG",
      bytes: () => jpegBytes(640, 480),
      mimeType: "image/jpeg",
    },
    {
      label: "WebP",
      bytes: () => webpExtendedBytes(777, 333),
      mimeType: "image/webp",
    },
  ]) {
    it(`reads finite dimensions from a static ${fixture.label} header`, () => {
      const header = inspectMaterialImageHeader(fixture.bytes());
      const expected = fixture.label === "PNG"
        ? [321, 123]
        : fixture.label === "JPEG"
          ? [640, 480]
          : [777, 333];
      assert.equal(header.mimeType, fixture.mimeType);
      assert.deepEqual([header.width, header.height], expected);
      assert.equal(header.animated, false);
    });
  }

  it("accepts an empty declared MIME but rejects a signature mismatch", async () => {
    const noMime = imageFile(pngBytes(8, 4), "plain.png", "");
    assert.equal((await inspectMaterialImageFile(noMime)).mimeType, "image/png");

    await rejectsWithCode(
      inspectMaterialImageFile(
        imageFile(pngBytes(8, 4), "spoofed.jpg", "image/jpeg"),
      ),
      "mime-mismatch",
    );
  });

  it("rejects SVG and unknown signatures instead of trusting image MIME", async () => {
    const svg = imageFile(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      "vector.svg",
      "image/svg+xml",
    );
    await rejectsWithCode(inspectMaterialImageFile(svg), "unsupported-format");
    assertThrowsCode(
      () => inspectMaterialImageHeader(Uint8Array.of(1, 2, 3, 4)),
      "unsupported-format",
    );
  });

  it("rejects animated APNG and WebP before decoding", async () => {
    await rejectsWithCode(
      inspectMaterialImageFile(
        imageFile(pngBytes(16, 16, { animated: true }), "animated.png", "image/png"),
      ),
      "animated-image",
    );
    await rejectsWithCode(
      inspectMaterialImageFile(
        imageFile(
          webpExtendedBytes(16, 16, { animated: true }),
          "animated.webp",
          "image/webp",
        ),
      ),
      "animated-image",
    );
  });

  it("rejects incomplete or structurally invalid headers", () => {
    const truncatedPng = pngBytes(32, 16).slice(0, 24);
    assertThrowsCode(
      () => inspectMaterialImageHeader(truncatedPng),
      "invalid-header",
    );
    assertThrowsCode(
      () => inspectMaterialImageHeader(Uint8Array.of(0xff, 0xd8, 0xff, 0xc0)),
      "invalid-header",
    );
    const invalidWebp = webpExtendedBytes(8, 8).slice(0, 20);
    assertThrowsCode(
      () => inspectMaterialImageHeader(invalidWebp),
      "invalid-header",
    );
  });

  it("enforces file, application-dimension, and device-dimension limits", async () => {
    const oversized = imageFile(
      new Uint8Array(MATERIAL_TEXTURE_MAX_FILE_BYTES + 1),
      "oversized.png",
      "image/png",
    );
    await rejectsWithCode(inspectMaterialImageFile(oversized), "file-too-large");

    const tooWide = imageFile(
      pngBytes(MATERIAL_TEXTURE_MAX_DIMENSION + 1, 1),
      "too-wide.png",
      "image/png",
    );
    await rejectsWithCode(
      inspectMaterialImageFile(tooWide),
      "dimensions-too-large",
    );

    const deviceLimited = imageFile(
      pngBytes(1025, 16),
      "device-limited.png",
      "image/png",
    );
    await rejectsWithCode(
      inspectMaterialImageFile(deviceLimited, 1024),
      "dimensions-too-large",
    );
  });
});

describe("MaterialImageAssetStore validation and budgets", () => {
  it("rejects invalid input and insufficient reservations before decode", async () => {
    let decodeCount = 0;
    const decoder = async () => {
      decodeCount += 1;
      return trackedImage(4, 4).image;
    };
    const store = new MaterialImageAssetStore(decoder, residentEstimate(4, 4) - 1);

    await rejectsWithCode(
      store.importFile(imageFile(new Uint8Array(), "empty.png", "image/png")),
      "empty-file",
    );
    await rejectsWithCode(
      store.importFile(
        imageFile(
          new TextEncoder().encode("<svg/>"),
          "vector.svg",
          "image/svg+xml",
        ),
      ),
      "unsupported-format",
    );
    await rejectsWithCode(
      store.importFile(imageFile(pngBytes(4, 4), "valid.png", "image/png")),
      "resident-limit",
    );
    assert.equal(decodeCount, 0);
    assert.equal(store.residentBytes, 0);
    store.dispose();
  });

  it("closes decoded images and releases reservations on post-decode rejection", async () => {
    const invalid = trackedImage(0, 4);
    const store = new MaterialImageAssetStore(async () => invalid.image, 1024);
    await rejectsWithCode(
      store.importFile(imageFile(pngBytes(1, 1), "invalid.png", "image/png")),
      "decoded-dimensions-invalid",
    );
    assert.equal(invalid.closeCount, 1);
    assert.equal(store.residentBytes, 0);

    const larger = trackedImage(4, 4);
    const tightStore = new MaterialImageAssetStore(async () => larger.image, 100);
    await rejectsWithCode(
      tightStore.importFile(imageFile(pngBytes(1, 1), "larger.png", "image/png")),
      "resident-limit",
    );
    assert.equal(larger.closeCount, 1);
    assert.equal(tightStore.residentBytes, 0);
    store.dispose();
    tightStore.dispose();
  });

  it("accounts for reservations, resident source data, and each GPU lease", async () => {
    const decoded = trackedImage(4, 4);
    const estimate = residentBreakdown(4, 4);
    const store = new MaterialImageAssetStore(async () => decoded.image, 1024);
    const descriptor = await store.importFile(
      imageFile(pngBytes(4, 4), "resident.png", "image/png"),
    );
    assert.equal(store.residentBytes, estimate.total);

    const first = store.acquire(descriptor.assetId);
    assert.ok(first);
    assert.equal(store.residentBytes, estimate.total);
    const second = store.acquire(descriptor.assetId);
    assert.ok(second);
    assert.equal(second.source, first.source);
    assert.equal(store.residentBytes, estimate.total + estimate.gpu);

    store.release(descriptor.assetId);
    assert.equal(store.residentBytes, estimate.total);
    store.release(descriptor.assetId);
    assert.equal(store.residentBytes, estimate.total);
    assert.equal(decoded.closeCount, 0);

    assert.equal(store.delete(descriptor.assetId), true);
    assert.equal(store.residentBytes, 0);
    assert.equal(decoded.closeCount, 1);
    store.dispose();
    assert.equal(decoded.closeCount, 1);
  });

  it("defers deletion until every lease is released and closes exactly once", async () => {
    const decoded = trackedImage(2, 2);
    const store = new MaterialImageAssetStore(async () => decoded.image, 1024);
    const descriptor = await store.importFile(
      imageFile(pngBytes(2, 2), "shared.png", "image/png"),
    );
    assert.ok(store.acquire(descriptor.assetId));
    assert.ok(store.acquire(descriptor.assetId));

    assert.equal(store.delete(descriptor.assetId), true);
    assert.equal(store.has(descriptor.assetId), true);
    assert.equal(store.acquire(descriptor.assetId), undefined);
    store.release(descriptor.assetId);
    assert.equal(decoded.closeCount, 0);
    store.release(descriptor.assetId);
    assert.equal(store.has(descriptor.assetId), false);
    assert.equal(decoded.closeCount, 1);

    store.release(descriptor.assetId);
    assert.equal(store.delete(descriptor.assetId), false);
    store.dispose();
    store.dispose();
    assert.equal(decoded.closeCount, 1);
    assert.equal(store.residentBytes, 0);
  });

  it("recovers a failed concurrent decode reservation without disturbing success", async () => {
    const width = 4;
    const height = 4;
    const estimate = residentEstimate(width, height);
    const firstGate = deferred();
    const secondGate = deferred();
    const gates = [firstGate, secondGate];
    let decodeCount = 0;
    const store = new MaterialImageAssetStore(
      () => gates[decodeCount++].promise,
      estimate * 2,
    );
    const firstImage = trackedImage(width, height);
    const firstPromise = store.importFile(
      imageFile(pngBytes(width, height), "first.png", "image/png"),
    );
    const secondPromise = store.importFile(
      imageFile(pngBytes(width, height), "second.png", "image/png"),
    );
    const secondFailure = rejectsWithCode(secondPromise, "decode-failed");

    await waitFor(() => decodeCount === 2);
    assert.equal(store.residentBytes, estimate * 2);
    firstGate.resolve(firstImage.image);
    const firstDescriptor = await firstPromise;
    assert.equal(store.residentBytes, estimate * 2);
    secondGate.reject(new Error("synthetic decode failure"));
    await secondFailure;

    assert.equal(store.residentBytes, estimate);
    assert.equal(firstImage.closeCount, 0);
    assert.equal(store.delete(firstDescriptor.assetId), true);
    assert.equal(store.residentBytes, 0);
    assert.equal(firstImage.closeCount, 1);
    store.dispose();
  });

  it("uses explicit ImageBitmap orientation, alpha, and color conversion options", async () => {
    const original = globalThis.createImageBitmap;
    const hadOwn = Object.hasOwn(globalThis, "createImageBitmap");
    const decoded = trackedImage(3, 2);
    let capturedBlob;
    let capturedOptions;
    globalThis.createImageBitmap = async (blob, options) => {
      capturedBlob = blob;
      capturedOptions = options;
      return decoded.image;
    };

    try {
      const store = new MaterialImageAssetStore();
      const file = imageFile(pngBytes(3, 2), "bitmap.png", "image/png");
      await store.importFile(file);
      assert.equal(capturedBlob, file);
      assert.deepEqual(capturedOptions, {
        imageOrientation: "flipY",
        premultiplyAlpha: "none",
        colorSpaceConversion: "default",
      });
      store.dispose();
      assert.equal(decoded.closeCount, 1);
    } finally {
      if (hadOwn) globalThis.createImageBitmap = original;
      else delete globalThis.createImageBitmap;
    }
  });
});

function imageFile(bytes, name, type) {
  return new File([bytes], name, { type });
}

function pngBytes(width, height, { animated = false } = {}) {
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const ihdr = new Uint8Array(13);
  writeUint32BigEndian(ihdr, 0, width);
  writeUint32BigEndian(ihdr, 4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const chunks = [pngChunk("IHDR", ihdr)];
  if (animated) chunks.push(pngChunk("acTL", new Uint8Array(8)));
  chunks.push(pngChunk("IDAT", new Uint8Array()), pngChunk("IEND", new Uint8Array()));
  return concatenate(signature, ...chunks);
}

function pngChunk(type, data) {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BigEndian(chunk, 0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  return chunk;
}

function jpegBytes(width, height) {
  const bytes = new Uint8Array(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  bytes[7] = (height >>> 8) & 0xff;
  bytes[8] = height & 0xff;
  bytes[9] = (width >>> 8) & 0xff;
  bytes[10] = width & 0xff;
  bytes.set([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9], 11);
  return bytes;
}

function webpExtendedBytes(width, height, { animated = false } = {}) {
  const bytes = new Uint8Array(30);
  writeAscii(bytes, 0, "RIFF");
  writeUint32LittleEndian(bytes, 4, bytes.length - 8);
  writeAscii(bytes, 8, "WEBP");
  writeAscii(bytes, 12, "VP8X");
  writeUint32LittleEndian(bytes, 16, 10);
  bytes[20] = animated ? 0x02 : 0;
  writeUint24LittleEndian(bytes, 24, width - 1);
  writeUint24LittleEndian(bytes, 27, height - 1);
  return bytes;
}

function concatenate(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function writeAscii(target, offset, value) {
  target.set(new TextEncoder().encode(value), offset);
}

function writeUint32BigEndian(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function writeUint32LittleEndian(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function writeUint24LittleEndian(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function trackedImage(width, height) {
  const tracker = {
    closeCount: 0,
    image: {
      width,
      height,
      close() {
        tracker.closeCount += 1;
      },
    },
  };
  return tracker;
}

function residentBreakdown(width, height) {
  const cpu = width * height * 4;
  const gpu = Math.ceil(cpu * (4 / 3));
  return { cpu, gpu, total: cpu + gpu };
}

function residentEstimate(width, height) {
  return residentBreakdown(width, height).total;
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for asynchronous test state.");
}

async function rejectsWithCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function assertThrowsCode(action, code) {
  assert.throws(action, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}
