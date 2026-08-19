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

export interface MaterialAssignmentSelectionState {
  readonly dialogOpen: boolean;
  readonly currentMaterialId: string | null;
  readonly previousObjectId: string | null;
  readonly nextObjectId: string | null;
  readonly previousAssignedMaterialId: string | null;
  readonly nextAssignedMaterialId: string | null;
}

/**
 * Follows a make-unique transition without hijacking ordinary assignment or
 * a deliberate material selection. The selected object must be unchanged,
 * and the library must still be showing the material that object used before
 * the assignment changed.
 */
export function resolveMaterialSelectionAfterAssignmentChange(
  state: MaterialAssignmentSelectionState,
): string | null {
  if (
    state.dialogOpen &&
    state.previousObjectId !== null &&
    state.previousObjectId === state.nextObjectId &&
    state.previousAssignedMaterialId !== null &&
    state.nextAssignedMaterialId !== null &&
    state.previousAssignedMaterialId !== state.nextAssignedMaterialId &&
    state.currentMaterialId === state.previousAssignedMaterialId
  ) {
    return state.nextAssignedMaterialId;
  }
  return state.currentMaterialId;
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
