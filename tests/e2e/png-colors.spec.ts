import { test, expect } from '@playwright/test';

test('PNG preserves viewport compositing for overlapping transparent surfaces', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    // Use the export module's own Vite dependency instance for Three's instanceof checks.
    const source = await (await fetch('/Render-Viewer-3D/src/three/png-export.ts')).text();
    const threePath = source.match(/from ["']([^"']*three\.js[^"']*)["']/)![1]!;
    const THREE = await import(threePath);
    const { renderPng } = await import('/Render-Viewer-3D/src/three/png-export.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(64, 64); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#10141b');
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 10); camera.position.z = 3;
    for (const [color, z] of [['#ff0000', 0], ['#0000ff', .5]] as const) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .5, depthWrite: false }));
      mesh.position.z = z; scene.add(mesh);
    }
    renderer.render(scene, camera);
    const screen = new Uint8Array(4), gl = renderer.getContext(); gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, screen);
    const blob = await renderPng(renderer, scene, camera, [], { width: 64, height: 64, transparent: false });
    const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
    const exported = [...context.getImageData(32, 32, 1, 1).data];
    scene.children.forEach((mesh: any) => { mesh.geometry.dispose(); mesh.material.dispose(); }); renderer.dispose(); renderer.forceContextLoss();
    return { screen: [...screen], exported };
  });
  expect(result.screen[0]).toBeGreaterThan(20); expect(result.screen[2]).toBeGreaterThan(50);
  result.screen.forEach((value, index) => expect(Math.abs(result.exported[index]! - value)).toBeLessThanOrEqual(1));
});

test('PNG honors non-tone-mapped helper colors and restores helpers after transparent export', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const source = await (await fetch('/Render-Viewer-3D/src/three/png-export.ts')).text();
    const THREE = await import(source.match(/from ["']([^"']*three\.js[^"']*)["']/)![1]!);
    const { renderPng } = await import('/Render-Viewer-3D/src/three/png-export.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true }); renderer.setSize(64, 64);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 2;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#10141b');
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 10); camera.position.z = 3;
    const helper = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: '#808080', toneMapped: false })); scene.add(helper);
    const pixel = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close(); return [...context.getImageData(32, 32, 1, 1).data];
    };
    const included = await pixel(await renderPng(renderer, scene, camera, [helper], { width: 64, height: 64, includeHelpers: true }));
    const excluded = await pixel(await renderPng(renderer, scene, camera, [helper], { width: 64, height: 64, transparent: true }));
    const restored = helper.visible && scene.background.getHexString() === '10141b';
    helper.geometry.dispose(); helper.material.dispose(); renderer.dispose(); renderer.forceContextLoss(); return { included, excluded, restored };
  });
  expect(result.included).toEqual([128, 128, 128, 255]); expect(result.excluded[3]).toBe(0); expect(result.restored).toBe(true);
});

test('failed PNG encoding restores drawing buffer and renderer state before rejecting', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const source = await (await fetch('/Render-Viewer-3D/src/three/png-export.ts')).text();
    const THREE = await import(source.match(/from ["']([^"']*three\.js[^"']*)["']/)![1]!);
    const { renderPng } = await import('/Render-Viewer-3D/src/three/png-export.ts');
    const renderer = new THREE.WebGLRenderer({ alpha: true }); renderer.setPixelRatio(2); renderer.setSize(40, 30, false);
    renderer.setViewport(2, 3, 20, 10); renderer.setScissor(1, 2, 20, 10); renderer.setScissorTest(true); renderer.setClearColor('#123456', .25); renderer.autoClear = false;
    const target = new THREE.WebGLRenderTarget(8, 8); renderer.setRenderTarget(target);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#102030');
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 10); camera.position.z = 3;
    const helper = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(helper);
    const state = () => ({ size: renderer.getSize(new THREE.Vector2()).toArray(), pixels: [renderer.domElement.width, renderer.domElement.height], ratio: renderer.getPixelRatio(), viewport: renderer.getViewport(new THREE.Vector4()).toArray(), scissor: renderer.getScissor(new THREE.Vector4()).toArray(), scissorTest: renderer.getScissorTest(), clear: renderer.getClearColor(new THREE.Color()).getHexString(), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, background: scene.background.getHexString(), helper: helper.visible, target: renderer.getRenderTarget() === target });
    const before = state(), original = renderer.domElement.toBlob;
    renderer.domElement.toBlob = (callback: BlobCallback) => callback(null);
    let rejected = false;
    try { await renderPng(renderer, scene, camera, [helper], { width: 128, height: 96, transparent: true }); } catch { rejected = true; }
    const after = state(); renderer.domElement.toBlob = original;
    target.dispose(); helper.geometry.dispose(); helper.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
    return { before, after, rejected };
  });
  expect(result.rejected).toBe(true); expect(result.after).toEqual(result.before);
});
