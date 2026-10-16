export interface NumberInputCommit {
  readonly kind: "accepted" | "corrected" | "reverted";
  readonly value: number | undefined;
}

interface NumberInputOptions {
  read: () => number | undefined;
  write: (value: number) => void;
  onCommit: (result: NumberInputCommit) => void;
  signal: AbortSignal;
}

/** Keep in-progress text intact, then show the authoritative model value on commit. */
export function bindCommittedNumberInput(input: HTMLInputElement, options: NumberInputOptions): { sync: () => void } {
  let editing = false;
  let composing = false;
  let pendingCommit = false;
  const sync = (force = false) => {
    if (composing || (!force && editing && document.activeElement === input)) return;
    const value = options.read();
    input.value = value === undefined ? "" : String(value);
    editing = false;
  };
  const commit = () => {
    if (composing) { pendingCommit = true; return; }
    if (input.disabled) { sync(true); return; }
    // valueAsNumber returns NaN for empty and invalid native number input text.
    const requested = input.valueAsNumber;
    const valid = input.value.trim() !== "" && Number.isFinite(requested);
    editing = false;
    if (valid) options.write(requested);
    const value = options.read();
    sync(true); // A clamped no-op does not notify store subscribers.
    options.onCommit({ kind: !valid ? "reverted" : value !== requested ? "corrected" : "accepted", value });
  };
  const listenerOptions = { signal: options.signal };
  input.addEventListener("input", () => { editing = true; }, listenerOptions);
  input.addEventListener("compositionstart", () => { composing = true; editing = true; }, listenerOptions);
  input.addEventListener("compositionend", () => {
    composing = false;
    if (pendingCommit) { pendingCommit = false; commit(); }
  }, listenerOptions);
  input.addEventListener("change", commit, listenerOptions);
  input.addEventListener("blur", () => {
    // A normal change precedes blur; preserve its correction message.
    if (editing || input.valueAsNumber !== options.read()) commit();
    else sync(true);
  }, listenerOptions);
  return { sync };
}

export function numberInputCommitMessage(result: NumberInputCommit, locale: "ja" | "en"): string {
  if (result.kind === "accepted") return "";
  const value = result.value === undefined ? "—" : String(result.value);
  if (locale === "ja") return result.kind === "corrected"
    ? `入力値を ${value} に補正しました。`
    : `有効な数値を入力してください。${value} に戻しました。`;
  return result.kind === "corrected"
    ? `Value adjusted to ${value}.`
    : `Enter a valid number. Restored ${value}.`;
}
