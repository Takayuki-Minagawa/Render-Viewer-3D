import { cameraDisplay } from "./camera-display";
import type { EditorState } from "../app/editor-store";
import type { GeometryModel, SceneSnapshot } from "../model/scene-model";
import { translate, type AppLocale, type MessageKey } from "./i18n";
type ImportedModel = SceneSnapshot["imports"][number];
type ImportedNodeModel = ImportedModel["hierarchy"][number];
const GEOMETRY_LABELS: Record<GeometryModel["type"], MessageKey> = {
  box: "primitive.box",
  sphere: "primitive.sphere",
  cylinder: "primitive.cylinder",
  cone: "primitive.cone",
  plane: "primitive.plane",
  torus: "primitive.torus",
};

interface TreeRootControl {
  readonly row: HTMLElement;
  readonly select: HTMLButtonElement;
}

export function createObjectTreeRenderKey(
  objects: SceneSnapshot["objects"],
  imports: SceneSnapshot["imports"],
  locale: AppLocale,
): string {
  return JSON.stringify([
    locale,
    objects.map((object) => [
      object.id,
      object.name,
      object.visible,
      object.geometry.type,
    ]),
    imports.map((imported) => [
      // Asset identity and immutable summaries act as the hierarchy revision;
      // serializing up to 10,000 recursive nodes on every snapshot would defeat the cache.
      imported.assetId,
      imported.id,
      imported.name,
      imported.visible,
      imported.format,
      imported.metadata.objectCount,
      imported.metadata.triangleCount,
      imported.hierarchy.length,
    ]),
  ]);
}

export class SceneTreeView {
  readonly #root: HTMLElement;
  readonly #objectList: HTMLElement;
  readonly #lightList: HTMLElement;
  readonly #cameraItem: HTMLElement;
  readonly #objectCount: HTMLElement;
  readonly #lightCount: HTMLElement;
  readonly #treeRootControls = new Map<string, TreeRootControl>();
  #renderedTreeKey: string | null = null;
  #renderedLightsKey: string | null = null;
  constructor(root: HTMLElement) {
    this.#root = root;
    this.#objectList = this.#query("[data-object-list]");
    this.#lightList = this.#query("[data-light-list]");
    this.#cameraItem = this.#query("[data-camera-item]");
    this.#objectCount = this.#query("[data-object-count]");
    this.#lightCount = this.#query("[data-light-count]");
  }
  render(model: SceneSnapshot, editorState: EditorState, locale: AppLocale): void {
    this.#objectCount.textContent = String(model.objects.length + model.imports.length);
    this.#lightCount.textContent = String(model.lights.length);
    const treeKey = createObjectTreeRenderKey(
      model.objects,
      model.imports,
      locale,
    );
    if (treeKey !== this.#renderedTreeKey) {
      this.#renderObjects(
        model.objects,
        model.imports,
        editorState.selectedObjectId,
        locale,
      );
      this.#renderedTreeKey = treeKey;
    }
    this.#syncObjectTreeSelection(editorState.selectedObjectId);
    const lightKey = JSON.stringify([locale, model.lights]);
    if (lightKey !== this.#renderedLightsKey) {
      this.#renderLights(model.lights, locale);
      this.#renderedLightsKey = lightKey;
    }
    this.#renderCamera(model, locale);

  }
  #renderObjects(
    objects: SceneSnapshot["objects"],
    imports: SceneSnapshot["imports"],
    selectedObjectId: string | null,
    locale: AppLocale,
  ): void {
    const fragment = document.createDocumentFragment();
    this.#treeRootControls.clear();
    if (objects.length === 0 && imports.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = translate(locale, "scene.noObjects");
      fragment.append(empty);
    }
    for (const object of objects) {
      const row = document.createElement("div");
      row.className = "tree-item";
      row.classList.toggle("is-selected", object.id === selectedObjectId);
      row.classList.toggle("is-muted", !object.visible);

      const select = document.createElement("button");
      select.type = "button";
      select.className = "tree-select";
      select.dataset.objectSelect = object.id;
      select.setAttribute("aria-pressed", String(object.id === selectedObjectId));
      select.setAttribute(
        "aria-label",
        `${translate(locale, "scene.selectObject")}: ${object.name}`,
      );
      const icon = document.createElement("span");
      icon.className = `tree-icon ${this.#geometryIcon(object.geometry.type)}`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = object.name;
      const meta = document.createElement("small");
      meta.textContent = translate(locale, GEOMETRY_LABELS[object.geometry.type]);
      copy.append(name, meta);
      select.append(icon, copy);

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-toggle";
      visibility.dataset.objectVisibility = object.id;
      visibility.dataset.visible = String(object.visible);
      visibility.setAttribute("aria-pressed", String(object.visible));
      visibility.setAttribute(
        "aria-label",
        `${translate(
          locale,
          object.visible ? "scene.hideObject" : "scene.showObject",
        )}: ${object.name}`,
      );
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.classList.toggle("is-off", !object.visible);
      visibility.append(dot);
      row.append(select, visibility);
      this.#treeRootControls.set(object.id, { row, select });
      fragment.append(row);
    }
    for (const imported of imports) {
      const row = document.createElement("div");
      row.className = "tree-item tree-import-root";
      row.classList.toggle("is-selected", imported.id === selectedObjectId);
      row.classList.toggle("is-muted", !imported.visible);

      const select = document.createElement("button");
      select.type = "button";
      select.className = "tree-select";
      select.dataset.objectSelect = imported.id;
      select.setAttribute("aria-pressed", String(imported.id === selectedObjectId));
      select.setAttribute(
        "aria-label",
        `${translate(locale, "scene.selectObject")}: ${imported.name}`,
      );
      const icon = document.createElement("span");
      icon.className = "tree-icon imported-root-icon";
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = imported.name;
      const meta = document.createElement("small");
      meta.textContent = `${imported.format} · ${imported.metadata.triangleCount.toLocaleString(
        locale === "ja" ? "ja-JP" : "en-US",
      )} ${translate(locale, "import.triangles")}`;
      copy.append(name, meta);
      select.append(icon, copy);

      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-toggle";
      visibility.dataset.objectVisibility = imported.id;
      visibility.dataset.visible = String(imported.visible);
      visibility.setAttribute("aria-pressed", String(imported.visible));
      visibility.setAttribute(
        "aria-label",
        `${translate(
          locale,
          imported.visible ? "scene.hideObject" : "scene.showObject",
        )}: ${imported.name}`,
      );
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.classList.toggle("is-off", !imported.visible);
      visibility.append(dot);
      row.append(select, visibility);
      this.#treeRootControls.set(imported.id, { row, select });
      fragment.append(row);
      this.#appendImportedNodes(
        fragment,
        imported,
        imported.hierarchy,
        1,
        locale,
      );
    }
    this.#objectList.replaceChildren(fragment);
  }

  #syncObjectTreeSelection(selectedObjectId: string | null): void {
    for (const [id, control] of this.#treeRootControls) {
      const selected = id === selectedObjectId;
      control.row.classList.toggle("is-selected", selected);
      control.select.setAttribute("aria-pressed", String(selected));
    }
  }

  #appendImportedNodes(
    fragment: DocumentFragment,
    imported: ImportedModel,
    nodes: readonly ImportedNodeModel[],
    depth: number,
    locale: AppLocale,
  ): void {
    for (const node of nodes) {
      const row = document.createElement("div");
      row.className = "tree-item tree-import-node";
      row.classList.toggle("is-muted", !imported.visible);
      row.style.setProperty("--tree-depth", String(depth));
      const select = document.createElement("button");
      select.type = "button";
      select.className = "tree-select";
      select.dataset.objectSelect = imported.id;
      select.dataset.importedNodeSelect = node.id;
      select.setAttribute(
        "aria-label",
        `${translate(locale, "scene.selectObject")}: ${imported.name} / ${node.name}`,
      );
      const icon = document.createElement("span");
      icon.className = `tree-icon imported-node-icon${node.mesh ? " is-mesh" : ""}`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = node.name;
      const meta = document.createElement("small");
      meta.textContent = node.mesh
        ? `${node.objectType} · ${node.triangleCount.toLocaleString(
            locale === "ja" ? "ja-JP" : "en-US",
          )} ${translate(locale, "import.triangles")}`
        : node.objectType;
      copy.append(name, meta);
      select.append(icon, copy);
      row.append(select);
      fragment.append(row);
      this.#appendImportedNodes(fragment, imported, node.children, depth + 1, locale);
    }
  }

  #renderLights(lights: SceneSnapshot["lights"], locale: AppLocale): void {
    const fragment = document.createDocumentFragment();
    for (const light of lights) {
      const row = document.createElement("div");
      row.className = "tree-item tree-item-static";
      row.classList.toggle("is-muted", !light.enabled);
      const icon = document.createElement("span");
      icon.className = `tree-icon light-icon${
        light.type === "directional" ? " is-key" : ""
      }`;
      icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = light.name;
      const meta = document.createElement("small");
      meta.textContent = translate(
        locale,
        light.type === "ambient" ? "scene.ambientMeta" : "scene.directionalMeta",
      );
      copy.append(name, meta);
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.classList.toggle("is-off", !light.enabled);
      dot.setAttribute(
        "aria-label",
        translate(locale, light.enabled ? "scene.enabled" : "scene.disabled"),
      );
      row.append(icon, copy, dot);
      fragment.append(row);
    }
    this.#lightList.replaceChildren(fragment);
  }

  #renderCamera(model: SceneSnapshot, locale: AppLocale): void {
    const name = this.#cameraItem.querySelector("strong");
    const meta = this.#cameraItem.querySelector("small");
    const display = cameraDisplay(model.camera, locale);
    if (name) name.textContent = display.label;
    if (meta) {
      meta.textContent = `${display.scale} · ${this.#formatVector(
        model.camera.position,
      )}`;
    }
  }

  #geometryIcon(type: GeometryModel["type"]): string {
    const icons: Record<GeometryModel["type"], string> = {
      box: "cube-icon",
      sphere: "sphere-icon",
      cylinder: "cylinder-icon",
      cone: "cone-icon",
      plane: "plane-icon",
      torus: "torus-icon",
    };
    return icons[type];
  }

  #formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "0";
    return String(Number(value.toFixed(4)));
  }

  #formatVector(vector: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }): string {
    return `${this.#formatNumber(vector.x)}, ${this.#formatNumber(
      vector.y,
    )}, ${this.#formatNumber(vector.z)}`;
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required tree element not found: ${selector}`);
    return element;
  }
}
