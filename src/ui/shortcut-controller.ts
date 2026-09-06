import type { AppActions } from "./app-shell";
import type { EditorState, TransformMode } from "../app/editor-store";
import type { SceneSnapshot } from "../model/scene-model";
interface ShortcutContext { dialogOpen: boolean; editorState: EditorState; model?: SceneSnapshot; }
export function handleEditorShortcut(event: KeyboardEvent, actions: AppActions, context: ShortcutContext): void {
    if (
      event.defaultPrevented ||
      context.dialogOpen ||
      isEditingTarget(event.target)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const selectedId = context.editorState.selectedObjectId;
    const primitiveSelected =
      selectedId !== null &&
      (context.model?.objects.some(({ id }) => id === selectedId) ?? false);
    if (
      (event.ctrlKey || event.metaKey) && key === "d" && primitiveSelected
    ) {
      event.preventDefault();
      actions.duplicateObject(selectedId!);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const shortcutModes: Partial<Record<string, TransformMode>> = {
      w: "translate",
      e: "rotate",
      r: "scale",
    };
    const mode = shortcutModes[key];
    if (mode) {
      event.preventDefault();
      actions.setTransformMode(mode);
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
      event.preventDefault();
      actions.deleteObject(selectedId);
    }
  }

export function isEditingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      target.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
      ) !== null
    );
  }
