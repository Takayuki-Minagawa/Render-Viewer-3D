import { diagnoseFiles, diagnoseGlb, optimizeGlb } from "../asset-tools/client";
import type { DiagnosticResult, OptimizationResult } from "../asset-tools/types";
import { downloadBlob } from "../three/scene-export";

const labels = {
  ja: { title: "glTF診断・軽量化", files: "ローカルglTF/GLBを診断", primary: "診断するモデル", current: "現在のシーンを診断", optimize: "軽量化したGLBコピー", report: "JSONレポート保存", copy: "GLBコピー保存", cancel: "取消", idle: "モデルと参照ファイルを一緒に選択してください。外部通信なしで処理します。", scope: "軽量化は重複・未使用の数値データを整理します。階層・名前・材質・アニメーションを保持し、形状の簡略化は行いません。", busy: "処理中…（上限30秒）", cancelled: "取り消しました", errors: "エラー", warnings: "警告", infos: "情報", hints: "ヒント", unverified: "このValidatorでは未検証の拡張", capped: "レポートは最大1,000件です。", original: "容量が減らないため、元のGLBを推奨します。", estimate: "作業メモリ推定（実測・GPU容量ではありません）", choose: "モデルを選択してください", elapsed: "処理時間" },
  en: { title: "glTF diagnostics & optimization", files: "Validate local glTF/GLB", primary: "Model to validate", current: "Validate current scene", optimize: "Create optimized GLB copy", report: "Save JSON report", copy: "Save GLB copy", cancel: "Cancel", idle: "Select the model and its resource files together. Processing uses no external network requests.", scope: "Optimization removes duplicate/unused numeric data. Hierarchy, names, materials and animations are preserved; geometry is not simplified.", busy: "Processing… (30 second limit)", cancelled: "Cancelled", errors: "Errors", warnings: "Warnings", infos: "Info", hints: "Hints", unverified: "Extensions not validated by this Validator", capped: "Reports contain at most 1,000 issues.", original: "The original GLB is recommended because the copy is not smaller.", estimate: "Estimated working memory (not measured or GPU memory)", choose: "Select a model", elapsed: "Processing time" },
};
export interface AssetToolsActions { exportGlb: () => Promise<ArrayBuffer>; }
export class AssetToolsPanel {
  readonly element = document.createElement("details");
  #locale: "ja" | "en" = "ja";
  #controller?: AbortController;
  #disposed = false;
  #result?: DiagnosticResult | OptimizationResult;
  #files: File[] = [];
  readonly #events = new AbortController();
  constructor(container: HTMLElement, actions: AssetToolsActions) {
    this.element.className = "asset-tools";
    this.element.setAttribute("name", "viewport-settings");
    this.element.innerHTML = `<style>.asset-tools{position:absolute;right:12px;top:88px;z-index:5;width:min(330px,calc(100% - 24px));max-height:calc(100% - 100px);overflow:auto;border:1px solid #475569;border-radius:8px;background:#18202fee;color:#e2e8f0;font:12px/1.5 system-ui}.asset-tools:not([open]){width:auto}.asset-tools summary{padding:8px 12px;cursor:pointer;font-weight:600}.asset-tools .at-body{display:grid;gap:8px;padding:0 10px 10px}.asset-tools button,.asset-tools select{font:inherit;color:inherit;background:#283449;border:1px solid #52617a;border-radius:4px;padding:4px}.asset-tools button:disabled{opacity:.45}.asset-tools small,.asset-tools output{overflow-wrap:anywhere;white-space:pre-line}.asset-tools ul{padding-left:18px;max-height:220px;overflow:auto}.asset-tools li{margin-bottom:6px;overflow-wrap:anywhere}.asset-tools input[type=file]{display:none}</style>
      <summary data-at-label="title"></summary><div class="at-body"><small data-at-label="idle"></small>
      <input data-at="files" type="file" multiple><button data-at="choose" data-at-label="files"></button>
      <label data-at="primary-row" hidden><span data-at-label="primary"></span><select data-at="primary"></select></label>
      <button data-at="current" data-at-label="current"></button><small data-at-label="scope"></small><button data-at="optimize" data-at-label="optimize"></button>
      <button data-at="cancel" data-at-label="cancel" hidden></button><output data-at="status" role="status" aria-live="polite"></output>
      <small data-at="unverified"></small><ul data-at="issues"></ul><small data-at-label="capped"></small>
      <button data-at="report" data-at-label="report" disabled></button><button data-at="copy" data-at-label="copy" disabled></button></div>`;
    container.append(this.element); this.#translate();
    const on = (id: string, event: string, callback: () => void) => this.#get(id).addEventListener(event, callback, { signal: this.#events.signal });
    on("choose", "click", () => this.#get<HTMLInputElement>("files").click());
    on("files", "change", () => {
      this.#files = Array.from(this.#get<HTMLInputElement>("files").files ?? []); this.#get<HTMLInputElement>("files").value = "";
      const models = this.#files.map((file, index) => ({ file, index })).filter(({ file }) => /\.(gltf|glb)$/iu.test(file.name));
      const select = this.#get<HTMLSelectElement>("primary"); select.replaceChildren();
      for (const { file, index } of models) { const option = document.createElement("option"); option.value = String(index); option.textContent = file.name; select.append(option); }
      this.#get("primary-row").hidden = models.length < 2;
      if (models.length) void this.#validateFiles(); else this.#get("status").textContent = labels[this.#locale].choose;
    });
    on("primary", "change", () => { void this.#validateFiles(); });
    on("current", "click", () => { void this.#run(async (signal) => { const bytes = await actions.exportGlb(); signal.throwIfAborted(); return diagnoseGlb(bytes, { signal }); }); });
    on("optimize", "click", () => { void this.#run(async (signal) => { const bytes = await actions.exportGlb(); signal.throwIfAborted(); return optimizeGlb(bytes, { signal }); }); });
    on("cancel", "click", () => this.#controller?.abort());
    this.element.addEventListener("keydown", (event) => { if (event.key === "Escape" && this.#controller) { event.preventDefault(); this.#controller.abort(); } }, { signal: this.#events.signal });
    on("report", "click", () => {
      if (this.#result) downloadBlob(new Blob([JSON.stringify({ ...this.#result, ...("bytes" in this.#result ? { bytes: undefined } : {}) }, null, 2)], { type: "application/json" }), "gltf-diagnostic-report.json");
    });
    on("copy", "click", () => {
      if (this.#result && "bytes" in this.#result) downloadBlob(new Blob([this.#result.bytes], { type: "model/gltf-binary" }), this.#result.reduced ? "scene-optimized.glb" : "scene-original.glb");
    });
  }
  setLocale(locale: "ja" | "en"): void { this.#locale = locale; this.#translate(); if (this.#result) this.#renderResult(); }
  dispose(): void { this.#disposed = true; this.#controller?.abort(); this.#events.abort(); this.#files = []; this.#result = undefined; this.element.remove(); }
  #get<T extends HTMLElement = HTMLElement>(id: string): T { return this.element.querySelector<T>(`[data-at="${id}"]`)!; }
  #translate(): void { const t = labels[this.#locale]; this.element.querySelectorAll<HTMLElement>("[data-at-label]").forEach((node) => { node.textContent = t[node.dataset.atLabel as keyof typeof t]; }); }
  async #validateFiles(): Promise<void> { const index = Number(this.#get<HTMLSelectElement>("primary").value); await this.#run((signal) => diagnoseFiles(this.#files, index, { signal })); }
  async #run(action: (signal: AbortSignal) => Promise<DiagnosticResult | OptimizationResult>): Promise<void> {
    if (this.#controller || this.#disposed) return;
    const controller = new AbortController(); this.#controller = controller; this.#result = undefined;
    this.#get("issues").replaceChildren(); this.#get("unverified").textContent = "";
    for (const id of ["choose", "current", "optimize", "primary", "report", "copy"]) this.#get<HTMLButtonElement>(id).disabled = true;
    this.#get("cancel").hidden = false; this.element.setAttribute("aria-busy", "true"); this.#get("status").textContent = labels[this.#locale].busy;
    try {
      const result = await action(controller.signal); controller.signal.throwIfAborted();
      if (!this.#disposed) { this.#result = result; this.#renderResult(); }
    } catch (error) {
      if (!this.#disposed) this.#get("status").textContent = controller.signal.aborted ? labels[this.#locale].cancelled : error instanceof Error ? error.message : String(error);
    } finally {
      this.#controller = undefined;
      if (!this.#disposed) {
        this.element.removeAttribute("aria-busy"); this.#get("cancel").hidden = true;
        for (const id of ["choose", "current", "optimize", "primary"]) this.#get<HTMLButtonElement>(id).disabled = false;
        this.#get<HTMLButtonElement>("report").disabled = !this.#result;
        this.#get<HTMLButtonElement>("copy").disabled = !this.#result || !("bytes" in this.#result);
      }
    }
  }
  #renderResult(): void {
    const result = this.#result; if (!result) return;
    const t = labels[this.#locale], issues = result.report.issues;
    let status = `${t.errors}: ${issues.numErrors} / ${t.warnings}: ${issues.numWarnings}\n${t.elapsed}: ${(result.durationMs / 1000).toFixed(2)} s`;
    if ("bytes" in result) status += `\n${result.inputBytes.toLocaleString()} → ${result.outputBytes.toLocaleString()} bytes (${((1 - result.outputBytes / result.inputBytes) * 100).toFixed(1)}%)\n${t.estimate}: ${(result.estimatedWorkingBytes / 1048576).toFixed(1)} MiB${result.reduced ? "" : `\n${t.original}`}`;
    this.#get("status").textContent = status;
    this.#get("unverified").textContent = result.unsupportedExtensions.length ? `${t.unverified}: ${result.unsupportedExtensions.join(", ")}` : "";
    const list = this.#get("issues"); list.replaceChildren();
    const severities = [t.errors, t.warnings, t.infos, t.hints];
    for (const issue of issues.messages) { const row = document.createElement("li"); row.textContent = `[${severities[issue.severity] ?? issue.severity}] ${issue.code}: ${issue.message}${issue.pointer ? ` (${issue.pointer})` : ""}`; list.append(row); }
  }
}
