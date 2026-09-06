import type { MaterialSnapshot } from './material-capability-ui';
import { CATEGORY_LABELS, SUPPORT_LABELS, SUPPORT_DESCRIPTIONS } from './material-capability-ui';
import type { MaterialLibraryItem } from './material-library-state';
import { translate, type AppLocale } from './i18n';

export interface MaterialListViewItem extends MaterialLibraryItem {
  readonly material: MaterialSnapshot;
  readonly usageCount: number;
}

/** Reconciles rows by material ID so camera movement and selection preserve DOM/focus. */
export class MaterialListView {
  readonly #rows = new Map<string, { button: HTMLButtonElement; key: string }>();
  constructor(readonly list: HTMLElement, readonly count: HTMLElement) {}

  render(items: readonly MaterialListViewItem[], total: number, selectedId: string | null, locale: AppLocale): void {
    const count = `${items.length} / ${total}`;
    if (this.count.textContent !== count) this.count.textContent = count;
    const ids = new Set(items.map(item => item.id));
    for (const [id, row] of this.#rows) {
      if (!ids.has(id)) { row.button.remove(); this.#rows.delete(id); }
    }
    if (!items.length) {
      const key = `empty:${locale}`;
      if (this.list.dataset.renderKey !== key) {
        const empty = document.createElement('div');
        empty.className = 'material-list-empty';
        const title = document.createElement('strong');
        title.textContent = translate(locale, 'material.noResultsTitle');
        const body = document.createElement('p');
        body.textContent = translate(locale, 'material.noResultsBody');
        empty.append(title, body);
        this.list.replaceChildren(empty);
        this.list.dataset.renderKey = key;
      }
      return;
    }
    if (this.list.dataset.renderKey?.startsWith('empty:')) this.list.replaceChildren();
    this.list.dataset.renderKey = 'rows';
    items.forEach((item, index) => {
      const key = JSON.stringify([locale, item.name, item.category, item.usageCount, item.support, item.material.preview.baseColor]);
      let row = this.#rows.get(item.id);
      if (!row) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'material-list-item';
        button.dataset.materialSelect = item.id;
        row = { button, key: '' };
        this.#rows.set(item.id, row);
      }
      if (row.key !== key) {
        const swatch = document.createElement('span');
        swatch.className = 'material-swatch';
        swatch.setAttribute('aria-hidden', 'true');
        const fill = document.createElement('i');
        fill.style.backgroundColor = item.material.preview.baseColor;
        swatch.append(fill);
        const copy = document.createElement('span');
        copy.className = 'material-list-copy';
        const title = document.createElement('strong');
        title.textContent = item.name;
        const meta = document.createElement('small');
        const label = CATEGORY_LABELS[item.category.toLocaleLowerCase()];
        meta.textContent = `${label ? translate(locale, label) : item.category} · ${translate(locale, 'material.usedBy')} ${item.usageCount}`;
        copy.append(title, meta);
        const badge = document.createElement('span');
        badge.className = `material-support-badge is-${item.support}`;
        badge.textContent = translate(locale, SUPPORT_LABELS[item.support]);
        badge.title = translate(locale, SUPPORT_DESCRIPTIONS[item.support]);
        row.button.replaceChildren(swatch, copy, badge);
        row.key = key;
      }
      const selected = String(item.id === selectedId);
      if (row.button.getAttribute('aria-current') !== selected) row.button.setAttribute('aria-current', selected);
      // Avoid moving nodes already in place: moving a focused button can blur it.
      if (this.list.children[index] !== row.button) this.list.insertBefore(row.button, this.list.children[index] ?? null);
    });
  }
}
