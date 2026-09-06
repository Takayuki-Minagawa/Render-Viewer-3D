import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import { parseHTML } from 'linkedom';
import { createServer } from 'vite';
let server, MaterialListView, bindEditTransactions, ImportedNodeTools, cameraDisplay, SceneTreeView;
const previousGlobals = new Map();
before(async () => {
  const dom = parseHTML('<html><body></body></html>');
  for (const name of ['document', 'Element', 'HTMLInputElement', 'HTMLSelectElement']) {
    previousGlobals.set(name, globalThis[name]);
    globalThis[name] = dom.window[name];
  }
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ MaterialListView } = await server.ssrLoadModule('/src/ui/material-list-view.ts'));
  ({ cameraDisplay } = await server.ssrLoadModule('/src/ui/camera-display.ts'));
  ({ SceneTreeView } = await server.ssrLoadModule('/src/ui/scene-tree-view.ts'));
  ({ ImportedNodeTools } = await server.ssrLoadModule('/src/ui/imported-node-tools.ts'));
  ({ bindEditTransactions } = await server.ssrLoadModule('/src/ui/edit-transaction-controller.ts'));
});
after(async () => {
  await server?.close();
  for (const [key, value] of previousGlobals) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
const item = (id, name) => ({ id, name, category: 'general', tags: [], keywords: [], support: 'direct', usageCount: 1, material: { preview: { baseColor: '#ffffff' } } });
it('preserves rows and their children on unchanged material/selection renders, and updates only changed rows', () => {
  const list = document.createElement('div');
  const view = new MaterialListView(list, document.createElement('span'));
  const items = [item('a', 'A'), item('b', 'B')];
  view.render(items, 2, 'a', 'ja');
  const rowA = list.children[0], rowB = list.children[1], childA = rowA.firstChild;
  view.render(structuredClone(items), 2, 'b', 'ja');
  assert.equal(list.children[0], rowA);
  assert.equal(rowA.firstChild, childA);
  assert.equal(rowA.getAttribute('aria-current'), 'false');
  view.render([{ ...items[0], name: 'Renamed' }, items[1]], 2, 'a', 'en');
  assert.equal(list.children[1], rowB);
  assert.equal(rowA.querySelector('strong').textContent, 'Renamed');
  view.render([items[1]], 1, 'b', 'en');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0], rowB);
  view.render([], 0, null, 'en');
  assert.match(list.textContent, /No materials/);
});
it('groups continuous field inputs and starts a fresh transaction after range commit', () => {
  const root = document.createElement('div');
  root.innerHTML = '<input data-transform-group="position" type="range"><input type="search">';
  const [range, search] = root.children;
  const calls = [];
  bindEditTransactions(root, { beginEdit: () => calls.push('begin'), endEdit: () => calls.push('end'), cancelEdit: () => calls.push('cancel') }, new AbortController().signal);
  const fire = (target, type, key) => {
    const event = new document.defaultView.Event(type, { bubbles: true, cancelable: true });
    if (key) Object.defineProperty(event, 'key', { value: key });
    target.dispatchEvent(event);
  };
  fire(range, 'focusin'); fire(range, 'input'); fire(range, 'input');
  assert.deepEqual(calls, ['begin']);
  fire(range, 'change'); fire(range, 'input');
  assert.deepEqual(calls, ['begin', 'end', 'begin']);
  fire(range, 'keydown', 'Escape');
  assert.deepEqual(calls, ['begin', 'end', 'begin', 'cancel']);
  fire(search, 'input');
  assert.deepEqual(calls, ['begin', 'end', 'begin', 'cancel']);
});

it('part tools route tree selection and material changes with stable root/node identity', () => {
  // Linkedom omits the browser select.value setter.
  Object.defineProperty(HTMLSelectElement.prototype, 'value', { configurable: true,
    get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) { for (const option of this.querySelectorAll('option')) option.selected = option.value === value; },
  });
  const root = document.createElement('div'); root.className = 'app-shell';
  root.innerHTML = '<div class="tree-import-node"><button data-object-select="i" data-imported-node-select="node-1"></button></div>';
  const calls = [];
  const tools = new ImportedNodeTools(root, { selectObject: id => calls.push(['select', id]), visibility: (...args) => calls.push(['visibility', ...args]), material: (...args) => calls.push(['material', ...args]), isolate: (...args) => calls.push(['isolate', ...args]), reset: (...args) => calls.push(['reset', ...args]) });
  const scene = { imports: [{id:'i', hierarchy:[{id:'node-0',name:'A',children:[]},{id:'node-1',name:'B',children:[]}]}], materials:[{id:'m',name:'Metal'}] };
  tools.update(scene, 'i', 'en');
  tools.selectNode('i', 'node-1');
  assert.equal(tools.selectedNodeId, 'node-1');
  assert.equal(root.querySelector('[data-imported-node-select]').getAttribute('aria-current'), 'true');
  const material = root.querySelector('[data-node-tool="material"]'); material.value = 'm';
  material.dispatchEvent(new document.defaultView.Event('change', { bubbles:true }));
  assert.deepEqual(calls, [['material','i','node-1','m']]);
  tools.update(scene, null, 'en');
  assert.equal(tools.element.hidden, true);
  assert.equal(root.querySelector('[data-imported-node-select]').hasAttribute('aria-current'), false);
  tools.dispose();
});

it('camera projection labels and tree metadata update in both languages', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div data-object-list></div><div data-light-list></div><div data-camera-item><strong></strong><small></small></div><b data-object-count></b><b data-light-count></b>';
  const tree = new SceneTreeView(root);
  const camera = {projection:'orthographic',orthographicHeight:3.25,fov:45,position:{x:1,y:2,z:3}};
  const model = {objects:[],imports:[],lights:[],camera};
  tree.render(model, {selectedObjectId:null}, 'ja');
  assert.equal(root.querySelector('[data-camera-item] strong').textContent, '正投影');
  assert.match(root.querySelector('[data-camera-item] small').textContent, /^3.25 m/);
  assert.doesNotMatch(root.querySelector('[data-camera-item] small').textContent, /FOV/);
  tree.render(model, {selectedObjectId:null}, 'en');
  assert.equal(root.querySelector('[data-camera-item] strong').textContent, 'Orthographic');
  assert.deepEqual(cameraDisplay(camera, 'en'), {label:'Orthographic',scale:'3.25 m'});
  assert.match(cameraDisplay({...camera,projection:'perspective'}, 'ja').scale, /45° FOV/);
});
