import { createServer } from 'vite';
import { fixture } from '../tests/fixtures/generated-gltf.mjs';
const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
try {
  const { optimizeGlbCopy } = await server.ssrLoadModule('/src/asset-tools/optimization.ts');
  await optimizeGlbCopy(await fixture(3)); // Warm SDK and validator imports.
  const measurements = [];
  for (const [parts, animation] of [[3, true], [20, true], [1, false]]) {
    const input = await fixture(parts, animation);
    const durations = []; let result;
    for (let run = 0; run < 5; run++) { result = await optimizeGlbCopy(input); durations.push(result.durationMs); }
    durations.sort((a, b) => a - b);
    measurements.push({ parts, animation, inputBytes: result.inputBytes, outputBytes: result.outputBytes, reductionPercent: +(100 * (1 - result.outputBytes / result.inputBytes)).toFixed(1), medianMs: +durations[2].toFixed(2), estimatedWorkingBytes: result.estimatedWorkingBytes, errors: result.report.issues.numErrors, warnings: result.report.issues.numWarnings });
  }
  console.log(JSON.stringify({ node: process.version, platform: `${process.platform}/${process.arch}`, preset: 'accessor dedup + accessor/buffer prune; no geometry simplification', measurements }, null, 2));
} finally { await server.close(); }
