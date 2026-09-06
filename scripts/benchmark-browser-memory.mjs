import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// macOS/Linux diagnostic only. Summed RSS counts shared pages more than once;
// sampled maxima are an estimate, not an exact browser/GPU memory measurement.
function browserRssKiB(parent) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n')
    .map(row => row.trim().split(/\s+/).map(Number));
  const ids = new Set([parent]);
  for (let i = 0; i < rows.length; i++) for (const [pid, ppid] of rows) if (ids.has(ppid)) ids.add(pid);
  return rows.reduce((total, [pid, , rss]) => total + (ids.has(pid) ? rss : 0), 0);
}
for (const mode of ['synchronous-baseline', 'worker']) {
  for (let run = 1; run <= 3; run++) {
    const server = await chromium.launchServer({ headless: true });
    const browser = await chromium.connect(server.wsEndpoint());
    try {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:4173/Render-Viewer-3D/');
      await page.locator('.viewport-canvas').waitFor();
      await page.evaluate(async () => {
        window.__memorySTLLoader = (await import('/Render-Viewer-3D/node_modules/three/examples/jsm/loaders/STLLoader.js')).STLLoader;
        window.__memorySTLWorker = (await import('/Render-Viewer-3D/src/importers/stl-parser.ts')).parseSTL;
      });
      await page.waitForTimeout(300);
      const baseline = browserRssKiB(server.process().pid);
      let peak = baseline, samples = 0;
      const timer = setInterval(() => { peak = Math.max(peak, browserRssKiB(server.process().pid)); samples++; }, 20);
      const started = performance.now();
      try {
        await page.evaluate(async mode => {
          const triangle = 'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n';
          const text = `solid benchmark\n${triangle.repeat(100_000)}endsolid benchmark\n`;
          for (let i = 0; i < 25; i++) {
            const data = new TextEncoder().encode(text).buffer;
            const geometry = mode === 'worker' ? await window.__memorySTLWorker(data) : new window.__memorySTLLoader().parse(data);
            if (geometry.attributes.position.count !== 300_000) throw new Error('Unexpected fixture geometry');
            geometry.dispose();
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }, mode);
      } finally { clearInterval(timer); }
      peak = Math.max(peak, browserRssKiB(server.process().pid));
      console.log(JSON.stringify({ browser: browser.version(), mode, run, faces: 100000, iterations: 25, sourceBytes: 8600035,
        sampleIntervalMs: 20, samples, baselineMiB: +(baseline / 1024).toFixed(1), peakMiB: +(peak / 1024).toFixed(1),
        deltaMiB: +((peak-baseline)/1024).toFixed(1), elapsedMs: +(performance.now()-started).toFixed(1) }));
    } finally { await browser.close(); await server.close(); }
  }
}
