import { ImportManager } from "../importers";
import { createDefaultSceneModel } from "../model/default-scene";
import {
  deleteImportedScene,
  renameImportedScene,
  setImportedSceneMaterialMode,
  setImportedSceneVisibility,
  updateImportedSceneTransform,
} from "../model/imported-scene-model";
import {
  addMaterial,
  assignMaterial,
  deleteMaterial,
  duplicateMaterial,
  makeMaterialUnique,
  renameMaterial,
  updateMaterialPovScalar,
  updateMaterialPreviewProperty,
} from "../model/material/material-commands";
import { getMaterialPreset } from "../model/material/material-presets";
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
import { ImportedAssetStore } from "../three/imported-asset-store";
import { MaterialImageAssetStore } from "../three/material/image-asset-store";
import { SceneAdapter } from "../three/scene-adapter";
import { AppShell } from "../ui/app-shell";
import { EditorStore } from "./editor-store";
import { ImportController } from "./import-controller";
import { MaterialTextureController } from "./material-texture-controller";
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
  const importedAssets = new ImportedAssetStore();
  const materialImages = new MaterialImageAssetStore();
  const materialTextures = new MaterialTextureController(store, materialImages);
  const importManager = new ImportManager();
  const importAbortController = new AbortController();
  const shell = new AppShell(root);

  try {
    const adapter = new SceneAdapter(shell.viewportElement, store.getSnapshot(), {
      importedAssets,
      materialImages,
      onCameraInteractionEnd: ({ position, target, near, far }) => {
        store.update((draft) => {
          draft.camera.position = position;
          draft.camera.target = target;
          draft.camera.near = near;
          draft.camera.far = far;
        });
      },
      onObjectSelected: (objectId) => {
        editorStore.setSelectedObjectId(objectId);
      },
      onObjectTransformCommitted: (objectId, transform) => {
        store.update((draft) => {
          if (!updateSceneObjectTransform(draft, objectId, transform)) {
            updateImportedSceneTransform(draft.imports, objectId, transform);
          }
        });
      },
    });
    const importController = new ImportController(
      importManager,
      importedAssets,
      store,
      editorStore,
      adapter,
    );
    shell.refreshPreferences();

    let currentEditorState = editorStore.getSnapshot();

    const unsubscribeScene = store.subscribe((model) => {
      const selectedId = currentEditorState.selectedObjectId;
      const selectionExists =
        !selectedId ||
        model.objects.some(({ id }) => id === selectedId) ||
        model.imports.some(({ id }) => id === selectedId);
      if (!selectionExists) {
        editorStore.setSelectedObjectId(
          model.objects[0]?.id ?? model.imports[0]?.id ?? null,
        );
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
        adapter.resetCameraConstraints();
        const defaultCamera = createDefaultSceneModel().camera;
        store.update((draft) => {
          draft.camera = defaultCamera;
        });
      },
      importFiles: async (files, options) => {
        await importController.importFiles(files, {
          ...options,
          signal: importAbortController.signal,
        });
      },
      attachMaterialColorMap: async (materialId, file) => {
        await materialTextures.attach(materialId, file);
      },
      updateMaterialColorMap: (materialId, field, value) => {
        materialTextures.update(materialId, field, value);
      },
      removeMaterialColorMap: (materialId) => {
        materialTextures.remove(materialId);
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
          if (!setSceneObjectVisibility(draft, objectId, visible)) {
            setImportedSceneVisibility(draft.imports, objectId, visible);
          }
        });
      },
      updateObjectName: (objectId, name) => {
        store.update((draft) => {
          if (!renameSceneObject(draft, objectId, name)) {
            renameImportedScene(draft.imports, objectId, name);
          }
        });
      },
      updateObjectTransform: (objectId, group, axis, value) => {
        const update = {
          [group]: { [axis]: value },
        } as SceneObjectTransformUpdate;
        store.update((draft) => {
          if (!updateSceneObjectTransform(draft, objectId, update)) {
            updateImportedSceneTransform(draft.imports, objectId, update);
          }
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
          const objectIndex = draft.objects.findIndex(({ id }) => id === objectId);
          if (objectIndex >= 0 && deleteSceneObject(draft, objectId)) {
            fallbackId =
              draft.objects[Math.min(objectIndex, draft.objects.length - 1)]
                ?.id ??
              draft.imports[0]?.id ??
              null;
            return;
          }

          const importIndex = draft.imports.findIndex(({ id }) => id === objectId);
          if (importIndex < 0 || !deleteImportedScene(draft.imports, objectId)) {
            return;
          }
          fallbackId =
            draft.imports[Math.min(importIndex, draft.imports.length - 1)]?.id ??
            draft.objects[0]?.id ??
            null;
        });
        if (selectedId === objectId) editorStore.setSelectedObjectId(fallbackId);
      },
      setTransformMode: (mode) => {
        editorStore.setTransformMode(mode);
      },
      setImportedMaterialMode: (objectId, mode, customMaterialId) => {
        store.update((draft) => {
          if (
            mode === "custom" &&
            (!customMaterialId ||
              !draft.materials.some(({ id }) => id === customMaterialId))
          ) {
            return;
          }
          setImportedSceneMaterialMode(
            draft.imports,
            objectId,
            mode,
            customMaterialId,
          );
        });
      },
      createMaterialFromPreset: (presetId) => {
        const presetName = getMaterialPreset(presetId).label.en;
        store.update((draft) => {
          addMaterial(draft, { name: presetName, presetId });
        });
      },
      assignMaterial: (objectId, materialId) => {
        store.update((draft) => {
          assignMaterial(draft, objectId, materialId);
        });
      },
      duplicateMaterial: (materialId) => {
        store.update((draft) => {
          duplicateMaterial(draft, materialId);
        });
      },
      renameMaterial: (materialId, name) => {
        store.update((draft) => {
          renameMaterial(draft, materialId, name);
        });
      },
      deleteMaterial: (materialId) => {
        materialTextures.cancelPending(materialId);
        store.update((draft) => {
          deleteMaterial(draft, materialId);
        });
        materialTextures.releaseUnused();
      },
      makeMaterialUnique: (objectId) => {
        store.update((draft) => {
          makeMaterialUnique(draft, objectId);
        });
      },
      updateMaterialPreview: (materialId, field, value) => {
        store.update((draft) => {
          updateMaterialPreviewProperty(draft, materialId, field, value);
        });
      },
      updateMaterialPovScalar: (materialId, path, value) => {
        store.update((draft) => {
          updateMaterialPovScalar(draft, materialId, path, value);
        });
      },
    });

    shell.setReady();
    return {
      dispose: () => {
        importAbortController.abort();
        materialTextures.dispose();
        unsubscribeEditor();
        unsubscribeScene();
        adapter.dispose();
        materialImages.dispose();
        importedAssets.dispose();
        shell.dispose();
      },
    };
  } catch (error) {
    shell.setError();
    throw error;
  }
}
