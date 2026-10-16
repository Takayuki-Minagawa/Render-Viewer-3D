import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { parseHTML } from 'linkedom';
import { createServer } from 'vite';

let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore;
let AppearanceTools, MaterialMapTools, MaterialPbrMapController, createDefaultSceneModel, createMaterialColorMap, encodeProject, decodeProject;
let activeElement = null;
const globals = new Map();
before(async () => {
  const dom = parseHTML('<html><body></body></html>');
  for (const name of ['document', 'Element', 'HTMLInputElement', 'HTMLSelectElement']) {
    globals.set(name, globalThis[name]); globalThis[name] = dom.window[name];
  }
  // Linkedom has no native focus tracking, select setter, or valueAsNumber.
  Object.defineProperty(document, 'activeElement', { get: () => activeElement });
  Object.defineProperty(HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) {
      const options = [...this.querySelectorAll('option')];
      for (const option of options) option.removeAttribute('selected');
      options.find(option => option.value === value)?.setAttribute('selected', '');
    },
  });
  Object.defineProperty(HTMLInputElement.prototype, 'valueAsNumber', {
    configurable: true, get() { return this.value.trim() === '' ? NaN : Number(this.value); },
  });
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ SceneStore } = await server.ssrLoadModule('/src/app/scene-store.ts'));
  ({ SceneHistory } = await server.ssrLoadModule('/src/app/scene-history.ts'));
  ({ ProjectAssets } = await server.ssrLoadModule('/src/app/project-assets.ts'));
  ({ ImportedAssetStore } = await server.ssrLoadModule('/src/three/imported-asset-store.ts'));
  ({ MaterialImageAssetStore } = await server.ssrLoadModule('/src/three/material/image-asset-store.ts'));
  ({ MaterialPbrMapController } = await server.ssrLoadModule('/src/app/material-pbr-map-controller.ts'));
  ({ createDefaultSceneModel } = await server.ssrLoadModule('/src/model/default-scene.ts'));
  ({ createMaterialColorMap } = await server.ssrLoadModule('/src/model/material/material-color-map.ts'));
  ({ AppearanceTools } = await server.ssrLoadModule('/src/ui/appearance-tools.ts'));
  ({ MaterialMapTools } = await server.ssrLoadModule('/src/ui/material-map-tools.ts'));
  ({ encodeProject, decodeProject } = await server.ssrLoadModule('/src/app/project-format.ts'));
});
after(async () => {
  await server?.close();
  for (const [name, value] of globals) {
    if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
  }
});

const fire = (input, type) => input.dispatchEvent(new document.defaultView.Event(type, { bubbles: true }));
const edit = (input, value) => { activeElement = input; input.value = value; fire(input, 'input'); };
const blur = (input) => { activeElement = null; fire(input, 'blur'); };
function fixture(t, withMaps = false) {
  activeElement = null;
  const model = createDefaultSceneModel();
  if (withMaps) model.materials[0].maps = Object.fromEntries(['normal', 'roughness', 'metalness', 'ao'].map(channel => [channel, createMaterialColorMap({
    assetId: `${channel}-image`, sourceName: `${channel}.png`, mimeType: 'image/png', byteSize: 10, width: 2, height: 2,
  })]));
  const store = new SceneStore(model), root = document.createElement('div'); document.body.append(root);
  const assets = new ImportedAssetStore(), images = new MaterialImageAssetStore(), sources = new ProjectAssets();
  const history = new SceneHistory(store, assets, images, sources);
  const controller = new MaterialPbrMapController(store, images);
  const tools = withMaps ? new MaterialMapTools(root, store, controller) : new AppearanceTools(root, store, { onEnvironmentFile: async () => {} });
  t.after(() => { tools.dispose(); controller.dispose(); history.dispose(); assets.dispose(); images.dispose(); root.remove(); activeElement = null; });
  const input = name => root.querySelector(`[data-${withMaps ? 'pbr' : 'at'}="${name}"]`);
  return { store, tools, history, images, sources, input };
}

it('light commit corrects a focused value, including a clamped no-op, and Undo updates the focused field', t => {
  const { store, history, input } = fixture(t);
  const intensity = input('intensity');
  edit(intensity, '1000'); fire(intensity, 'change');
  assert.equal(intensity.value, '100');
  assert.equal(document.activeElement, intensity);
  assert.equal(store.getSnapshot().lights[0].intensity, 100);
  assert.match(input('status').textContent, /100 に補正/);
  const snapshot = store.getSnapshot();
  edit(intensity, '1000'); fire(intensity, 'change');
  assert.equal(store.getSnapshot(), snapshot);
  assert.equal(intensity.value, '100');
  blur(intensity);
  assert.match(input('status').textContent, /100 に補正/);
  activeElement = intensity;
  history.undo();
  assert.equal(intensity.value, '0.65');
  history.redo();
  assert.equal(intensity.value, '100');
});

it('empty and invalid appearance input reverts without a model update or Undo entry', t => {
  const { store, history, input, tools } = fixture(t);
  for (const name of ['intensity', 'exposure']) {
    const field = input(name), original = field.value, snapshot = store.getSnapshot();
    for (const value of ['', 'NaN', 'Infinity', '-']) {
      edit(field, value); fire(field, 'change');
      assert.equal(store.getSnapshot(), snapshot);
      assert.equal(field.value, original);
      assert.match(input('status').textContent, /有効な数値/);
    }
  }
  assert.equal(history.canUndo, false);
  tools.setLocale('en');
  assert.match(input('status').textContent, /Enter a valid number\. Restored 1.05/);
  edit(input('exposure'), '2.25'); blur(input('exposure'));
  assert.equal(store.getSnapshot().exposure, 2.25);
  assert.equal(input('status').textContent, '');
});

it('exposure and directional position/target use their existing boundaries on change and blur', t => {
  const { store, input, tools } = fixture(t);
  tools.setLocale('en');
  edit(input('exposure'), '99'); fire(input('exposure'), 'change');
  assert.equal(input('exposure').value, '10');
  assert.equal(store.getSnapshot().exposure, 10);
  assert.equal(input('status').textContent, 'Value adjusted to 10.');
  input('light').value = 'directional-01'; activeElement = input('light'); fire(input('light'), 'change');
  for (const kind of ['position', 'target']) for (const axis of ['x', 'y', 'z']) {
    const field = input(`${kind}-${axis}`), value = axis === 'y' ? '-2000000' : '2000000';
    edit(field, value); blur(field);
    const expected = axis === 'y' ? -1e6 : 1e6;
    assert.equal(field.value, String(expected));
    assert.equal(store.getSnapshot().lights[1][kind][axis], expected);
    edit(field, ''); blur(field);
    assert.equal(field.value, String(expected));
  }
});

it('unrelated updates and composition preserve editing text until commit', t => {
  const { store, input } = fixture(t);
  const exposure = input('exposure');
  edit(exposure, '99');
  store.update(draft => { draft.name = 'Unrelated change'; });
  assert.equal(exposure.value, '99');
  assert.equal(store.getSnapshot().exposure, undefined);
  fire(exposure, 'compositionstart'); fire(exposure, 'change');
  assert.equal(exposure.value, '99');
  assert.equal(store.getSnapshot().exposure, undefined);
  fire(exposure, 'compositionend');
  assert.equal(exposure.value, '10');
  assert.equal(store.getSnapshot().exposure, 10);
  edit(exposure, '3'); blur(exposure);
  assert.equal(store.getSnapshot().exposure, 3);
});

it('normalized light and exposure values survive the project format round trip', async t => {
  const { store, input, images, sources } = fixture(t);
  edit(input('intensity'), '1000'); fire(input('intensity'), 'change');
  edit(input('exposure'), '99'); blur(input('exposure'));
  const decoded = await decodeProject(await encodeProject(store.getSnapshot(), sources, images));
  assert.equal(decoded.model.lights[0].intensity, 100);
  assert.equal(decoded.model.exposure, 10);
  store.replace(decoded.model);
  assert.equal(input('intensity').value, '100');
  assert.equal(input('exposure').value, '10');
});

for (const channel of ['normal', 'roughness', 'metalness', 'ao']) {
  it(`${channel} mapping resyncs every numeric field after normalization and rejects empty input`, t => {
    const { store, tools, input, history } = fixture(t, true);
    input('channel').value = channel; fire(input('channel'), 'change');
    const cases = [['repeatX', '0', 0.01], ['repeatY', '1001', 1000], ['offsetX', '-1001', -1000], ['offsetY', '1001', 1000], ['rotationDegrees', '360001', 360000]];
    for (const [name, value, expected] of cases) {
      const field = input(name);
      edit(field, value); fire(field, 'change');
      assert.equal(field.value, String(expected));
      assert.equal(store.getSnapshot().materials[0].maps[channel][name], expected);
      assert.match(input('status').textContent, /補正/);
      const snapshot = store.getSnapshot();
      edit(field, ''); blur(field);
      assert.equal(store.getSnapshot(), snapshot);
      assert.equal(field.value, String(expected));
      assert.match(input('status').textContent, /有効な数値/);
    }
    tools.setLocale('en');
    assert.equal(input('status').textContent, 'Enter a valid number. Restored 360000.');
    const repeat = input('repeatX'); edit(repeat, '2.5'); fire(repeat, 'change');
    assert.equal(input('status').textContent, '');
    history.undo(); assert.equal(repeat.value, '0.01');
    history.redo(); assert.equal(repeat.value, '2.5');
    edit(repeat, '5'); store.update(draft => { draft.name = 'Still editing'; });
    assert.equal(repeat.value, '5');
    blur(repeat); assert.equal(store.getSnapshot().materials[0].maps[channel].repeatX, 5);
  });
}
