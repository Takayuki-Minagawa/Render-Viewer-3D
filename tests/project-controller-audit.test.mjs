import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { setImmediate as nextTurn, setTimeout as realDelay } from 'node:timers/promises';
import { createServer } from 'vite';
import { parseHTML } from 'linkedom';
import * as THREE from 'three';

let server, SceneStore, SceneHistory, ProjectAssets, ImportedAssetStore, MaterialImageAssetStore;
let ProjectController, EditorStore, createDefaultSceneModel, encodeProject, decodeProject;
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  const load = path => server.ssrLoadModule(`/src/${path}.ts`);
  ({ SceneStore } = await load('app/scene-store'));
  ({ SceneHistory } = await load('app/scene-history'));
  ({ ProjectAssets } = await load('app/project-assets'));
  ({ ImportedAssetStore } = await load('three/imported-asset-store'));
  ({ MaterialImageAssetStore } = await load('three/material/image-asset-store'));
  ({ ProjectController } = await load('app/project-controller'));
  ({ EditorStore } = await load('app/editor-store'));
  ({ createDefaultSceneModel } = await load('model/default-scene'));
  ({ encodeProject, decodeProject } = await load('app/project-format'));
});
after(() => server?.close());

async function settled() { for (let index = 0; index < 4; index++) await nextTurn(); }
// Capture the native delay before per-test fake timers. Blob decoding and crypto
// may need real I/O time when the complete suite competes for CPU; a fixed number
// of setImmediate turns can all finish before that I/O completes.
const waitForRealTime = realDelay;
async function until(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await waitForRealTime(10);
  assert.ok(predicate(), message);
}

function database() {
  const state = { value: undefined, writes: [], autoCommit: true };
  const db = {
    close() {},
    transaction() {
      const tx = { error: null, objectStore: () => ({
        get() {
          const request = { result: undefined, error: null };
          queueMicrotask(() => { request.result = state.value; request.onsuccess?.(); tx.oncomplete?.(); });
          return request;
        },
        put(value, key) {
          const request = { result: undefined, error: null };
          const write = {
            value,
            success() { request.result = key; request.onsuccess?.(); },
            commit() { state.value = value; write.success(); tx.oncomplete?.(); },
            fail(error) { request.error = error; request.onerror?.(); tx.onerror?.(); tx.error = error; tx.onabort?.(); },
          };
          state.writes.push(write);
          if (state.autoCommit) queueMicrotask(() => write.commit());
          return request;
        },
      }) };
      return tx;
    },
  };
  return { state, indexedDB: { open() {
    const request = { result: db, error: null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } } };
}

async function harness(t, run, manager = {}) {
  const dom = parseHTML('<html><body><main id="root"><div class="app-shell"><dialog id="existing-dialog"></dialog></div></main></body></html>');
  const databaseMock = database();
  const keys = ['document', 'window', 'HTMLElement', 'indexedDB'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const downloads = [], urls = new Map();
  const urlDescriptors = new Map(['createObjectURL', 'revokeObjectURL'].map(key => [key, Object.getOwnPropertyDescriptor(URL, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, {
    configurable: true, writable: true,
    value: key === 'indexedDB' ? databaseMock.indexedDB : dom[key] ?? dom.window[key],
  });
  const createElement = document.createElement.bind(document);
  document.createElement = (...args) => {
    const element = createElement(...args);
    if (args[0] === 'dialog') {
      element.showModal = () => { element.open = true; element.setAttribute('open', ''); };
      element.close = () => { element.open = false; element.removeAttribute('open'); };
    }
    if (args[0] === 'a') element.click = () => downloads.push({ blob: urls.get(element.href), filename: element.download });
    return element;
  };
  URL.createObjectURL = blob => { const url = `blob:audit-${urls.size}`; urls.set(url, blob); return url; };
  URL.revokeObjectURL = url => urls.delete(url);
  const store = new SceneStore(createDefaultSceneModel()), sources = new ProjectAssets();
  const assets = new ImportedAssetStore(), images = new MaterialImageAssetStore();
  const history = new SceneHistory(store, assets, images, sources);
  const editor = new EditorStore({ selectedObjectId: store.getSnapshot().objects[0].id, transformMode: 'translate' });
  const root = document.getElementById('root');
  const shell = root.querySelector('.app-shell');
  shell.inert = false;
  const controller = new ProjectController(root, store, editor, manager, assets, images, sources, history);
  try {
    await settled();
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await run({ controller, store, editor, history, sources, assets, images, root, shell,
      db: databaseMock.state, downloads,
      fileStatus: () => root.querySelector('[data-project-file-status]'),
      autosaveStatus: () => root.querySelector('[data-project-autosave-status]'),
      debounce: async () => { t.mock.timers.tick(800); await settled(); },
    });
  } finally {
    controller.dispose(); history.dispose(); assets.dispose(); images.dispose();
    t.mock.timers.reset();
    for (const [key, descriptor] of urlDescriptors) Object.defineProperty(URL, key, descriptor);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

// B-003: the file export used to advance the one shared saved revision and cancel
// the pending IDB save, leaving an older scene in the recovery slot.
test('manual export inside the 800 ms debounce also commits the latest scene to browser storage', async t => {
  await harness(t, async h => {
    h.store.update(draft => { draft.name = 'Scene A'; });
    await h.debounce();
    assert.equal((await decodeProject(h.db.value)).model.name, 'Scene A');
    assert.equal(h.autosaveStatus().dataset.state, 'saved');
    assert.ok(!Number.isNaN(Date.parse(h.autosaveStatus().dataset.savedAt)));
    h.store.update(draft => { draft.name = 'Scene B'; });
    await h.controller.save();
    assert.equal(h.downloads.length, 1);
    assert.equal(h.downloads[0].filename, 'Scene_B.rv3d');
    assert.equal((await decodeProject(h.downloads[0].blob)).model.name, 'Scene B');
    assert.equal(h.fileStatus().dataset.state, 'saved');
    assert.equal(h.fileStatus().dataset.fileName, 'Scene_B.rv3d');
    assert.ok(!Number.isNaN(Date.parse(h.fileStatus().dataset.savedAt)));
    assert.notEqual(h.autosaveStatus().dataset.state, 'saved');
    assert.equal((await decodeProject(h.db.value)).model.name, 'Scene A');
    await h.debounce();
    assert.equal((await decodeProject(h.db.value)).model.name, 'Scene B');
    assert.equal(h.autosaveStatus().dataset.state, 'saved');
    assert.equal(h.fileStatus().dataset.state, 'saved');
  });
});

test('browser saved status waits for transaction commit, independent of an exported file and quota failure', async t => {
  await harness(t, async h => {
    h.db.autoCommit = false;
    h.store.update(draft => { draft.name = 'Export survived'; });
    await h.controller.save();
    await h.debounce();
    assert.equal(h.db.writes.length, 1);
    h.db.writes[0].success();
    await settled();
    assert.equal(h.autosaveStatus().dataset.state, 'saving');
    assert.equal(h.autosaveStatus().dataset.savedAt, undefined);
    assert.equal(h.fileStatus().dataset.state, 'saved');
    const exportedAt = h.fileStatus().dataset.savedAt;
    h.db.writes[0].fail(new DOMException('Storage quota exhausted', 'QuotaExceededError'));
    await until(() => h.autosaveStatus().dataset.state === 'error', 'quota failure must be visible in the browser channel');
    assert.equal(h.fileStatus().dataset.state, 'saved');
    assert.equal(h.fileStatus().dataset.savedAt, exportedAt);
    assert.equal(h.autosaveStatus().dataset.savedAt, undefined);
    h.store.update(draft => { draft.name = 'A later edit retries autosave'; });
    await h.debounce();
    assert.equal(h.db.writes.length, 2);
    h.db.writes[1].success();
    await settled();
    assert.equal(h.autosaveStatus().dataset.state, 'saving');
    h.db.writes[1].commit();
    await until(() => h.autosaveStatus().dataset.state === 'saved', 'only the committed retry is saved');
    assert.equal((await decodeProject(h.db.value)).model.name, 'A later edit retries autosave');
    assert.equal(h.fileStatus().dataset.state, 'changed');
  });
});

for (const outcome of ['commit', 'abort']) test(`an older autosave ${outcome} during manual export cannot suppress or falsely mark the latest browser revision`, async t => {
  await harness(t, async h => {
    h.db.autoCommit = false;
    h.store.update(draft => { draft.name = 'Old in flight'; });
    await h.debounce();
    assert.equal(h.db.writes.length, 1);
    h.store.update(draft => { draft.name = 'Newest export'; });
    await h.controller.save();
    await h.debounce();
    assert.equal(h.db.writes.length, 1, 'IDB writes must remain serialized');
    if (outcome === 'commit') h.db.writes[0].commit();
    else h.db.writes[0].fail(new DOMException('Older transaction failed', 'QuotaExceededError'));
    await until(() => h.db.writes.length === 2, 'newer autosave must run after the old transaction');
    if (outcome === 'commit') assert.equal((await decodeProject(h.db.value)).model.name, 'Old in flight');
    else assert.equal(h.db.value, undefined);
    assert.notEqual(h.autosaveStatus().dataset.state, 'saved');
    assert.equal((await decodeProject(h.db.writes[1].value)).model.name, 'Newest export');
    h.db.writes[1].commit();
    await until(() => h.autosaveStatus().dataset.state === 'saved', 'latest transaction should become saved');
    assert.equal((await decodeProject(h.db.value)).model.name, 'Newest export');
    assert.equal((await decodeProject(h.downloads[0].blob)).model.name, 'Newest export');
  });
});

test('failed and cancelled edits that never change the scene retain saved status without another autosave', async t => {
  await harness(t, async h => {
    h.store.update(draft => { draft.name = 'Already saved scene'; });
    await h.debounce();
    await h.controller.save();
    const before = h.store.getSnapshot();
    const writes = h.db.writes.length;
    const fileSavedAt = h.fileStatus().dataset.savedAt;
    const browserSavedAt = h.autosaveStatus().dataset.savedAt;
    assert.equal(writes, 1);

    const assertStillSaved = async () => {
      assert.equal(h.store.getSnapshot(), before, 'ending an unchanged history group must retain snapshot identity');
      assert.equal(h.fileStatus().dataset.state, 'saved');
      assert.equal(h.autosaveStatus().dataset.state, 'saved');
      const operationStatus = h.root.querySelector('[data-project-status]').textContent;
      await h.debounce();
      assert.equal(h.db.writes.length, writes, 'failed startup must not enqueue an unchanged autosave');
      assert.equal(h.fileStatus().dataset.savedAt, fileSavedAt);
      assert.equal(h.autosaveStatus().dataset.savedAt, browserSavedAt);
      assert.equal(h.root.querySelector('[data-project-status]').textContent, operationStatus,
        'an unnecessary autosave must not replace the operation failure or cancellation notice');
    };

    await assert.rejects(h.controller.editAsync(async () => {
      throw new Error('STEP startup failed before any edits');
    }), /STEP startup failed/);
    await assertStillSaved();

    const running = h.controller.editAsync(signal => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), { cancellable: true, label: 'Unchanged STEP import' });
    const rejected = assert.rejects(running, error => error.name === 'AbortError');
    h.root.querySelector('[data-project-cancel]').click();
    await rejected;
    await assertStillSaved();
    assert.equal(h.controller.busy, false);
    assert.equal(h.history.canUndo, true);
  });
});

test('cancelling an asynchronous edit rolls back partial edits, preserves redo, and permits a new signal and save', async t => {
  await harness(t, async h => {
    h.store.update(draft => { draft.name = 'Keep this edit'; });
    h.store.update(draft => { draft.name = 'Redo target'; });
    h.controller.undo();
    assert.equal(h.history.canRedo, true);
    let cancelledSignal;
    const running = h.controller.editAsync(signal => {
      cancelledSignal = signal;
      h.store.update(draft => { draft.name = 'Unpublished partial edit'; });
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }, { cancellable: true, label: 'Import test STEP' });
    const rejected = assert.rejects(running, error => error.name === 'AbortError');
    assert.equal(h.shell.inert, true);
    assert.equal(h.controller.toolbar.element.inert, true);
    const operation = h.root.querySelector('[data-project-operation]');
    assert.ok(operation);
    assert.equal(operation.closest('.app-shell'), null);
    assert.notEqual(operation.inert, true);
    assert.match(operation.querySelector('[data-project-operation-status]').textContent, /Import test STEP/);
    operation.querySelector('[data-project-cancel]').click();
    await rejected;
    assert.equal(cancelledSignal.aborted, true);
    assert.equal(h.store.getSnapshot().name, 'Keep this edit');
    assert.equal(h.history.canRedo, true);
    assert.equal(h.controller.busy, false);
    assert.equal(h.shell.inert, false);
    h.controller.redo();
    assert.equal(h.store.getSnapshot().name, 'Redo target');
    h.controller.undo();
    const result = await h.controller.editAsync(async signal => {
      assert.notEqual(signal, cancelledSignal);
      assert.equal(signal.aborted, false);
      h.store.update(draft => { draft.name = 'Retry completed'; });
      return 42;
    }, { cancellable: true });
    assert.equal(result, 42);
    h.controller.undo();
    assert.equal(h.store.getSnapshot().name, 'Keep this edit');
    await h.controller.save();
    assert.equal((await decodeProject(h.downloads[0].blob)).model.name, 'Keep this edit');
  });
});

test('cancelling project restore disposes prepared imports and preserves the previous scene and history', async t => {
  let count = 0, disposals = 0, restoreSignal;
  const manager = { async import(_primary, _files, options) {
    count++;
    restoreSignal = options.signal;
    if (count === 2) return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    const geometry = new THREE.BoxGeometry();
    geometry.addEventListener('dispose', () => disposals++);
    return { root: new THREE.Group().add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())) };
  } };
  await harness(t, async h => {
    h.store.update(draft => { draft.name = 'Previous edit'; });
    const before = h.store.getSnapshot(), selected = h.editor.getSnapshot().selectedObjectId;
    const next = createDefaultSceneModel(), sources = new ProjectAssets();
    const options = { unit: 'meter', coordinateSystem: 'y-up', quality: 'medium', centerModel: false, placeOnGround: false };
    for (let index = 0; index < 2; index++) {
      const file = new File(['source'], `part-${index}.step`), assetId = `asset-${index}`;
      sources.capture(assetId, file, [file], options);
      next.imports.push({ id: `import-${index}`, assetId, name: file.name, format: 'STEP', visible: true,
        transform: { position: { x: 0, y: 0, z: 0 }, rotationDegrees: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        materialMode: 'imported', customMaterialId: null,
        metadata: { fileName: file.name, format: 'STEP', sizeBytes: file.size, objectCount: 1, triangleCount: 12, materialCount: 1 },
        warnings: [], hierarchy: [] });
    }
    const running = h.controller.open(await encodeProject(next, sources, h.images));
    const rejected = assert.rejects(running, error => error.name === 'AbortError');
    await until(() => count === 2, 'restore should reach its second source after staging the first');
    h.root.querySelector('[data-project-cancel]').click();
    await rejected;
    assert.equal(restoreSignal.aborted, true);
    assert.equal(disposals, 1);
    assert.equal(h.assets.size, 0);
    assert.equal(h.sources.imports.size, 0);
    assert.equal(h.store.getSnapshot(), before);
    assert.equal(h.editor.getSnapshot().selectedObjectId, selected);
    assert.equal(h.history.canUndo, true);
    assert.equal(h.controller.busy, false);
    assert.equal(h.shell.inert, false);
    h.controller.undo();
    assert.equal(h.store.getSnapshot().name, createDefaultSceneModel().name);
    await h.controller.save();
    assert.equal(h.downloads.length, 1);
  }, manager);
});
