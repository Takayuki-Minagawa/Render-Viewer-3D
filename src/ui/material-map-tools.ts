import type { SceneSnapshot } from "../model/scene-model";
import type { MaterialColorMapField, MaterialPbrMapChannel } from "../model/material/material-model";
import { MATERIAL_PBR_CHANNELS } from "../model/material/material-pbr-map";
import { MATERIAL_TEXTURE_FILE_ACCEPT } from "../model/material/material-color-map";
import type { SceneStore } from "../app/scene-store";
import type { MaterialPbrMapController } from "../app/material-pbr-map-controller";

const text = {
  ja: { title: "PBR画像", material: "マテリアル", channel: "画像の種類", normal: "法線 (RGB)", roughness: "粗さ (G)", metalness: "金属度 (B)", ao: "遮蔽 (R)", attach: "画像を選択", remove: "画像を解除", none: "画像なし", busy: "読み込み中…", done: "画像を設定しました", note: "PNG/JPEG/WebP。数値データとして読み込みます。UVがない面では画像を適用しません。粗さ・金属度画像は材質の値に乗算されます。", repeatX: "反復 X", repeatY: "反復 Y", offsetX: "オフセット X", offsetY: "オフセット Y", rotationDegrees: "回転 (°)", wrapMode: "境界", repeat: "反復", "clamp-to-edge": "端で固定", "mirrored-repeat": "鏡面反復" },
  en: { title: "PBR images", material: "Material", channel: "Image channel", normal: "Normal (RGB)", roughness: "Roughness (G)", metalness: "Metalness (B)", ao: "Occlusion (R)", attach: "Choose image", remove: "Remove image", none: "No image", busy: "Loading…", done: "Image attached", note: "PNG/JPEG/WebP, loaded as numeric data. Images are omitted on surfaces without UVs. Roughness and metalness maps multiply material values.", repeatX: "Repeat X", repeatY: "Repeat Y", offsetX: "Offset X", offsetY: "Offset Y", rotationDegrees: "Rotation (°)", wrapMode: "Wrap", repeat: "Repeat", "clamp-to-edge": "Clamp to edge", "mirrored-repeat": "Mirrored repeat" },
};
export class MaterialMapTools {
  readonly element = document.createElement("details");
  readonly #abort = new AbortController();
  readonly #unsubscribe: () => void;
  #model: SceneSnapshot;
  #locale: "ja" | "en" = "ja";
  #listSignature = "";
  #busy = 0;
  constructor(parent: HTMLElement, store: SceneStore, private readonly controller: MaterialPbrMapController, private readonly runAsync: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation()) {
    this.#model = store.getSnapshot();
    this.element.className = "material-map-tools";
    this.element.style.cssText = "font-size:12px;padding:8px;border-top:1px solid var(--border-color,#465066)";
    this.element.innerHTML = `<summary data-pbr-label="title"></summary><div style="display:grid;gap:6px;padding-top:8px"><label><span data-pbr-label="material"></span><select data-pbr="material" style="width:100%"></select></label><label><span data-pbr-label="channel"></span><select data-pbr="channel" style="width:100%">${MATERIAL_PBR_CHANNELS.map((channel) => `<option value="${channel}" data-pbr-label="${channel}"></option>`).join("")}</select></label><div><button type="button" data-pbr="attach" data-pbr-label="attach"></button><button type="button" data-pbr="remove" data-pbr-label="remove"></button><input type="file" hidden data-pbr="file"></div><output data-pbr="source"></output><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">${["repeatX", "repeatY", "offsetX", "offsetY", "rotationDegrees"].map((field) => `<label><span data-pbr-label="${field}"></span><input data-pbr="${field}" type="number" step="${field === "rotationDegrees" ? "1" : "0.1"}" style="width:100%"></label>`).join("")}<label><span data-pbr-label="wrapMode"></span><select data-pbr="wrapMode">${["repeat", "clamp-to-edge", "mirrored-repeat"].map((mode) => `<option value="${mode}" data-pbr-label="${mode}"></option>`).join("")}</select></label></div><small data-pbr-label="note"></small><output role="status" data-pbr="status"></output></div>`;
    parent.append(this.element);
    this.#get<HTMLInputElement>("file").accept = MATERIAL_TEXTURE_FILE_ACCEPT;
    this.element.addEventListener("change", (event) => this.#change(event), { signal: this.#abort.signal });
    this.#get("attach").addEventListener("click", () => this.#get<HTMLInputElement>("file").click(), { signal: this.#abort.signal });
    this.#get("remove").addEventListener("click", () => controller.remove(this.#materialId(), this.#channel()), { signal: this.#abort.signal });
    this.#unsubscribe = store.subscribe((model) => { this.#model = model; this.#render(); });
    this.setLocale("ja");
  }
  setLocale(locale: "ja" | "en"): void {
    this.#locale = locale;
    this.element.querySelectorAll<HTMLElement>("[data-pbr-label]").forEach((element) => { element.textContent = text[locale][element.dataset.pbrLabel as keyof typeof text.en]; });
    this.#render();
  }
  dispose(): void { this.#abort.abort(); this.#unsubscribe(); this.element.remove(); }
  #get<T extends HTMLElement = HTMLElement>(name: string): T { return this.element.querySelector<T>(`[data-pbr="${name}"]`)!; }
  #materialId(): string { return this.#get<HTMLSelectElement>("material").value; }
  #channel(): MaterialPbrMapChannel { return this.#get<HTMLSelectElement>("channel").value as MaterialPbrMapChannel; }
  #render(): void {
    const signature = JSON.stringify(this.#model.materials.map(({ id, name }) => [id, name]));
    if (signature !== this.#listSignature) {
      this.#listSignature = signature;
      const select = this.#get<HTMLSelectElement>("material"), previous = select.value;
      select.replaceChildren(...this.#model.materials.map((material) => { const option = document.createElement("option"); option.value = material.id; option.textContent = material.name; return option; }));
      if (this.#model.materials.some(({ id }) => id === previous)) select.value = previous;
    }
    const descriptor = this.#model.materials.find(({ id }) => id === this.#materialId())?.maps?.[this.#channel()];
    this.#get("source").textContent = descriptor ? `${descriptor.sourceName} · ${descriptor.width} × ${descriptor.height}` : text[this.#locale].none;
    this.#get<HTMLButtonElement>("attach").disabled = !this.#materialId() || this.#busy > 0;
    this.#get<HTMLButtonElement>("remove").disabled = !descriptor;
    for (const field of ["repeatX", "repeatY", "offsetX", "offsetY", "rotationDegrees", "wrapMode"] as MaterialColorMapField[]) {
      const input = this.#get<HTMLInputElement | HTMLSelectElement>(field);
      input.disabled = !descriptor;
      if (document.activeElement !== input) input.value = descriptor ? String(descriptor[field]) : field === "wrapMode" ? "repeat" : "";
    }
  }
  #change(event: Event): void {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.pbr;
    if (key === "material" || key === "channel") { this.#render(); return; }
    if (key === "file") {
      const file = input.files?.[0]; input.value = "";
      if (!file) return;
      const materialId = this.#materialId(), channel = this.#channel();
      this.#busy++; this.#get("status").textContent = text[this.#locale].busy; this.#render();
      void this.runAsync(() => this.controller.attach(materialId, channel, file)).then(() => { this.#get("status").textContent = text[this.#locale].done; }).catch((error) => { this.#get("status").textContent = error instanceof Error ? error.message : String(error); }).finally(() => { this.#busy--; this.#render(); });
      return;
    }
    if (["repeatX", "repeatY", "offsetX", "offsetY", "rotationDegrees", "wrapMode"].includes(key ?? "")) this.controller.update(this.#materialId(), this.#channel(), key as MaterialColorMapField, key === "wrapMode" ? input.value : Number(input.value));
  }
}
