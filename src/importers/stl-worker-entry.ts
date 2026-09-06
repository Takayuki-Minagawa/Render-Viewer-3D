import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { MAIN_THREAD_GEOMETRY_BUDGET } from "./geometry-budget";

interface WorkerScope { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void; }
const scope = self as unknown as WorkerScope;
scope.onmessage = ({ data }) => {
  try {
    const geometry = new STLLoader().parse(data);
    const position = geometry.getAttribute("position");
    if (position.count > MAIN_THREAD_GEOMETRY_BUDGET.maxPositionVertices) throw new Error("STL output exceeds the main-thread geometry safety budget.");
    const attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, { array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized }]));
    scope.postMessage({ attributes }, Object.values(attributes).map((attribute) => attribute.array.buffer as ArrayBuffer));
    geometry.dispose();
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
