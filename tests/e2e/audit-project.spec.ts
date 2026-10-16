import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function projectScene(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString()).toBe('RV3D0001');
  const length = bytes.readUInt32LE(8);
  return JSON.parse(bytes.subarray(12, 12 + length).toString('utf8')).scene;
}

async function browserScene(page: Page): Promise<{ name: string; objectName: string } | null> {
  return page.evaluate(async () => {
    const value: any = await new Promise((resolve, reject) => {
      const opening = indexedDB.open('render-viewer-3d-projects', 1);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction('projects', 'readonly');
        const request = tx.objectStore('projects').get('latest-v1');
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    if (!value) return null;
    const blob = value instanceof Blob ? value : new Blob([value.bytes], { type: value.type });
    const header = await blob.slice(0, 12).arrayBuffer();
    const length = new DataView(header).getUint32(8, true);
    const { scene } = JSON.parse(await blob.slice(12, 12 + length).text());
    return { name: scene.name, objectName: scene.objects[0].name };
  });
}

test('B-003 a manual export inside the autosave debounce preserves the newest download and browser recovery', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('[data-project-action="save"]')).toBeVisible();
  await page.evaluate(() => (window as any).__viewer.store.update((draft: any) => {
    draft.name = 'Audit Scene A'; draft.objects[0].name = 'Object A';
  }));
  await expect(page.locator('[data-project-autosave-status]')).toHaveAttribute('data-state', 'saved');
  expect(await browserScene(page)).toEqual({ name: 'Audit Scene A', objectName: 'Object A' });

  const downloading = page.waitForEvent('download');
  // Both calls occur in one browser task: the 800 ms debounce cannot elapse
  // between this edit and the manual export, even on a busy test runner.
  await page.evaluate(async () => {
    const viewer = (window as any).__viewer;
    viewer.store.update((draft: any) => { draft.name = 'Audit Scene B'; draft.objects[0].name = 'Object B'; });
    await viewer.projects.save();
  });
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Audit_Scene_B.rv3d');
  const downloaded = projectScene(await readFile((await download.path())!));
  expect(downloaded.name).toBe('Audit Scene B');
  expect(downloaded.objects[0].name).toBe('Object B');
  await expect(page.locator('[data-project-file-status]')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('[data-project-file-status]')).toContainText('Audit_Scene_B.rv3d');
  await expect(page.locator('[data-project-autosave-status]')).toHaveAttribute('data-state', 'saved');
  expect(await browserScene(page)).toEqual({ name: 'Audit Scene B', objectName: 'Object B' });
  for (const selector of ['[data-project-file-status]', '[data-project-autosave-status]']) {
    const savedAt = await page.locator(selector).getAttribute('data-saved-at');
    expect(Number.isNaN(Date.parse(savedAt!))).toBe(false);
  }

  await page.reload();
  await page.locator('[data-project-action="recover"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.store.getSnapshot().name)).toBe('Audit Scene B');
  expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().objects[0].name)).toBe('Object B');
});

type WorkerFault = 'init-error' | 'parse-messageerror' | 'parse-stall';
async function interceptSTEPWorker(page: Page, fault: WorkerFault) {
  await page.addInitScript(({ fault }) => {
    const NativeWorker = window.Worker;
    const state = { mode: fault as string, calls: [] as string[], terminated: 0, trigger: null as null | (() => void) };
    (window as any).__stepAudit = state;
    // Only STEP is simulated. Other application Workers keep their native path,
    // and switching to "real" retries the exact same file through OpenCascade.
    class FaultWorker extends EventTarget {
      private stopped = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super();
        if (!/step-worker-entry/.test(String(url)) || state.mode === 'real') return new NativeWorker(url, options) as any;
      }
      postMessage(message: { id: string; path?: string[] }) {
        if (this.stopped) return;
        const method = message.path?.join('.') ?? '';
        state.calls.push(method);
        if (method === 'init' && state.mode !== 'init-error') {
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, type: 'RAW', value: undefined } })));
          return;
        }
        state.trigger = () => {
          if (this.stopped) return;
          if (state.mode === 'init-error') this.dispatchEvent(new ErrorEvent('error', { message: 'Simulated STEP initialization crash', cancelable: true }));
          if (state.mode === 'parse-messageerror') this.dispatchEvent(new MessageEvent('messageerror'));
        };
        // A stalled worker deliberately sends no RPC response or native error.
      }
      terminate() { if (!this.stopped) { this.stopped = true; state.terminated++; } }
    }
    window.Worker = FaultWorker as unknown as typeof Worker;
  }, { fault });
}

for (const fault of ['init-error', 'parse-messageerror', 'parse-stall'] as const) {
  test(`B-002 STEP ${fault} releases busy state and retains history for retry, undo and save`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await interceptSTEPWorker(page, fault);
    await page.goto('./');
    await expect(page.locator('[data-project-action="save"]')).toBeVisible();
    await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      viewer.store.update((draft: any) => { draft.name = 'Retained edit'; });
      viewer.store.update((draft: any) => { draft.name = 'Retained redo'; });
      viewer.projects.undo();
    });
    const source = await readFile(new URL('../fixtures/step/box-10x20x30mm.step', import.meta.url));
    const file = { name: 'audit-box.step', mimeType: 'model/step', buffer: source };
    await page.locator('[data-import-file-input]').setInputFiles(file);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__stepAudit.trigger))).toBe(true);
    await expect(page.locator('[data-project-operation]')).toBeVisible();
    const locked = await page.evaluate(() => ({
      shell: document.querySelector<HTMLElement>('.app-shell')!.inert,
      toolbar: document.querySelector<HTMLElement>('.project-toolbar')!.inert,
      cancelInShell: Boolean(document.querySelector('[data-project-cancel]')!.closest('.app-shell')),
    }));
    expect(locked).toEqual({ shell: true, toolbar: true, cancelInShell: false });
    await expect(page.locator('[data-project-cancel]')).toBeEnabled();

    if (fault === 'parse-stall') {
      expect(await page.evaluate(() => (window as any).__stepAudit.calls)).toContain('importAssembly');
      const firstStatus = await page.locator('[data-project-operation-status]').textContent();
      await expect.poll(() => page.locator('[data-project-operation-status]').textContent()).not.toBe(firstStatus);
      await page.locator('[data-project-cancel]').focus();
      await expect(page.locator('[data-project-cancel]')).toBeFocused();
      await page.keyboard.press('Enter');
    } else {
      await page.evaluate(() => (window as any).__stepAudit.trigger());
    }
    await expect.poll(() => page.evaluate(() => (window as any).__viewer.projects.busy)).toBe(false);
    await expect(page.locator('[data-project-operation]')).not.toBeVisible();
    await expect(page.locator('[data-import-status]')).toHaveAttribute('data-kind', fault === 'parse-stall' ? 'cancelled' : 'error');
    await expect(page.locator('[data-import-status]')).toContainText(fault === 'parse-stall' ? /cancel|abort|取消|取り消|中止/i : /worker/i);
    expect(await page.evaluate(() => {
      const viewer = (window as any).__viewer;
      return { name: viewer.store.getSnapshot().name, imports: viewer.store.getSnapshot().imports.length,
        canUndo: viewer.history.canUndo, canRedo: viewer.history.canRedo,
        inert: document.querySelector<HTMLElement>('.app-shell')!.inert,
        terminated: (window as any).__stepAudit.terminated };
    })).toEqual({ name: 'Retained edit', imports: 0, canUndo: true, canRedo: true, inert: false, terminated: 1 });
    await page.locator('[data-project-action="redo"]').click();
    expect(await page.evaluate(() => (window as any).__viewer.store.getSnapshot().name)).toBe('Retained redo');
    await page.locator('[data-project-action="undo"]').click();

    await page.evaluate(() => { (window as any).__stepAudit.mode = 'real'; });
    await page.locator('[data-import-file-input]').setInputFiles(file);
    await expect(page.locator('[data-object-count]')).toHaveText('4', { timeout: 45000 });
    await expect(page.locator('[data-import-status]')).toHaveAttribute('data-kind', 'success');
    await page.locator('[data-project-action="undo"]').click();
    await expect(page.locator('[data-object-count]')).toHaveText('3');
    await page.locator('[data-project-action="redo"]').click();
    await expect(page.locator('[data-object-count]')).toHaveText('4');
    const downloading = page.waitForEvent('download');
    await page.locator('[data-project-action="save"]').click();
    const scene = projectScene(await readFile((await (await downloading).path())!));
    expect(scene.name).toBe('Retained edit');
    expect(scene.imports).toHaveLength(1);
    expect(scene.imports[0].metadata.fileName).toBe('audit-box.step');
    expect(pageErrors).toEqual([]);
  });
}
