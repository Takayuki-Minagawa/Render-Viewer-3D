import { ImportManager } from "../importers";
import { createDefaultSceneModel } from "../model/default-scene";
import {
  deleteImportedScene,
  renameImportedScene,
  setImportedSceneMaterialMode,
  setImportedSceneVisibility,
  updateImportedSceneTransform,
  setImportedNodeVisibility, setImportedNodeMaterial, isolateImportedNode, resetImportedNodeOverrides,
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
import { ProjectAssets } from "./project-assets";
import { SceneHistory } from "./scene-history";
import { ProjectController } from "./project-controller";
import { ImportedNodeTools } from "../ui/imported-node-tools";
import { AppearanceTools } from "../ui/appearance-tools";
import { MaterialPbrMapController } from "./material-pbr-map-controller";
import { MaterialMapTools } from "../ui/material-map-tools";

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
  const projectAssets = new ProjectAssets();
  const history = new SceneHistory(store, importedAssets, materialImages, projectAssets);
  const importManager = new ImportManager();
  const importAbortController = new AbortController();
  const shell = new AppShell(root);
  let nodeTools: ImportedNodeTools | undefined;

  try {
    const adapter = new SceneAdapter(shell.viewportElement, store.getSnapshot(), {
      importedAssets,
      materialImages,
      onCameraInteractionEnd: ({ position, target, near, far, projection, orthographicHeight, up }) => {
        store.update((draft) => {
          draft.camera.position = position;
          draft.camera.target = target;
          draft.camera.near = near;
          draft.camera.far = far;
          draft.camera.projection = projection;
          if (orthographicHeight === undefined) delete draft.camera.orthographicHeight;
          else draft.camera.orthographicHeight = orthographicHeight;
          draft.camera.up = up;
        }, { history: false });
      },
      onShadowsChanged: (enabled) => store.update(draft => { draft.shadowsEnabled = enabled; }),
      onImportedNodeSelected: (importId, nodeId) => nodeTools?.selectNode(importId, nodeId),
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
    const materialTextures = new MaterialTextureController(
      store,
      materialImages,
      () => adapter.applyModel(store.getSnapshot()),
    );
    const importController = new ImportController(
      importManager,
      importedAssets,
      store,
      editorStore,
      adapter,
      (assetId, primary, files, options) => projectAssets.capture(assetId, primary, files, options),
    );
    let environmentGeneration = 0;
    let environmentTarget: string | null = null;
    let disposed = false;
    const prepareEnvironment = async (file: File | null, assetId: string | null) => {
      const texture = file ? await adapter.prepareEnvironment(file) : null;
      if (disposed) { texture?.dispose(); throw new Error("Application disposed."); }
      let committed = false;
      return { commit() { committed = true; environmentTarget = assetId; environmentGeneration++; adapter.setEnvironment(texture); }, dispose() { if (!committed) texture?.dispose(); } };
    };
    const projects = new ProjectController(root, store, editorStore, importManager, importedAssets, materialImages, projectAssets, history, prepareEnvironment);
    const pbrMaps = new MaterialPbrMapController(store, materialImages);
    const mapTools = new MaterialMapTools(root.querySelector<HTMLElement>(".inspector-panel") ?? shell.viewportElement, store, pbrMaps, operation => projects.editAsync(operation));
    const appearance = new AppearanceTools(shell.viewportElement, store, {
      onEnvironmentFile: (file) => projects.editAsync(async () => {
        const id = file ? `environment-${crypto.randomUUID()}` : null;
        const prepared = await prepareEnvironment(file, id);
        if (file && id) projectAssets.environments.set(id, file);
        try { prepared.commit(); store.update(draft => { draft.environment = file && id ? { assetId: id, name: file.name } : null; }); }
        finally { prepared.dispose(); }
      }),
    });
    nodeTools = new ImportedNodeTools(root.querySelector<HTMLElement>(".scene-panel") ?? root.querySelector<HTMLElement>(".inspector-panel") ?? shell.viewportElement, {
      selectObject: id => editorStore.setSelectedObjectId(id),
      visibility: (id, node, visible) => store.update(d => { setImportedNodeVisibility(d.imports, id, node, visible); }),
      material: (id, node, material) => store.update(d => { if (material === null || d.materials.some(m => m.id === material)) setImportedNodeMaterial(d.imports, id, node, material); }),
      isolate: (id, node) => store.update(d => { isolateImportedNode(d.imports, id, node); }),
      reset: id => store.update(d => { resetImportedNodeOverrides(d.imports, id); }),
    });
    const applyLocale = () => {
      const locale = document.documentElement.lang === "en" ? "en" : "ja";
      adapter.setLocale(locale); projects.setLocale(locale);
      appearance.setLocale(locale);
      mapTools.setLocale(locale);
      nodeTools?.update(store.getSnapshot(), editorStore.getSnapshot().selectedObjectId, locale);
    };
    const localeObserver = new MutationObserver(applyLocale);
    localeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    applyLocale();
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
      nodeTools?.update(model, currentEditorState.selectedObjectId);
      const environmentId = model.environment?.assetId ?? null;
      if (environmentId !== environmentTarget) {
        environmentTarget = environmentId;
        const generation = ++environmentGeneration;
        const file = environmentId ? projectAssets.environments.get(environmentId) : undefined;
        void (file ? adapter.prepareEnvironment(file) : Promise.resolve(null)).then(texture => {
          if (disposed || generation !== environmentGeneration) texture?.dispose();
          else adapter.setEnvironment(texture);
        }).catch(error => projects.toolbar.status("error", String(error)));
      }
    });
    const unsubscribeEditor = editorStore.subscribe((editorState) => {
      currentEditorState = editorState;
      adapter.setSelection(editorState.selectedObjectId);
      adapter.setTransformMode(editorState.transformMode);
      shell.updateEditorState(editorState);
      nodeTools?.update(store.getSnapshot(), editorState.selectedObjectId);
    });

    shell.bindActions({
      beginEdit: () => history.begin(),
      endEdit: () => history.end(),
      cancelEdit: () => history.cancel(),
      selectImportedNode: (importId, nodeId) => nodeTools?.selectNode(importId, nodeId),
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
        }, { history: false });
      },
      importFiles: async (files, options) => {
        const started = performance.now();
        await projects.editAsync(() => importController.importFiles(files, {
          ...options,
          signal: importAbortController.signal,
        }));
        adapter.setImportDuration(performance.now() - started);
      },
      attachMaterialColorMap: async (materialId, file) => {
        await projects.editAsync(() => materialTextures.attach(materialId, file));
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
    if (import.meta.env.DEV) {
      Object.assign(window, { __viewer: { store, adapter, projects, history, importedAssets, materialImages, projectAssets, editorStore } });
    }
    return {
      dispose: () => {
        disposed = true;
        environmentGeneration++;
        appearance.dispose();
        mapTools.dispose();
        pbrMaps.dispose();
        nodeTools?.dispose();
        localeObserver.disconnect();
        projects.dispose();
        history.dispose();
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
