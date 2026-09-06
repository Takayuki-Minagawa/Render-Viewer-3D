import type { SceneStore } from "../app/scene-store";
import type { SceneSnapshot } from "../model/scene-model";

interface AppearanceOptions { onEnvironmentFile: (file: File | null) => Promise<void>; }
const messages = {
  ja: { title: "ライト・環境", light: "ライト", enabled: "有効", color: "色", intensity: "強度", position: "位置 (m)", target: "照射先 (m)", exposure: "露出", hdr: "ローカルHDR", reset: "標準環境", limits: "Radiance .hdr、32 MiB / 8 MP以下", loading: "環境を読み込み中…", loaded: "環境を更新しました" },
  en: { title: "Lights & environment", light: "Light", enabled: "Enabled", color: "Color", intensity: "Intensity", position: "Position (m)", target: "Target (m)", exposure: "Exposure", hdr: "Local HDR", reset: "Neutral environment", limits: "Radiance .hdr, up to 32 MiB / 8 MP", loading: "Loading environment…", loaded: "Environment updated" },
};
export class AppearanceTools {
  readonly element = document.createElement("details");
  readonly #unsubscribe: () => void;
  #locale: "ja" | "en" = "ja";
  #selectedLight = "";
  #lightSignature = "";
  #busy = false;
  constructor(container: HTMLElement, private readonly store: SceneStore, private readonly options: AppearanceOptions) {
    this.element.className = "appearance-tools";
    this.element.setAttribute("name", "viewport-settings");
    this.element.innerHTML = `<style>.appearance-tools{position:absolute;top:12px;left:12px;z-index:4;max-height:calc(100% - 24px);overflow:auto;width:min(240px,calc(50% - 18px));border:1px solid #475569;border-radius:8px;background:#18202fee;color:#e2e8f0;font:12px/1.5 system-ui}.appearance-tools summary{padding:8px 12px;cursor:pointer;font-weight:600}.appearance-tools .at-body{padding:0 10px 10px;display:grid;gap:8px}.appearance-tools label{display:flex;align-items:center;gap:5px;justify-content:space-between}.appearance-tools input,.appearance-tools select,.appearance-tools button{font:inherit;max-width:100%}.appearance-tools input[type=number]{width:78px}.appearance-tools .at-vector{display:flex;gap:4px;flex-wrap:wrap}.appearance-tools .at-vector input{width:54px}.appearance-tools output{overflow-wrap:anywhere}.appearance-tools [hidden]{display:none}.appearance-tools:not([open]){width:auto}.appearance-tools button,.appearance-tools select{color:#e2e8f0;background:#283449;border:1px solid #52617a;border-radius:4px}.appearance-tools input[type=number]{color:#e2e8f0;background:#111927;border:1px solid #475569;border-radius:4px}</style>
      <summary data-at-label="title"></summary><div class="at-body">
      <label><span data-at-label="exposure"></span><input data-at="exposure" type="number" min="0" max="10" step="0.05" value="1.05"></label>
      <label><span data-at-label="light"></span><select data-at="light"></select></label>
      <label><span data-at-label="enabled"></span><input data-at="enabled" type="checkbox"></label>
      <label><span data-at-label="color"></span><input data-at="color" type="color"></label>
      <label><span data-at-label="intensity"></span><input data-at="intensity" type="number" min="0" max="100" step="0.1"></label>
      <div data-at="vectors">${["position", "target"].map((kind) => `<span data-at-label="${kind}"></span><div class="at-vector">${["x", "y", "z"].map((axis) => `<label>${axis}<input data-at="${kind}-${axis}" type="number" step="0.1"></label>`).join("")}</div>`).join("")}</div>
      <label><span data-at-label="hdr"></span><input data-at="hdr" type="file" accept=".hdr" style="width:140px"></label><small data-at-label="limits"></small><output data-at="environment"></output><button data-at="reset" data-at-label="reset"></button><output data-at="status" role="status"></output></div>`;
    container.append(this.element); this.setLocale("ja");
    this.#get("light").addEventListener("change", () => { this.#selectedLight = this.#get<HTMLSelectElement>("light").value; this.#render(this.store.getSnapshot()); });
    for (const field of ["enabled", "color", "intensity", "position-x", "position-y", "position-z", "target-x", "target-y", "target-z"]) {
      this.#get(field).addEventListener("change", () => {
        const input = this.#get<HTMLInputElement>(field);
        if (field !== "enabled" && field !== "color" && !Number.isFinite(Number(input.value))) return;
        this.store.update((draft) => {
          const light = draft.lights.find(({ id }) => id === this.#selectedLight); if (!light) return;
          if (field === "enabled") light.enabled = input.checked;
          else if (field === "color") light.color = input.value;
          else if (field === "intensity") light.intensity = Math.max(0, Math.min(100, Number(input.value)));
          else if (light.type === "directional") {
            const [kind, axis] = field.split("-") as ["position" | "target", "x" | "y" | "z"];
            light[kind][axis] = Math.max(-1e6, Math.min(1e6, Number(input.value)));
          }
        });
      });
    }
    this.#get("exposure").addEventListener("change", () => { const value = Number(this.#get<HTMLInputElement>("exposure").value); if (Number.isFinite(value)) this.store.update((draft) => { draft.exposure = Math.max(0, Math.min(10, value)); }); });
    this.#get("hdr").addEventListener("change", () => { const input = this.#get<HTMLInputElement>("hdr"); const file = input.files?.[0]; input.value = ""; if (file) void this.#load(file); });
    this.#get("reset").addEventListener("click", () => void this.#load(null));
    this.#unsubscribe = store.subscribe((model) => this.#render(model));
  }
  setLocale(locale: "ja" | "en"): void { this.#locale = locale; const t = messages[locale]; this.element.querySelectorAll<HTMLElement>("[data-at-label]").forEach((node) => { node.textContent = t[node.dataset.atLabel as keyof typeof t]; }); }
  dispose(): void { this.#unsubscribe(); this.element.remove(); }
  #get<T extends HTMLElement = HTMLElement>(id: string): T { return this.element.querySelector<T>(`[data-at="${id}"]`)!; }
  #render(model: SceneSnapshot): void {
    const signature = JSON.stringify(model.lights.map(({ id, name }) => [id, name]));
    if (signature !== this.#lightSignature) {
      this.#lightSignature = signature; const select = this.#get<HTMLSelectElement>("light"); select.replaceChildren();
      for (const light of model.lights) { const option = document.createElement("option"); option.value = light.id; option.textContent = light.name; select.append(option); }
      if (!model.lights.some(({ id }) => id === this.#selectedLight)) this.#selectedLight = model.lights[0]?.id ?? "";
      select.value = this.#selectedLight;
    }
    const setValue = (id: string, value: string | number) => { const input = this.#get<HTMLInputElement>(id); if (document.activeElement !== input) input.value = String(value); };
    setValue("exposure", model.exposure ?? 1.05);
    this.#get("environment").textContent = model.environment?.name ?? "";
    const light = model.lights.find(({ id }) => id === this.#selectedLight);
    for (const id of ["enabled", "color", "intensity"]) this.#get<HTMLInputElement>(id).disabled = !light;
    this.#get("vectors").hidden = light?.type !== "directional";
    if (!light) return;
    this.#get<HTMLInputElement>("enabled").checked = light.enabled; setValue("color", light.color); setValue("intensity", light.intensity);
    if (light.type === "directional") for (const kind of ["position", "target"] as const) for (const axis of ["x", "y", "z"] as const) setValue(`${kind}-${axis}`, light[kind][axis]);
  }
  async #load(file: File | null): Promise<void> {
    if (this.#busy) return; this.#busy = true;
    this.#get<HTMLInputElement>("hdr").disabled = true; this.#get<HTMLButtonElement>("reset").disabled = true;
    this.#get("status").textContent = messages[this.#locale].loading;
    try { await this.options.onEnvironmentFile(file); this.#get("status").textContent = messages[this.#locale].loaded; }
    catch (error) { this.#get("status").textContent = error instanceof Error ? error.message : String(error); }
    finally { this.#busy = false; this.#get<HTMLInputElement>("hdr").disabled = false; this.#get<HTMLButtonElement>("reset").disabled = false; }
  }
}
