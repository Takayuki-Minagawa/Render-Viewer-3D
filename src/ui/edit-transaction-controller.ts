/** Groups a field editing session into one history entry without intercepting native text undo. */
export interface EditTransactionActions {
  beginEdit?: () => void;
  endEdit?: () => void;
  cancelEdit?: () => void;
}

const EDIT_FIELD = [
  '[data-object-name-input]', '[data-transform-group]', '[data-geometry-key]',
  '[data-rename-material]', '[data-material-preview-field]', '[data-material-pov-path]',
  '[data-material-color-map-field]', '[data-import-material-mode]', '[data-import-material-select]',
].join(',');

export function bindEditTransactions(
  root: HTMLElement,
  actions: EditTransactionActions,
  signal: AbortSignal,
): void {
  let active: HTMLInputElement | HTMLSelectElement | null = null;
  const field = (target: EventTarget | null) =>
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement
      ? target.matches(EDIT_FIELD) ? target : null
      : null;
  const finish = () => {
    if (!active) return;
    active = null;
    actions.endEdit?.();
  };
  const begin = (event: Event) => {
    const next = field(event.target);
    if (!next || active === next) return;
    finish();
    active = next;
    actions.beginEdit?.();
  };
  const options = { signal };
  // Capture input before the shell mutates state, including inputs without focus
  // (native color chooser and programmatic accessibility interactions).
  root.addEventListener('input', begin, { signal, capture: true });
  root.addEventListener('focusin', begin, options);
  root.addEventListener('pointerdown', begin, options);
  root.addEventListener('focusout', event => {
    if (event.target === active) finish();
  }, options);
  root.addEventListener('change', event => {
    const target = field(event.target);
    if (target === active && (target instanceof HTMLSelectElement ||
      ['range', 'color', 'checkbox', 'radio'].includes(target?.type ?? ''))) finish();
  }, options);
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    event.stopPropagation();
    const target = active;
    active = null;
    target.blur();
    actions.cancelEdit?.();
  }, options);
  signal.addEventListener('abort', finish, { once: true });
}
