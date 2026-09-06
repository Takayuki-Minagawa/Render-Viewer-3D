import type { SceneSnapshot } from '../model/scene-model';
import type { ImportedSceneSnapshot } from '../model/imported-scene-model';

export interface ImportedNodeToolsActions {
  selectObject: (id: string) => void;
  visibility: (importId: string, nodeId: string, visible: boolean | null) => void;
  material: (importId: string, nodeId: string, materialId: string | null) => void;
  isolate: (importId: string, nodeId: string | null) => void;
  reset: (importId: string) => void;
}

/** Keeps part selection outside the saved root selection; edits themselves go through the store/history. */
export class ImportedNodeTools {
  readonly element: HTMLDetailsElement;
  readonly #abort = new AbortController();
  #scene: SceneSnapshot | undefined;
  #importId: string | null = null;
  #nodeId: string | null = null;
  #locale: 'ja' | 'en' = 'ja';
  #optionsKey = '';
  constructor(container: HTMLElement, readonly actions: ImportedNodeToolsActions) {
    this.element = document.createElement('details');
    this.element.className = 'imported-node-tools';
    this.element.open = true;
    this.element.hidden = true;
    this.element.innerHTML = `<summary data-node-label="title"></summary><div class="imported-node-body">
      <label><span data-node-label="part"></span><select data-node-tool="node"></select></label>
      <label><span data-node-label="visibility"></span><select data-node-tool="visible"><option value="" data-node-label="originalVisibility"></option><option value="true" data-node-label="visible"></option><option value="false" data-node-label="hidden"></option></select></label>
      <label><span data-node-label="material"></span><select data-node-tool="material"></select></label>
      <div><button type="button" data-node-tool="isolate" data-node-label="isolate"></button><button type="button" data-node-tool="show-all" data-node-label="showAll"></button><button type="button" data-node-tool="reset" data-node-label="reset"></button></div>
      <small data-node-label="note"></small></div>`;
    const style = document.createElement('style');
    style.textContent = `.imported-node-tools{padding:8px 12px;border-top:1px solid var(--border-color,#42516a);font-size:12px}.imported-node-tools[hidden]{display:none}.imported-node-tools summary{cursor:pointer;font-weight:600}.imported-node-body{display:grid;gap:8px;padding-top:8px}.imported-node-body label{display:flex;gap:6px;align-items:center}.imported-node-body select{min-width:0;max-width:100%;flex:1}.imported-node-body button{padding:5px;margin:2px;font:inherit}.imported-node-body small{opacity:.8}.tree-import-node.is-node-selected{background:rgba(80,160,255,.18);outline:1px solid #549ff2}`;
    this.element.append(style);
    container.append(this.element);
    const options = { signal: this.#abort.signal };
    this.#control<HTMLSelectElement>('node').addEventListener('change', event => {
      this.#nodeId = (event.target as HTMLSelectElement).value || null;
      this.#sync();
    }, options);
    this.#control<HTMLSelectElement>('visible').addEventListener('change', event => {
      const value = (event.target as HTMLSelectElement).value;
      if (this.#importId && this.#nodeId) actions.visibility(this.#importId, this.#nodeId, value === '' ? null : value === 'true');
    }, options);
    this.#control<HTMLSelectElement>('material').addEventListener('change', event => {
      if (this.#importId && this.#nodeId) actions.material(this.#importId, this.#nodeId, (event.target as HTMLSelectElement).value || null);
    }, options);
    this.#control('isolate').addEventListener('click', () => {
      if (this.#importId && this.#nodeId) actions.isolate(this.#importId, this.#nodeId);
    }, options);
    this.#control('show-all').addEventListener('click', () => {
      if (this.#importId) actions.isolate(this.#importId, null);
    }, options);
    this.#control('reset').addEventListener('click', () => {
      if (this.#importId) actions.reset(this.#importId);
    }, options);
  }

  update(scene: SceneSnapshot, selectedRootId: string | null, locale: 'ja' | 'en' = this.#locale): void {
    this.#scene = scene;
    if (this.#importId !== selectedRootId) this.#nodeId = null;
    this.#importId = selectedRootId;
    this.#locale = locale;
    this.#sync();
  }

  /** Called by tree and raycast callbacks, after selecting the imported root. */
  selectNode = (importId: string, nodeId: string): void => {
    if (this.#importId !== importId) this.actions.selectObject(importId);
    this.#importId = importId;
    this.#nodeId = nodeId;
    this.#sync();
  };

  get selectedNodeId(): string | null { return this.#nodeId; }
  dispose(): void { this.#abort.abort(); this.element.remove(); }

  #sync(): void {
    const model = this.#scene?.imports.find(item => item.id === this.#importId);
    this.element.hidden = !model || model.hierarchy.length === 0;
    if (!model) { this.#highlight(); return; }
    const nodes = flattenNodes(model);
    if (!nodes.some(node => node.id === this.#nodeId)) this.#nodeId = nodes[0]?.id ?? null;
    const text = labels[this.#locale];
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-node-label]')) node.textContent = text[node.dataset.nodeLabel as keyof typeof text];
    const optionsKey = JSON.stringify([this.#locale, model.id, nodes, this.#scene?.materials.map(material => [material.id, material.name])]);
    if (this.#optionsKey !== optionsKey) {
      this.#optionsKey = optionsKey;
      this.#control<HTMLSelectElement>('node').replaceChildren(...nodes.map(node => option(node.id, `${'　'.repeat(node.depth)}${node.name}`)));
      this.#control<HTMLSelectElement>('material').replaceChildren(option('', text.inherit), ...(this.#scene?.materials ?? []).map(material => option(material.id, material.name)));
    }
    const override = this.#nodeId ? model.nodeOverrides?.[this.#nodeId] : undefined;
    this.#control<HTMLSelectElement>('node').value = this.#nodeId ?? '';
    this.#control<HTMLSelectElement>('visible').value = override?.visible === undefined ? '' : String(override.visible);
    this.#control<HTMLSelectElement>('material').value = override?.materialId ?? '';
    this.#control<HTMLButtonElement>('isolate').disabled = !this.#nodeId || model.isolatedNodeId === this.#nodeId;
    this.#control<HTMLButtonElement>('show-all').disabled = !model.isolatedNodeId;
    this.#control<HTMLButtonElement>('reset').disabled = !model.isolatedNodeId && !Object.keys(model.nodeOverrides ?? {}).length;
    this.#highlight();
  }

  #highlight(): void {
    const root = this.element.closest('.app-shell') ?? this.element.parentElement;
    for (const button of root?.querySelectorAll<HTMLElement>('[data-imported-node-select]') ?? []) {
      const active = button.dataset.objectSelect === this.#importId && button.dataset.importedNodeSelect === this.#nodeId;
      button.closest('.tree-import-node')?.classList.toggle('is-node-selected', active);
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    }
  }

  #control<T extends HTMLElement = HTMLElement>(id: string): T { return this.element.querySelector<T>(`[data-node-tool="${id}"]`)!; }
}

function flattenNodes(model: ImportedSceneSnapshot): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  const pending = [...model.hierarchy].reverse().map(node => ({ node, depth: 0 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    result.push({ id: node.id, name: node.name, depth });
    pending.push(...[...node.children].reverse().map(child => ({ node: child, depth: depth + 1 })));
  }
  return result;
}
function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement('option'); element.value = value; element.textContent = text; return element;
}
const labels = {
  ja: { title: '読み込みモデルの部品', visibility: '表示指定', originalVisibility: '元の表示状態', hidden: '非表示', part: '部品', visible: '表示', material: '材質', inherit: '親／モデルの材質を継承', isolate: 'この部品を隔離', showAll: '隔離を解除', reset: '部品の変更をリセット', note: '一覧・3Dビューで部品を選択できます。材質は子部品にも適用されます。非表示指定は隔離中も維持されます。' },
  en: { title: 'Imported model parts', visibility: 'Visibility', originalVisibility: 'Original visibility', hidden: 'Hidden', part: 'Part', visible: 'Visible', material: 'Material', inherit: 'Inherit parent / model material', isolate: 'Isolate part', showAll: 'Exit isolation', reset: 'Reset part overrides', note: 'Select a part in the tree or viewport. Material overrides include descendants. Hidden parts stay hidden during isolation.' },
};
