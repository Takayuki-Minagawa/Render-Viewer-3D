import type { AppLocale, MessageKey } from "./i18n";
import type { MaterialEditorTab } from "./material-library-view-base";
import type { MaterialSupportStatus } from "./material-library-state";

export interface MaterialDetailRenderState {
  readonly materialId: string;
  readonly locale: AppLocale;
  readonly editorTab: MaterialEditorTab;
  readonly capabilityQuery: string;
  readonly capabilitySupport: "all" | MaterialSupportStatus;
  readonly selectedObjectId: string | null;
  readonly selectedObjectMaterialId: string | null;
  readonly usage: number;
  readonly assigned: boolean;
}

/**
 * Includes only values that change detail structure or action state.
 * Editable preview values and presetId intentionally stay out of this key so
 * synchronous store updates do not replace the focused input element.
 */
export function createMaterialDetailRenderKey(
  state: MaterialDetailRenderState,
): string {
  return JSON.stringify([
    state.materialId,
    state.locale,
    state.editorTab,
    state.capabilityQuery,
    state.capabilitySupport,
    state.selectedObjectId,
    state.selectedObjectMaterialId,
    state.usage,
    state.assigned,
  ]);
}

export function materialKindMessageKey(
  presetId: string | null,
): Extract<MessageKey, "material.builtIn" | "material.custom"> {
  return presetId ? "material.builtIn" : "material.custom";
}

export function resolveMaterialTabKey(
  current: MaterialEditorTab,
  key: string,
): MaterialEditorTab | undefined {
  if (key === "Home") return "basic";
  if (key === "End") return "advanced";
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return current === "basic" ? "advanced" : "basic";
  }
  return undefined;
}
