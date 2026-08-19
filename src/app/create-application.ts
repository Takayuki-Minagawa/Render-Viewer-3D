import { createDefaultSceneModel } from "../model/default-scene";
import { SceneAdapter } from "../three/scene-adapter";
import { AppShell } from "../ui/app-shell";
import { SceneStore } from "./scene-store";

export interface Application {
  dispose: () => void;
}

export function createApplication(root: HTMLElement): Application {
  const store = new SceneStore(createDefaultSceneModel());
  const shell = new AppShell(root);

  try {
    const adapter = new SceneAdapter(shell.viewportElement, store.getSnapshot(), {
      onCameraInteractionEnd: ({ position, target }) => {
        store.update((draft) => {
          draft.camera.position = position;
          draft.camera.target = target;
        });
      },
    });
    shell.refreshPreferences();

    const unsubscribe = store.subscribe((model) => {
      adapter.applyModel(model);
      shell.update(model);
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
    });

    shell.setReady();
    return {
      dispose: () => {
        unsubscribe();
        adapter.dispose();
        shell.dispose();
      },
    };
  } catch (error) {
    shell.setError();
    throw error;
  }
}
