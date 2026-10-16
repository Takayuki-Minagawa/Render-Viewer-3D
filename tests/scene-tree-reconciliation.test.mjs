import assert from "node:assert/strict";
import { after, afterEach, before, it } from "node:test";
import { parseHTML } from "linkedom";
import { createServer } from "vite";

let server, SceneTreeView, focused;
const previousGlobals = new Map();
before(async () => {
  const { window } = parseHTML("<html><body></body></html>");
  for (const key of ["document", "Element", "HTMLElement"]) {
    previousGlobals.set(key, globalThis[key]);
    globalThis[key] = window[key];
  }
  // Linkedom has no native focus. These tests cover focus-target decisions;
  // audit-tree.spec.ts exercises actual browser focus and keyboard activation.
  Object.defineProperty(document, "activeElement", { get: () => focused });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  server = await createServer({ appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  ({ SceneTreeView } = await server.ssrLoadModule("/src/ui/scene-tree-view.ts"));
});
afterEach(() => { document.body.replaceChildren(); focused = document.body; });
after(async () => {
  await server?.close();
  for (const [key, value] of previousGlobals) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});

const object = (id) => ({ id, name: `Object ${id}`, visible: true, geometry: { type: "box" } });
const node = (id, children = []) => ({ id, name: `Part ${id}`, objectType: "Mesh", mesh: true, triangleCount: 12, children });
const imported = (id) => ({
  id, assetId: `asset-${id}`, name: `Assembly ${id}`, visible: true, format: "OBJ",
  metadata: { objectCount: 2, triangleCount: 24 }, hierarchy: [node("parent", [node("child")])],
});
function fixture(objects = [object("a"), object("b"), object("c")], imports = []) {
  const root = document.createElement("div");
  root.innerHTML = '<div data-object-list></div><div data-light-list></div><div data-camera-item><strong></strong><small></small></div><b data-object-count></b><b data-light-count></b><button data-outside>Outside</button>';
  document.body.append(root);
  const view = new SceneTreeView(root);
  const scene = { objects, imports, lights: [], camera: { projection: "perspective", fov: 45, position: { x: 1, y: 2, z: 3 } } };
  const render = (selectedObjectId = "a", locale = "en") => view.render(scene, { selectedObjectId }, locale);
  render();
  return { root, scene, render, list: root.querySelector("[data-object-list]") };
}

it("keeps rows, buttons and focus through visibility, naming, locale and selection updates", () => {
  const { root, list, scene, render } = fixture();
  const rows = Array.from(list.children);
  const toggle = root.querySelector('[data-object-visibility="a"]');
  const select = root.querySelector('[data-object-select="a"]');
  const name = select.querySelector("strong");
  toggle.focus();
  let moves = 0;
  const insertBefore = list.insertBefore;
  list.insertBefore = function (...args) { moves += 1; return insertBefore.apply(this, args); };
  scene.objects[0].visible = false;
  render("b");
  assert.equal(document.activeElement, toggle);
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.match(toggle.getAttribute("aria-label"), /Show.*Object a/);
  assert.equal(select.getAttribute("aria-pressed"), "false");
  assert.equal(root.querySelector('[data-object-select="b"]').getAttribute("aria-pressed"), "true");
  assert.equal(rows[0].classList.contains("is-muted"), true);
  scene.objects[0].visible = true;
  scene.objects[0].name = "Renamed first";
  scene.objects[1].name = "Renamed neighbor";
  render("a", "ja");
  assert.equal(document.activeElement, toggle);
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.match(toggle.getAttribute("aria-label"), /Renamed first/);
  assert.equal(select.querySelector("strong"), name);
  assert.equal(name.textContent, "Renamed first");
  assert.deepEqual(Array.from(list.children), rows);
  assert.equal(moves, 0, "value changes must not detach connected rows");
});

it("keeps imported node identity scoped to its root and preserves part selection", () => {
  const { root, scene, render } = fixture([], [imported("one"), imported("two")]);
  const first = root.querySelector('[data-object-select="one"][data-imported-node-select="child"]');
  const second = root.querySelector('[data-object-select="two"][data-imported-node-select="child"]');
  first.setAttribute("aria-current", "true");
  first.parentElement.classList.add("is-node-selected");
  first.focus();
  scene.imports[0].visible = false;
  scene.imports[0].name = "Renamed assembly";
  render("one", "ja");
  assert.equal(root.querySelector('[data-object-select="one"][data-imported-node-select="child"]'), first);
  assert.equal(root.querySelector('[data-object-select="two"][data-imported-node-select="child"]'), second);
  assert.notEqual(first, second);
  assert.equal(document.activeElement, first);
  assert.equal(first.getAttribute("aria-current"), "true");
  assert.equal(first.parentElement.classList.contains("is-node-selected"), true);
  assert.equal(first.parentElement.classList.contains("is-muted"), true);
  assert.match(first.getAttribute("aria-label"), /Renamed assembly \/ Part child/);
  assert.equal(first.hasAttribute("aria-pressed"), false);
  assert.equal(first.parentElement.style.getPropertyValue("--tree-depth"), "2");
});

it("reconciles inserted, reordered and deleted rows without replacing surviving controls", () => {
  const { root, scene, render, list } = fixture();
  const [a, b, c] = Array.from(list.children);
  const focusedButton = b.querySelector("button");
  focusedButton.focus();
  scene.objects = [scene.objects[2], object("d"), scene.objects[1], scene.objects[0]];
  render();
  assert.equal(list.children[0], c);
  assert.equal(list.children[2], b);
  assert.equal(list.children[3], a);
  assert.equal(document.activeElement, focusedButton);
  scene.objects = scene.objects.filter(({ id }) => id !== "a");
  render();
  assert.equal(a.isConnected, false);
  scene.objects.push(object("a"));
  render();
  assert.notEqual(root.querySelector('[data-object-select="a"]').parentElement, a);
  assert.equal(list.children[2], b);
});

it("moves deleted-row focus to the next then previous surviving control and finally the empty state", () => {
  const { root, scene, render } = fixture();
  const a = root.querySelector('[data-object-visibility="a"]');
  const b = root.querySelector('[data-object-visibility="b"]');
  const c = root.querySelector('[data-object-visibility="c"]');
  b.focus();
  scene.objects.splice(1, 1);
  render();
  assert.equal(document.activeElement, c);
  scene.objects.pop();
  render();
  assert.equal(document.activeElement, a);
  scene.objects = [];
  render(null);
  assert.equal(document.activeElement, root.querySelector(".tree-empty"));
  assert.match(document.activeElement.textContent, /No objects/);
});

it("finds a surviving neighbor when an entire imported subtree is deleted", () => {
  const { root, scene, render } = fixture([object("a")], [imported("one"), imported("two")]);
  root.querySelector('[data-object-select="one"][data-imported-node-select="child"]').focus();
  scene.imports.shift();
  render();
  assert.equal(document.activeElement, root.querySelector('.tree-import-root [data-object-select="two"]'));
  root.querySelector("[data-outside]").focus();
  scene.objects = [];
  scene.imports = [];
  render(null);
  assert.equal(document.activeElement, root.querySelector("[data-outside]"));
});
