import {
  MATERIAL_CAPABILITIES as MODEL_MATERIAL_CAPABILITIES,
  type MaterialCapabilityFidelity,
} from "../../model/material/material-capabilities";

type MaterialCapabilitySnapshot =
  (typeof MODEL_MATERIAL_CAPABILITIES)[number];

export type MaterialSupportLevel = MaterialCapabilityFidelity;

export interface MaterialCapability {
  readonly support: MaterialSupportLevel;
  readonly code: string;
}

export const MATERIAL_CAPABILITIES = MODEL_MATERIAL_CAPABILITIES;

const UNKNOWN_POV_RAY_CAPABILITY: MaterialCapability = Object.freeze({
  support: "stored-only",
  code: "pov.extensions",
});

export function getMaterialCapability(path: string): MaterialCapability {
  const normalizedPath = path.replace(/\.\d+(?=\.|$)/g, "");
  const capability = findBestCapability(normalizedPath);
  if (!capability) return UNKNOWN_POV_RAY_CAPABILITY;

  return {
    // The catalog describes the target architecture. The current Three.js
    // projector does not consume POV-Ray nodes yet, so it must report their
    // runtime fidelity conservatively even when a future mapping is planned.
    support: normalizedPath.startsWith("pov")
      ? "stored-only"
      : capability.fidelity,
    code: capability.id,
  };
}

function findBestCapability(
  path: string,
): MaterialCapabilitySnapshot | undefined {
  if (path.includes(".extensions") || path.endsWith(".raw")) {
    return MODEL_MATERIAL_CAPABILITIES.find(
      (capability) => capability.id === "pov.extensions",
    );
  }

  let best: MaterialCapabilitySnapshot | undefined;
  let bestSpecificity = -1;
  for (const capability of MODEL_MATERIAL_CAPABILITIES) {
    if (!matchesCapabilityPath(capability.path, path)) continue;
    const specificity = capability.path.replaceAll("*", "").length;
    if (specificity <= bestSpecificity) continue;
    best = capability;
    bestSpecificity = specificity;
  }
  return best;
}

function matchesCapabilityPath(pattern: string, path: string): boolean {
  const expression = pattern
    .split("*")
    .map(escapeRegularExpression)
    .join("[^.]*");
  return new RegExp(`^${expression}(?:\\..+)?$`).test(path);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
