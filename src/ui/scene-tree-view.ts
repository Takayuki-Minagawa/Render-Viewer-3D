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

interface TreeRowControl {
  readonly row: HTMLElement;
  readonly select: HTMLButtonElement;
  readonly icon: HTMLElement;
  readonly name: HTMLElement;
  readonly meta: HTMLElement;
}

interface TreeRootControl extends TreeRowControl {
  readonly visibility: HTMLButtonElement;
  readonly dot: HTMLElement;
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
  readonly #treeNodeControls = new Map<string, TreeRowControl>();
  readonly #empty = document.createElement("p");
  #renderedTreeKey: string | null = null;
  #renderedLightsKey: string | null = null;
  constructor(root: HTMLElement) {
    this.#root = root;
    this.#objectList = this.#query("[data-object-list]");
    this.#lightList = this.#query("[data-light-list]");
    this.#cameraItem = this.#query("[data-camera-item]");
    this.#objectCount = this.#query("[data-object-count]");
    this.#lightCount = this.#query("[data-light-count]");
    this.#empty.className = "tree-empty";
    this.#empty.tabIndex = -1;
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
    locale: AppLocale,
  ): void {
    const rows: HTMLElement[] = [];
    const rootIds = new Set<string>();
    const nodeIds = new Set<string>();
    for (const object of objects) {
      const control = this.#rootControl(object.id);
      this.#updateRoot(control, object, locale);
      control.row.classList.remove("tree-import-root");
      control.icon.className = `tree-icon ${this.#geometryIcon(object.geometry.type)}`;
      control.meta.textContent = translate(locale, GEOMETRY_LABELS[object.geometry.type]);
      rootIds.add(object.id);
      rows.push(control.row);
    }
    for (const imported of imports) {
      const control = this.#rootControl(imported.id);
      this.#updateRoot(control, imported, locale);
      control.row.classList.add("tree-import-root");
      control.icon.className = "tree-icon imported-root-icon";
      control.meta.textContent = `${imported.format} · ${imported.metadata.triangleCount.toLocaleString(
        locale === "ja" ? "ja-JP" : "en-US",
      )} ${translate(locale, "import.triangles")}`;
      rootIds.add(imported.id);
      rows.push(control.row);
      this.#appendImportedNodes(
        rows,
        nodeIds,
        imported,
        imported.hierarchy,
        1,
        locale,
      );
    }
    for (const id of this.#treeRootControls.keys()) {
      if (!rootIds.has(id)) this.#treeRootControls.delete(id);
    }
    for (const id of this.#treeNodeControls.keys()) {
      if (!nodeIds.has(id)) this.#treeNodeControls.delete(id);
    }
    if (!rows.length) {
      this.#empty.textContent = translate(locale, "scene.noObjects");
      rows.push(this.#empty);
    }
    this.#reconcileRows(rows);
  }

  #createRow(id: string): TreeRowControl {
    const row = document.createElement("div");
    row.className = "tree-item";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "tree-select";
    select.dataset.objectSelect = id;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    const meta = document.createElement("small");
    copy.append(name, meta);
    select.append(icon, copy);
    row.append(select);
    return { row, select, icon, name, meta };
  }

  #rootControl(id: string): TreeRootControl {
    let control = this.#treeRootControls.get(id);
    if (!control) {
      const base = this.#createRow(id);
      const visibility = document.createElement("button");
      visibility.type = "button";
      visibility.className = "visibility-toggle";
      visibility.dataset.objectVisibility = id;
      const dot = document.createElement("span");
      dot.className = "state-dot";
      visibility.append(dot);
      base.row.append(visibility);
      control = { ...base, visibility, dot };
      this.#treeRootControls.set(id, control);
    }
    return control;
  }

  #updateRoot(
    control: TreeRootControl,
    object: { readonly name: string; readonly visible: boolean },
    locale: AppLocale,
  ): void {
    control.row.classList.toggle("is-muted", !object.visible);
    control.name.textContent = object.name;
    control.select.setAttribute(
      "aria-label",
      `${translate(locale, "scene.selectObject")}: ${object.name}`,
    );
    control.visibility.dataset.visible = String(object.visible);
    control.visibility.setAttribute("aria-pressed", String(object.visible));
    control.visibility.setAttribute(
      "aria-label",
      `${translate(locale, object.visible ? "scene.hideObject" : "scene.showObject")}: ${object.name}`,
    );
    control.dot.classList.toggle("is-off", !object.visible);
  }

  #reconcileRows(rows: readonly HTMLElement[]): void {
    const previous = Array.from(this.#objectList.children);
    const active = this.#objectList.ownerDocument.activeElement as HTMLElement | null;
    const activeIndex = active ? previous.findIndex((row) => row.contains(active)) : -1;
    const retained = new Set<Element>(rows);
    // Capture a surviving neighbor before removal. Focus outside this list is never moved.
    const removedFocus = activeIndex >= 0 && !retained.has(previous[activeIndex]);
    const neighbor = removedFocus
      ? previous.slice(activeIndex + 1).find((row) => retained.has(row))
        ?? previous.slice(0, activeIndex).reverse().find((row) => retained.has(row))
        ?? rows[0]
      : null;
    for (const row of previous) {
      if (!retained.has(row)) row.remove();
    }
    rows.forEach((row, index) => {
      // Moving connected rows through a fragment would blur their focused buttons.
      if (this.#objectList.children[index] !== row) {
        this.#objectList.insertBefore(row, this.#objectList.children[index] ?? null);
      }
    });
    if (neighbor) {
      const sameControl = active?.hasAttribute("data-object-visibility")
        ? neighbor.querySelector<HTMLButtonElement>("[data-object-visibility]")
        : null;
      (sameControl ?? neighbor.querySelector<HTMLButtonElement>("button") ?? this.#empty).focus();
    } else if (activeIndex >= 0 && active && this.#objectList.contains(active)
      && this.#objectList.ownerDocument.activeElement !== active) {
      // A real order change may move the focused row; retain its control identity.
      active.focus();
    }
  }

  #syncObjectTreeSelection(selectedObjectId: string | null): void {
    for (const [id, control] of this.#treeRootControls) {
      const selected = id === selectedObjectId;
      control.row.classList.toggle("is-selected", selected);
      control.select.setAttribute("aria-pressed", String(selected));
    }
  }

  #appendImportedNodes(
    rows: HTMLElement[],
    nodeIds: Set<string>,
    imported: ImportedModel,
    nodes: readonly ImportedNodeModel[],
    depth: number,
    locale: AppLocale,
  ): void {
    for (const node of nodes) {
      const key = JSON.stringify([imported.id, node.id]);
      nodeIds.add(key);
      let control = this.#treeNodeControls.get(key);
      if (!control) {
        control = this.#createRow(imported.id);
        control.row.classList.add("tree-import-node");
        control.select.dataset.importedNodeSelect = node.id;
        this.#treeNodeControls.set(key, control);
      }
      control.row.classList.toggle("is-muted", !imported.visible);
      control.row.style.setProperty("--tree-depth", String(depth));
      control.select.setAttribute(
        "aria-label",
        `${translate(locale, "scene.selectObject")}: ${imported.name} / ${node.name}`,
      );
      control.icon.className = `tree-icon imported-node-icon${node.mesh ? " is-mesh" : ""}`;
      control.name.textContent = node.name;
      control.meta.textContent = node.mesh
        ? `${node.objectType} · ${node.triangleCount.toLocaleString(
            locale === "ja" ? "ja-JP" : "en-US",
          )} ${translate(locale, "import.triangles")}`
        : node.objectType;
      rows.push(control.row);
      this.#appendImportedNodes(rows, nodeIds, imported, node.children, depth + 1, locale);
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
