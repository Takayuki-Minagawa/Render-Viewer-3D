import * as THREE from "three";
import type { DeepReadonly } from "../../model/scene-model";
import type { MaterialDefinitionModel } from "../../model/material/material-model";
import {
  applyMaterialProjection,
  createMeshPhysicalMaterial,
  projectMaterial,
  type MaterialProjectionDiagnostic,
} from "./material-projector";

type MaterialDefinitionSnapshot = DeepReadonly<MaterialDefinitionModel>;

interface MaterialRuntimeEntry {
  readonly material: THREE.MeshPhysicalMaterial;
  valueSignature: string;
  programSignature: string;
  diagnostics: readonly MaterialProjectionDiagnostic[];
}

export class MaterialRuntimeCache {
  readonly #entries = new Map<string, MaterialRuntimeEntry>();
  #disposed = false;

  reconcile(definitions: readonly MaterialDefinitionSnapshot[]): void {
    this.#assertActive();
    const ids = collectUniqueMaterialIds(definitions);
    const projections = definitions.map((definition) => ({
      definition,
      projection: projectMaterial(definition),
    }));

    for (const { definition, projection } of projections) {
      const existing = this.#entries.get(definition.id);
      if (!existing) {
        const material = createMeshPhysicalMaterial(projection);
        material.name = definition.name;
        material.userData.sceneMaterialId = definition.id;
        this.#entries.set(definition.id, {
          material,
          valueSignature: projection.valueSignature,
          programSignature: projection.programSignature,
          diagnostics: projection.diagnostics,
        });
        continue;
      }

      existing.material.name = definition.name;
      if (existing.valueSignature !== projection.valueSignature) {
        const programChanged =
          existing.programSignature !== projection.programSignature;
        applyMaterialProjection(existing.material, projection);
        if (programChanged) existing.material.needsUpdate = true;
        existing.valueSignature = projection.valueSignature;
        existing.programSignature = projection.programSignature;
      }
      existing.diagnostics = projection.diagnostics;
    }

    for (const [id, entry] of this.#entries) {
      if (ids.has(id)) continue;
      entry.material.dispose();
      this.#entries.delete(id);
    }
  }

  getMaterial(materialId: string): THREE.MeshPhysicalMaterial | undefined {
    return this.#entries.get(materialId)?.material;
  }

  requireMaterial(materialId: string): THREE.MeshPhysicalMaterial {
    const material = this.getMaterial(materialId);
    if (!material) {
      throw new Error(`Missing material runtime for SceneModel id: ${materialId}`);
    }
    return material;
  }

  getDiagnostics(
    materialId: string,
  ): readonly MaterialProjectionDiagnostic[] {
    return this.#entries.get(materialId)?.diagnostics ?? [];
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#entries.values()) entry.material.dispose();
    this.#entries.clear();
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("MaterialRuntimeCache has already been disposed.");
    }
  }
}

function collectUniqueMaterialIds(
  definitions: readonly MaterialDefinitionSnapshot[],
): Set<string> {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate material id in SceneModel: ${definition.id}`);
    }
    ids.add(definition.id);
  }
  return ids;
}
