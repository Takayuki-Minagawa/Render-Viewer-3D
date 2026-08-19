import { createDefaultSceneModel } from "../model/default-scene";
import {
  addSceneObject,
  deleteSceneObject,
  duplicateSceneObject,
  renameSceneObject,
  setSceneObjectVisibility,
  updateSceneObjectGeometry,
  updateSceneObjectTransform,
  type GeometryUpdate,
  type SceneObjectTransformUpdate,
} from "../model/scene-object-commands";
import { SceneAdapter } from "../three/scene-adapter";
import { AppShell } from "../ui/app-shell";
import { EditorStore } from "./editor-store";
import { SceneStore } from "./scene-store";

export interface Application {
  dispose: () => void;
}

export function createApplication(root: HTMLElement): Application {
  const initialModel = createDefaultSceneModel();
  const store = new SceneStore(initialModel);
  const editorStore = new EditorStore({
    selectedObjectId: initialModel.objects[0]?.id ?? null,
    transformMode: "translate",
  });
  const shell = new AppShell(root);

  try {
    const adapter = new SceneAdapter(shell.viewportElement, store.getSnapshot(), {
      onCameraInteractionEnd: ({ position, target }) => {
        store.update((draft) => {
          draft.camera.position = position;
          draft.camera.target = target;
        });
      },
      onObjectSelected: (objectId) => {
        editorStore.setSelectedObjectId(objectId);
      },
      onObjectTransformCommitted: (objectId, transform) => {
        store.update((draft) => {
          updateSceneObjectTransform(draft, objectId, transform);
        });
      },
    });
    shell.refreshPreferences();

    let currentEditorState = editorStore.getSnapshot();

    const unsubscribeScene = store.subscribe((model) => {
      const selectedId = currentEditorState.selectedObjectId;
      if (selectedId && !model.objects.some(({ id }) => id === selectedId)) {
        editorStore.setSelectedObjectId(model.objects[0]?.id ?? null);
        currentEditorState = editorStore.getSnapshot();
      }
      adapter.applyModel(model);
      shell.update(model, currentEditorState);
    });
    const unsubscribeEditor = editorStore.subscribe((editorState) => {
      currentEditorState = editorState;
      adapter.setSelection(editorState.selectedObjectId);
      adapter.setTransformMode(editorState.transformMode);
      shell.updateEditorState(editorState);
    });

    shell.bindActions({
      toggleGrid: () => {
        store.update((draft) => {
          draft.helpers.gridVisible = !draft.helpers.gridVisible;
        });
      },
      toggleAxes: () => {
        store.update((draft) => {
          draft.helpers.axesVisible = !draft.helpers.axesVisible;
        });
      },
      resetCamera: () => {
        const defaultCamera = createDefaultSceneModel().camera;
        store.update((draft) => {
          draft.camera = defaultCamera;
        });
      },
      addObject: (primitive) => {
        let addedId: string | null = null;
        store.update((draft) => {
          addedId = addSceneObject(draft, primitive).id;
        });
        editorStore.setSelectedObjectId(addedId);
      },
      selectObject: (objectId) => {
        editorStore.setSelectedObjectId(objectId);
      },
      setObjectVisibility: (objectId, visible) => {
        store.update((draft) => {
          setSceneObjectVisibility(draft, objectId, visible);
        });
      },
      updateObjectName: (objectId, name) => {
        store.update((draft) => {
          renameSceneObject(draft, objectId, name);
        });
      },
      updateObjectTransform: (objectId, group, axis, value) => {
        const update = {
          [group]: { [axis]: value },
        } as SceneObjectTransformUpdate;
        store.update((draft) => {
          updateSceneObjectTransform(draft, objectId, update);
        });
      },
      updateObjectGeometry: (objectId, key, value) => {
        store.update((draft) => {
          const object = draft.objects.find(({ id }) => id === objectId);
          if (!object) return;
          const update = {
            type: object.geometry.type,
            [key]: value,
          } as GeometryUpdate;
          updateSceneObjectGeometry(draft, objectId, update);
        });
      },
      duplicateObject: (objectId) => {
        let duplicateId: string | null = null;
        store.update((draft) => {
          duplicateId = duplicateSceneObject(draft, objectId)?.id ?? null;
        });
        if (duplicateId) editorStore.setSelectedObjectId(duplicateId);
      },
      deleteObject: (objectId) => {
        const selectedId = editorStore.getSnapshot().selectedObjectId;
        if (selectedId === objectId) editorStore.setSelectedObjectId(null);

        let fallbackId: string | null = null;
        store.update((draft) => {
          const index = draft.objects.findIndex(({ id }) => id === objectId);
          if (index < 0 || !deleteSceneObject(draft, objectId)) return;
          fallbackId = draft.objects[Math.min(index, draft.objects.length - 1)]?.id ?? null;
        });
        if (selectedId === objectId) editorStore.setSelectedObjectId(fallbackId);
      },
      setTransformMode: (mode) => {
        editorStore.setTransformMode(mode);
      },
    });

    shell.setReady();
    return {
      dispose: () => {
        unsubscribeEditor();
        unsubscribeScene();
        adapter.dispose();
        shell.dispose();
      },
    };
  } catch (error) {
    shell.setError();
    throw error;
  }
}
