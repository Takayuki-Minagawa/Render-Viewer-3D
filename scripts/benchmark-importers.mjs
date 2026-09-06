import { performance } from "node:perf_hooks";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
const triangle = "facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n";
for (const faces of [10_000, 100_000]) {
  const ascii = new TextEncoder().encode(`solid benchmark\n${triangle.repeat(faces)}endsolid benchmark\n`);
  const obj = `v 0 0 0\nv 1 0 0\nv 0 1 0\n${"f 1 2 3\n".repeat(faces)}`;
  for (const [format, source, parser] of [["STL ASCII", ascii, (data) => new STLLoader().parse(data.buffer)], ["OBJ", obj, (data) => new OBJLoader().parse(data)]]) {
    const timings = [];
    for (let run = 0; run < 9; run++) {
      const start = performance.now(); const result = parser(source); const elapsed = performance.now() - start;
      if (run > 1) timings.push(elapsed);
      if (result.isBufferGeometry) result.dispose();
      else result.traverse((node) => { node.geometry?.dispose(); if (node.material) node.material.dispose(); });
    }
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ node: process.version, format, faces, sourceBytes: format === "OBJ" ? Buffer.byteLength(source) : source.byteLength, warmups: 2, runs: timings.length, medianMs: +timings[3].toFixed(2), p95Ms: +timings.at(-1).toFixed(2) }));
  }
}
