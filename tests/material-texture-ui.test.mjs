import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { createServer } from "vite";

let MATERIAL_TEXTURE_FILE_ACCEPT;
let appShellSource;
let basicEditorSource;
let libraryCssSource;
let libraryViewSource;
let materialTextureErrorDetail;
let materialTextureErrorMessageKey;
let sceneEditorSource;
let server;
let syncMaterialTextureStatus;

before(async () => {
  server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ syncMaterialTextureStatus } = await server.ssrLoadModule(
    "/src/ui/material-basic-editor.ts",
  ));
  ({ materialTextureErrorDetail, materialTextureErrorMessageKey } =
    await server.ssrLoadModule("/src/ui/app-shell.ts"));
  ({ MATERIAL_TEXTURE_FILE_ACCEPT } = await server.ssrLoadModule(
    "/src/model/material/material-color-map.ts",
  ));
  [
    appShellSource,
    basicEditorSource,
    libraryCssSource,
    libraryViewSource,
    sceneEditorSource,
  ] = await Promise.all(
    [
      "../src/ui/app-shell.ts",
      "../src/ui/material-basic-editor.ts",
      "../src/ui/material-library.css",
      "../src/ui/material-library-view-base.ts",
      "../src/ui/scene-editor-view.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  libraryViewSource += await readFile(new URL("../src/ui/material-detail-view.ts", import.meta.url), "utf8");
  sceneEditorSource += await readFile(new URL("../src/ui/imported-inspector.ts", import.meta.url), "utf8");
});

after(async () => {
  await server?.close();
});

describe("material texture picker UI", () => {
  it("wires the supported accept contract to choose and replace", () => {
    assert.equal(
      MATERIAL_TEXTURE_FILE_ACCEPT,
      ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp",
    );
    assert.match(basicEditorSource, /input\.type = "file";/u);
    assert.match(
      basicEditorSource,
      /input\.accept = MATERIAL_TEXTURE_FILE_ACCEPT;/u,
    );
    assert.match(
      basicEditorSource,
      /input\.dataset\.materialTextureInput = material\.id;/u,
    );
    assert.match(
      compact(basicEditorSource),
      /colorMap \? "material\.textureReplace" : "material\.textureChoose"/u,
    );
    assert.match(
      basicEditorSource,
      /input\.setAttribute\(\s*"aria-label",/u,
    );
  });

  it("dispatches selection and replacement through the file change path", () => {
    const source = compact(appShellSource);
    assert.match(
      source,
      /this\.#root\.addEventListener\( "change", \(event\) => this\.#handleEditorChange\(event, actions\), options, \);/u,
    );
    assert.match(source, /const materialId = input\.dataset\.materialTextureInput;/u);
    assert.match(source, /const file = input\.files\?\.\[0\]; input\.value = "";/u);
    assert.match(
      source,
      /this\.#materialLibrary\.setTextureStatus\(materialId, \{ kind: "busy" \}\);/u,
    );
    assert.match(source, /await actions\.attachMaterialColorMap\(materialId, file\);/u);
    assert.match(
      source,
      /this\.#materialLibrary\.setTextureStatus\(materialId, \{ kind: "success" \}\);/u,
    );
    assert.match(
      source,
      /kind: "error", detail: materialTextureErrorMessageKey\(error\),/u,
    );
  });

  it("restores focus to the texture picker after a detail rebuild", () => {
    const source = compact(libraryViewSource);
    assert.match(
      source,
      /\| \{ readonly kind: "texture"; readonly materialId: string \}/u,
    );
    assert.match(
      source,
      /const textureMaterialId = active\.dataset\.materialTextureInput; if \(textureMaterialId\) \{ return \{ kind: "texture", materialId: textureMaterialId \}; \}/u,
    );
    assert.match(source, /if \(focus\.kind === "texture"\)/u);
    assert.match(
      source,
      /candidate\.dataset\.materialTextureInput === focus\.materialId/u,
    );
    assert.match(source, /input\?\.focus\(\); return;/u);
  });

  it("exposes a disabled-until-mapped remove action and clears its status", () => {
    assert.match(
      basicEditorSource,
      /remove\.dataset\.removeMaterialColorMap = material\.id;/u,
    );
    assert.match(basicEditorSource, /remove\.disabled = !colorMap;/u);

    const source = compact(appShellSource);
    assert.match(
      source,
      /"\[data-remove-material-color-map\]"/u,
    );
    assert.match(source, /actions\.removeMaterialColorMap\(removeColorMapId\);/u);
    assert.match(
      source,
      /this\.#materialLibrary\.setTextureStatus\(removeColorMapId, \{ kind: "idle" \}\);/u,
    );
    assert.match(
      source,
      /querySelector<HTMLInputElement>\("\[data-material-texture-input\]"\) \?\.focus\(\)/u,
    );
  });
});

describe("material texture mapping controls", () => {
  it("publishes every mapping field and supported wrap option", () => {
    const mapping = sliceBetween(
      basicEditorSource,
      "const mapping = element",
      "const help = textElement",
    );
    for (const field of [
      "repeatX",
      "repeatY",
      "offsetX",
      "offsetY",
      "rotationDegrees",
    ]) {
      assert.match(mapping, new RegExp(`"${field}"`, "u"), field);
    }
    assert.match(
      basicEditorSource,
      /input\.dataset\.materialColorMapId = materialId;/u,
    );
    assert.match(
      basicEditorSource,
      /input\.dataset\.materialColorMapField = field;/u,
    );
    assert.match(
      basicEditorSource,
      /select\.dataset\.materialColorMapField = "wrapMode";/u,
    );
    for (const mode of ["repeat", "clamp-to-edge", "mirrored-repeat"]) {
      assert.match(basicEditorSource, new RegExp(`"${mode}"`, "u"), mode);
    }
  });

  it("hides and disables mapping controls until an image exists", () => {
    assert.match(basicEditorSource, /mapping\.disabled = !colorMap;/u);
    assert.match(basicEditorSource, /mapping\.hidden = !colorMap;/u);
    assert.match(
      compact(appShellSource),
      /MATERIAL_COLOR_MAP_FIELDS\.has\(colorMapField\).*actions\.updateMaterialColorMap\(colorMapId, colorMapField, value\);/u,
    );
  });
});

describe("material texture status accessibility", () => {
  it("synchronizes busy, success, error, and idle semantics", () => {
    const { root, section, message } = createTextureStatusRoot("material-1");

    syncMaterialTextureStatus(root, "material-1", "en", { kind: "busy" });
    assert.equal(section.getAttribute("aria-busy"), "true");
    assert.equal(message.hidden, false);
    assert.equal(message.dataset.kind, "busy");
    assert.equal(message.getAttribute("role"), "status");
    assert.equal(message.textContent, "Processing image…");

    syncMaterialTextureStatus(root, "material-1", "ja", { kind: "success" });
    assert.equal(section.getAttribute("aria-busy"), "false");
    assert.equal(message.hidden, false);
    assert.equal(message.dataset.kind, "success");
    assert.equal(message.getAttribute("role"), "status");
    assert.equal(message.textContent, "画像を適用しました。");

    syncMaterialTextureStatus(root, "material-1", "en", {
      kind: "error",
      detail: "material.textureErrorUnsupported",
    });
    assert.equal(message.hidden, false);
    assert.equal(message.dataset.kind, "error");
    assert.equal(message.getAttribute("role"), "alert");
    assert.equal(
      message.textContent,
      "The image could not be applied. Choose a static PNG, JPEG, or WebP image.",
    );

    syncMaterialTextureStatus(root, "material-1", "en", { kind: "idle" });
    assert.equal(section.getAttribute("aria-busy"), "false");
    assert.equal(message.hidden, true);
    assert.equal(message.dataset.kind, "idle");
    assert.equal(message.getAttribute("role"), "status");
    assert.equal(message.textContent, "");
  });

  it("uses a polite live region and restores status after detail rebuilds", () => {
    assert.match(
      basicEditorSource,
      /message\.setAttribute\("aria-live", "polite"\);/u,
    );
    const source = compact(libraryViewSource);
    assert.match(
      source,
      /readonly #textureStatuses = new Map<string, MaterialTextureUiStatus>\(\);/u,
    );
    assert.match(
      source,
      /this\.#textureStatuses\.set\(materialId, status\); syncMaterialTextureStatus\( this\.#detail, materialId, this\.#locale, status, \);/u,
    );
    assert.match(
      source,
      /syncMaterialTextureStatus\( this\.#detail, material\.id, this\.#locale, this\.#textureStatuses\.get\(material\.id\) \?\? \{ kind: "idle" \}, \);/u,
    );
  });

  it("retranslates both error parts after English-Japanese locale changes", () => {
    const { root, message } = createTextureStatusRoot("material-1");
    const status = {
      kind: "error",
      detail: materialTextureErrorMessageKey({ code: "unsupported-format" }),
    };

    syncMaterialTextureStatus(root, "material-1", "en", status);
    assert.equal(
      message.textContent,
      "The image could not be applied. Choose a static PNG, JPEG, or WebP image.",
    );

    syncMaterialTextureStatus(root, "material-1", "ja", status);
    assert.equal(
      message.textContent,
      "画像を適用できませんでした。 PNG / JPEG / WebP の静止画像を選択してください。",
    );

    syncMaterialTextureStatus(root, "material-1", "en", status);
    assert.equal(
      message.textContent,
      "The image could not be applied. Choose a static PNG, JPEG, or WebP image.",
    );
  });
});

describe("imported custom material library route", () => {
  it("opens the selected custom material through the shared library action", () => {
    const importedSection = sliceBetween(
      sceneEditorSource,
      "\n  createImportedMaterialSection(\n",
      "\n  createImportedActionSection(\n",
    );
    const source = compact(importedSection);
    assert.match(
      source,
      /\(\{ id \}\) => id === imported\.customMaterialId/u,
    );
    assert.match(source, /if \(selectedMaterialId\) \{/u);
    assert.match(source, /open\.className = "import-material-open";/u);
    assert.match(
      source,
      /open\.dataset\.openMaterialLibrary = selectedMaterialId;/u,
    );
    assert.match(
      source,
      /open\.textContent = translate\(locale, "inspector\.materialOpen"\);/u,
    );

    const shell = compact(appShellSource);
    assert.match(shell, /"\[data-open-material-library\]"/u);
    assert.match(
      shell,
      /this\.#materialLibrary\.open\(openMaterial\.dataset\.openMaterialLibrary\);/u,
    );
  });

  it("keeps the open button dataset synchronized with the custom material", () => {
    const syncInspector = compact(
      sliceBetween(
        sceneEditorSource,
        "\n  #syncImportedInspector(\n",
        "\n  #syncInspector(\n",
      ),
    );
    assert.match(
      syncInspector,
      /select\.value !== imported\.customMaterialId.*select\.value = imported\.customMaterialId;/u,
    );
    assert.match(
      syncInspector,
      /const open = this\.#inspectorBody\.querySelector<HTMLButtonElement>\( "\[data-open-material-library\]", \);/u,
    );
    assert.match(
      syncInspector,
      /if \(open && imported\.customMaterialId\) \{ open\.dataset\.openMaterialLibrary = imported\.customMaterialId; \}/u,
    );
  });
});

describe("material texture CSS regressions", () => {
  it("keeps hidden texture metadata and mapping out of layout", () => {
    assert.match(
      compact(libraryCssSource),
      /\.material-texture-metadata\[hidden\], \.material-texture-mapping\[hidden\] \{ display: none; \}/u,
    );
  });

  it("keeps the imported-material library button touch sized", () => {
    const coarseStart = libraryCssSource.lastIndexOf("@media (pointer: coarse)");
    assert.notEqual(coarseStart, -1);
    assert.match(
      compact(libraryCssSource.slice(coarseStart)),
      /\.import-material-open \{ min-height: 44px; \}/u,
    );
  });
});

describe("localized material texture errors", () => {
  const knownCodes = [
    "empty-file",
    "file-too-large",
    "unsupported-format",
    "mime-mismatch",
    "invalid-header",
    "animated-image",
    "dimensions-too-large",
    "decode-failed",
    "decoded-dimensions-invalid",
    "resident-limit",
    "decoder-unavailable",
    "material-missing",
    "disposed",
  ];

  it("maps every load and controller code without exposing raw messages", () => {
    const genericJa = materialTextureErrorDetail(new Error("RAW ENGLISH"), "ja");
    const genericEn = materialTextureErrorDetail(new Error("RAW ENGLISH"), "en");

    for (const code of knownCodes) {
      const error = { code, message: "RAW ENGLISH" };
      const ja = materialTextureErrorDetail(error, "ja");
      const en = materialTextureErrorDetail(error, "en");
      assert.notEqual(ja, genericJa, code);
      assert.notEqual(en, genericEn, code);
      assert.doesNotMatch(ja, /RAW ENGLISH/u, code);
      assert.doesNotMatch(en, /RAW ENGLISH/u, code);
    }

    assert.equal(
      materialTextureErrorDetail({ code: "unsupported-format" }, "ja"),
      "PNG / JPEG / WebP の静止画像を選択してください。",
    );
    assert.equal(
      materialTextureErrorDetail({ code: "material-missing" }, "en"),
      "The target material could not be found.",
    );
  });

  it("uses a localized generic message for unknown and hostile errors", () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error("RAW ENGLISH");
        },
      },
    );
    assert.equal(
      materialTextureErrorDetail(
        { code: "future-code", message: "RAW ENGLISH" },
        "ja",
      ),
      "予期しないエラーが発生しました。",
    );
    assert.equal(
      materialTextureErrorDetail(throwing, "en"),
      "An unexpected error occurred.",
    );
  });
});

function compact(source) {
  return source.replace(/\s+/gu, " ");
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function createTextureStatusRoot(materialId) {
  const section = new FakeElement({ materialTextureSection: materialId });
  const message = new FakeElement({ materialTextureStatus: materialId });
  return {
    section,
    message,
    root: {
      querySelectorAll(selector) {
        if (selector === "[data-material-texture-section]") return [section];
        if (selector === "[data-material-texture-status]") return [message];
        return [];
      },
    },
  };
}

class FakeElement {
  constructor(dataset) {
    this.dataset = { ...dataset };
    this.hidden = false;
    this.textContent = "";
    this.attributes = new Map();
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}
