import type { PngExportOptions } from "../three/png-export";

export interface ViewportToolsActions {
  png: (helpers: boolean, options?: Partial<Omit<PngExportOptions, "includeHelpers">>) => Promise<void>;
  glb: () => Promise<void>;
  projection: (value: "perspective" | "orthographic") => void;
  view: (value: "front" | "back" | "left" | "right" | "top" | "bottom" | "isometric") => void;
  fit: () => void;
  clipping: (axis: "off" | "x" | "y" | "z", offset: number, reverse: boolean, cap?: boolean, color?: string) => void;
  measure: (enabled: boolean) => void;
  clearMeasurement: () => void;
  clip: (index: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  speed: (speed: number) => void;
  quality: (ratio: number, shadows: boolean) => void;
}
const labels = {
  ja: { title: "ビュー・出力", png: "PNG保存", glb: "GLB保存", helpers: "PNGに補助線を含める", perspective: "透視投影", orthographic: "正投影", front: "正面", back: "背面", left: "左面", right: "右面", top: "上面", bottom: "下面", isometric: "斜め", fit: "選択をFit", section: "断面", cap: "切断面を塗る", capColor: "切断面の色", capNote: "閉じた不透明mesh（20万三角形以下）のみ。計測・GLB対象外。", pngSize: "PNG解像度", currentSize: "画面サイズ", customSize: "任意サイズ", width: "幅", height: "高さ", lockRatio: "縦横比を固定", transparent: "透明な背景", pngNote: "上限4096px/辺。PNGにレビューの注記・寸法ラベルは含みません。", off: "なし", offset: "断面位置 (m)", reverse: "反転", measure: "表面の2点を計測", clear: "計測クリア", note: "内部単位 m。三角形化された表面の距離。", animation: "アニメーション", noClips: "クリップなし", play: "再生", pause: "一時停止", stop: "解除", speed: "速度", quality: "画質", shadows: "影", ratio: "描画倍率", stats: "描画統計（GPU容量の測定値ではありません）", busy: "出力中…", saved: "出力しました", seek: "再生位置" },
  en: { title: "View & export", png: "Save PNG", glb: "Save GLB", helpers: "Include helpers in PNG", perspective: "Perspective", orthographic: "Orthographic", front: "Front", back: "Back", left: "Left", right: "Right", top: "Top", bottom: "Bottom", isometric: "Isometric", fit: "Fit selection", section: "Section", cap: "Fill section", capColor: "Section color", capNote: "Closed opaque meshes only (up to 200k triangles). Display only; excluded from measurements and GLB.", pngSize: "PNG resolution", currentSize: "Viewport size", customSize: "Custom size", width: "Width", height: "Height", lockRatio: "Lock aspect ratio", transparent: "Transparent background", pngNote: "Up to 4096px/side. PNG excludes review annotations and dimension labels.", off: "Off", offset: "Plane position (m)", reverse: "Reverse", measure: "Measure two surface points", clear: "Clear measurement", note: "Internal units: m. Distance on tessellated surfaces.", animation: "Animation", noClips: "No clips", play: "Play", pause: "Pause", stop: "Release pose", speed: "Speed", quality: "Quality", shadows: "Shadows", ratio: "Pixel ratio", stats: "Render statistics (not GPU memory bytes)", busy: "Exporting…", saved: "Exported", seek: "Playback time" },
};
export class ViewportTools {
  readonly element = document.createElement("details");
  #locale: "ja" | "en" = "ja";
  #clips: string[] = [];
  #pngRatio = 16 / 9;
  #capStatus = [0, 0];
  constructor(container: HTMLElement, private readonly actions: ViewportToolsActions) {
    this.element.className = "viewport-tools";
    this.element.setAttribute("name", "viewport-settings");
    const style = document.createElement("style");
    style.textContent = `.viewport-tools{position:absolute;top:12px;right:12px;z-index:5;width:min(276px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;border:1px solid #475569;border-radius:8px;background:#18202fee;color:#e2e8f0;font:12px/1.5 system-ui;box-shadow:0 4px 16px #0005}.viewport-tools summary{cursor:pointer;padding:8px 12px;font-weight:600}.viewport-tools .vt-body{padding:0 10px 10px;display:grid;gap:8px}.viewport-tools .vt-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}.viewport-tools label{display:flex;gap:5px;align-items:center}.viewport-tools select,.viewport-tools input,.viewport-tools button{font:inherit;max-width:100%}.viewport-tools input[type=number]{width:85px}.viewport-tools input[type=range]{width:100%}.viewport-tools fieldset{border:1px solid #475569;border-radius:5px;margin:0;padding:6px}.viewport-tools small{display:block;color:#bac5d4}.viewport-tools output{overflow-wrap:anywhere}.viewport-tools [data-stats]{white-space:pre-line}.viewport-tools button{padding:3px 7px}.viewport-tools input[type=checkbox]{width:auto}.viewport-tools:not([open]){width:auto}.viewport-tools button,.viewport-tools select{color:#e2e8f0;background:#283449;border:1px solid #52617a;border-radius:4px}.viewport-tools button:hover{background:#354867}.viewport-tools button:disabled{opacity:.45}.viewport-tools input[type=number]{color:#e2e8f0;background:#111927;border:1px solid #475569;border-radius:4px}.viewport-tools label:has(input[type=range]){display:block}`;
    this.element.append(style);
    container.append(this.element);
    this.#render();
  }
  setLocale(locale: "ja" | "en"): void { if (this.#locale === locale) return; this.#locale = locale; this.#translate(); }
  setClips(names: string[]): void {
    if (JSON.stringify(names) === JSON.stringify(this.#clips)) return;
    this.#clips = names;
    const select = this.#get<HTMLSelectElement>("clip");
    select.replaceChildren();
    const none = document.createElement("option"); none.value = "-1"; none.textContent = labels[this.#locale].noClips; select.append(none);
    names.forEach((name, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = name; select.append(option); });
    this.setPlayback(0, 0, false);
  }
  setSelectedClip(index: number): void { this.#get<HTMLSelectElement>("clip").value = String(index); }
  setPlayback(time: number, duration: number, playing: boolean): void {
    const seek = this.#get<HTMLInputElement>("seek");
    seek.max = String(duration || 1); seek.value = String(time); seek.disabled = duration <= 0;
    this.#get("time").textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
    this.#get<HTMLButtonElement>("play").disabled = playing || duration <= 0;
    this.#get<HTMLButtonElement>("pause").disabled = !playing;
  }
  setMeasuring(enabled: boolean): void { this.#get<HTMLInputElement>("measure").checked = enabled; }
  setMeasurement(meters: number | null, points: number): void {
    this.#get("distance").dataset.meters = meters === null ? "" : String(meters);
    this.#get("distance").dataset.points = String(points);
    this.#updateDistance();
  }
  setClipping(state: { axis: string; offset: number; reverse: boolean; cap: boolean; capColor: string }): void {
    this.#get<HTMLSelectElement>("axis").value = state.axis;
    this.#get<HTMLInputElement>("offset").value = String(state.offset);
    this.#get<HTMLInputElement>("reverse").checked = state.reverse;
    this.#get<HTMLInputElement>("cap").checked = state.cap;
    this.#get<HTMLInputElement>("cap-color").value = state.capColor;
  }
  setCapStatus(eligible: number, skipped: number): void {
    this.#capStatus = [eligible, skipped];
    this.#get("cap-status").textContent = eligible || skipped ? (this.#locale === "ja" ? `対象 ${eligible} / 対象外 ${skipped}` : `Eligible ${eligible} / Skipped ${skipped}`) : "";
  }
  setStats(text: string): void { this.#get("stats").textContent = text; }
  setProjection(projection: string): void { this.#get<HTMLSelectElement>("projection").value = projection; }
  setPixelRatio(ratio: number): void {
    const select = this.#get<HTMLSelectElement>("ratio");
    if (![...select.options].some((option) => option.value === String(ratio))) {
      const option = document.createElement("option"); option.value = String(ratio); option.textContent = String(ratio); select.append(option);
    }
    select.value = String(ratio);
  }
  setShadows(enabled: boolean): void { this.#get<HTMLInputElement>("shadows").checked = enabled; }
  dispose(): void { this.element.remove(); }
  #get<T extends HTMLElement = HTMLElement>(id: string): T { return this.element.querySelector<T>(`[data-vt="${id}"]`)!; }
  #translate(): void {
    const t = labels[this.#locale];
    this.element.querySelectorAll<HTMLElement>("[data-label]").forEach((node) => { node.textContent = t[node.dataset.label as keyof typeof t]; });
    this.#get<HTMLSelectElement>("clip").options[0]!.textContent = t.noClips;
    this.setCapStatus(this.#capStatus[0]!, this.#capStatus[1]!);
  }
  #updateDistance(): void {
    const output = this.#get("distance");
    const meters = output.dataset.meters;
    const unit = this.#get<HTMLSelectElement>("unit").value;
    output.textContent = meters ? `${(Number(meters) * (unit === "mm" ? 1000 : unit === "cm" ? 100 : 1)).toPrecision(7)} ${unit}` : `${output.dataset.points ?? 0} / 2`;
  }
  #render(): void {
    const body = document.createElement("div");
    body.innerHTML = `<summary data-label="title"></summary><div class="vt-body">
      <div class="vt-row"><button data-vt="png" data-label="png"></button><button data-vt="glb" data-label="glb"></button></div>
      <fieldset><legend data-label="pngSize"></legend><select data-vt="png-size" aria-label="PNG resolution"><option value="current" data-label="currentSize"></option><option value="1080">1920 × 1080</option><option value="2160">3840 × 2160</option><option value="custom" data-label="customSize"></option></select>
      <div class="vt-row"><label><span data-label="width"></span><input data-vt="png-width" type="number" min="1" max="4096" step="1" value="1920" disabled></label><label><span data-label="height"></span><input data-vt="png-height" type="number" min="1" max="4096" step="1" value="1080" disabled></label></div>
      <label><input data-vt="png-lock" type="checkbox" checked><span data-label="lockRatio"></span></label><label><input data-vt="png-transparent" type="checkbox"><span data-label="transparent"></span></label><small data-label="pngNote"></small></fieldset>
      <label><input data-vt="helpers" type="checkbox"><span data-label="helpers"></span></label><output data-vt="status" role="status"></output>
      <select data-vt="projection" aria-label="Projection"><option value="perspective" data-label="perspective"></option><option value="orthographic" data-label="orthographic"></option></select>
      <div class="vt-row">${["front", "back", "left", "right", "top", "bottom", "isometric", "fit"].map((id) => `<button data-vt="${id}" data-label="${id}"></button>`).join("")}</div>
      <fieldset><legend data-label="section"></legend><div class="vt-row"><select data-vt="axis" aria-label="Section axis"><option value="off" data-label="off"></option><option>x</option><option>y</option><option>z</option></select><label><input data-vt="reverse" type="checkbox"><span data-label="reverse"></span></label></div><label><span data-label="offset"></span><input data-vt="offset" type="number" value="0" step="0.01"></label><label><input data-vt="cap" type="checkbox"><span data-label="cap"></span></label><label><span data-label="capColor"></span><input data-vt="cap-color" type="color" value="#e9a23b"></label><small data-label="capNote"></small><output data-vt="cap-status"></output></fieldset>
      <fieldset><label><input data-vt="measure" type="checkbox"><span data-label="measure"></span></label><small data-label="note"></small><div class="vt-row"><output data-vt="distance">0 / 2</output><select data-vt="unit" aria-label="Measurement unit"><option>mm</option><option>cm</option><option>m</option></select><button data-vt="clear" data-label="clear"></button></div></fieldset>
      <fieldset><legend data-label="animation"></legend><select data-vt="clip" aria-label="Animation clip"><option value="-1"></option></select><div class="vt-row"><button data-vt="play" data-label="play"></button><button data-vt="pause" data-label="pause"></button><button data-vt="stop" data-label="stop"></button></div><label><span data-label="seek"></span><input data-vt="seek" type="range" min="0" max="1" step="0.01" value="0"></label><output data-vt="time"></output><label><span data-label="speed"></span><select data-vt="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option><option>4</option></select>×</label></fieldset>
      <fieldset><legend data-label="quality"></legend><label><span data-label="ratio"></span><select data-vt="ratio"><option>0.5</option><option>1</option><option>1.5</option><option selected>2</option></select></label><label><input data-vt="shadows" type="checkbox" checked><span data-label="shadows"></span></label><small data-label="stats"></small><output data-vt="stats"></output></fieldset></div>`;
    this.element.append(...body.childNodes);
    this.#translate(); this.setPlayback(0, 0, false);
    const on = (id: string, event: string, callback: () => void) => this.#get(id).addEventListener(event, callback);
    const number = (id: string) => Number(this.#get<HTMLInputElement>(id).value);
    const checked = (id: string) => this.#get<HTMLInputElement>(id).checked;
    const exportFile = async (action: () => Promise<void>) => {
      this.#get<HTMLButtonElement>("png").disabled = true; this.#get<HTMLButtonElement>("glb").disabled = true;
      this.#get("status").textContent = labels[this.#locale].busy;
      try { await action(); this.#get("status").textContent = labels[this.#locale].saved; }
      catch (error) { this.#get("status").textContent = error instanceof Error ? error.message : String(error); }
      finally { this.#get<HTMLButtonElement>("png").disabled = false; this.#get<HTMLButtonElement>("glb").disabled = false; }
    };
    on("png-size", "change", () => {
      const preset = this.#get<HTMLSelectElement>("png-size").value;
      const custom = preset === "custom";
      for (const id of ["png-width", "png-height"]) this.#get<HTMLInputElement>(id).disabled = !custom;
      if (preset === "1080" || preset === "2160") {
        this.#get<HTMLInputElement>("png-height").value = preset;
        this.#get<HTMLInputElement>("png-width").value = preset === "1080" ? "1920" : "3840";
        this.#pngRatio = 16 / 9;
      }
    });
    on("png-lock", "change", () => { if (number("png-width") > 0 && number("png-height") > 0) this.#pngRatio = number("png-width") / number("png-height"); });
    for (const axis of ["width", "height"]) on(`png-${axis}`, "change", () => {
      if (!checked("png-lock")) return;
      if (axis === "width") this.#get<HTMLInputElement>("png-height").value = String(Math.max(1, Math.round(number("png-width") / this.#pngRatio)));
      else this.#get<HTMLInputElement>("png-width").value = String(Math.max(1, Math.round(number("png-height") * this.#pngRatio)));
    });
    on("png", "click", () => void exportFile(() => {
      const current = this.#get<HTMLSelectElement>("png-size").value === "current";
      return this.actions.png(checked("helpers"), { ...(current ? {} : { width: number("png-width"), height: number("png-height") }), transparent: checked("png-transparent") });
    }));
    on("glb", "click", () => void exportFile(this.actions.glb));
    on("projection", "change", () => this.actions.projection(this.#get<HTMLSelectElement>("projection").value as "perspective" | "orthographic"));
    for (const view of ["front", "back", "left", "right", "top", "bottom", "isometric"] as const) on(view, "click", () => this.actions.view(view));
    on("fit", "click", this.actions.fit);
    for (const id of ["axis", "offset", "reverse", "cap", "cap-color"]) on(id, "change", () => this.actions.clipping(this.#get<HTMLSelectElement>("axis").value as "off" | "x" | "y" | "z", number("offset"), checked("reverse"), checked("cap"), this.#get<HTMLInputElement>("cap-color").value));
    on("measure", "change", () => this.actions.measure(checked("measure")));
    on("clear", "click", this.actions.clearMeasurement); on("unit", "change", () => this.#updateDistance());
    on("clip", "change", () => this.actions.clip(number("clip")));
    on("play", "click", this.actions.play); on("pause", "click", this.actions.pause);
    on("stop", "click", () => { this.#get<HTMLSelectElement>("clip").value = "-1"; this.actions.stop(); });
    on("seek", "input", () => this.actions.seek(number("seek"))); on("speed", "change", () => this.actions.speed(number("speed")));
    for (const id of ["ratio", "shadows"]) on(id, "change", () => this.actions.quality(number("ratio"), checked("shadows")));
  }
}
