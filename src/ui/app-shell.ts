import type { SceneModel, Vec3Model } from "../model/scene-model";

interface AppActions {
  toggleGrid: () => void;
  toggleAxes: () => void;
  resetCamera: () => void;
}

export class AppShell {
  readonly viewportElement: HTMLElement;
  readonly #root: HTMLElement;
  readonly #abortController = new AbortController();
  readonly #gridButton: HTMLButtonElement;
  readonly #axesButton: HTMLButtonElement;
  readonly #loadingElement: HTMLElement;
  readonly #statusText: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.innerHTML = this.#template();
    this.viewportElement = this.#query<HTMLElement>("[data-viewport]");
    this.#gridButton = this.#query<HTMLButtonElement>("[data-action='grid']");
    this.#axesButton = this.#query<HTMLButtonElement>("[data-action='axes']");
    this.#loadingElement = this.#query<HTMLElement>("[data-loading]");
    this.#statusText = this.#query<HTMLElement>("[data-status]");
  }

  bindActions(actions: AppActions): void {
    const options = { signal: this.#abortController.signal };
    this.#gridButton.addEventListener("click", actions.toggleGrid, options);
    this.#axesButton.addEventListener("click", actions.toggleAxes, options);
    this.#query<HTMLButtonElement>("[data-action='reset']").addEventListener(
      "click",
      actions.resetCamera,
      options,
    );
  }

  update(model: Readonly<SceneModel>): void {
    this.#setPressed(this.#gridButton, model.helpers.gridVisible);
    this.#setPressed(this.#axesButton, model.helpers.axesVisible);
    this.#query("[data-camera-position]").textContent = this.#format(model.camera.position);
    this.#query("[data-camera-target]").textContent = this.#format(model.camera.target);
    this.#query("[data-object-count]").textContent = String(model.objects.length);
    this.#query("[data-light-count]").textContent = String(model.lights.length);

    const box = model.objects.find((item) => item.geometry.type === "box");
    if (box?.geometry.type === "box") {
      this.#query("[data-object-name]").textContent = box.name;
      this.#query("[data-box-position]").textContent = this.#format(box.transform.position);
      this.#query("[data-box-width]").textContent = box.geometry.width.toFixed(2);
      this.#query("[data-box-height]").textContent = box.geometry.height.toFixed(2);
      this.#query("[data-box-depth]").textContent = box.geometry.depth.toFixed(2);
    }
  }

  setReady(): void {
    this.#loadingElement.classList.add("is-hidden");
    this.#statusText.textContent = "VIEWPORT READY";
  }

  setError(message: string): void {
    this.#loadingElement.classList.remove("is-hidden");
    this.#loadingElement.classList.add("is-error");
    this.#loadingElement.textContent = message;
    this.#statusText.textContent = "RENDERER ERROR";
  }

  dispose(): void {
    this.#abortController.abort();
    this.#root.replaceChildren();
  }

  #setPressed(button: HTMLButtonElement, pressed: boolean): void {
    button.setAttribute("aria-pressed", String(pressed));
    button.classList.toggle("is-active", pressed);
  }

  #format(vector: Readonly<Vec3Model>): string {
    return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`;
  }

  #query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Required UI element not found: ${selector}`);
    return element;
  }

  #template(): string {
    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="brand-copy">
              <strong>RENDER VIEWER</strong>
              <small>PARAMETRIC 3D SCENE TOOL</small>
            </span>
          </div>
          <div class="header-meta">
            <span class="phase-badge">PHASE 1</span>
            <span class="header-divider" aria-hidden="true"></span>
            <span class="scene-name">Lighting Study 01</span>
          </div>
        </header>

        <main class="workspace">
          <aside class="panel scene-panel" aria-label="シーン一覧">
            <div class="panel-heading">
              <div><span class="eyebrow">SCENE MODEL</span><h1>シーン</h1></div>
              <span class="schema-badge">JSON v1</span>
            </div>
            <nav class="scene-tree" aria-label="シーン構成">
              <section class="tree-section">
                <div class="tree-group"><span>OBJECTS</span><b data-object-count>2</b></div>
                <div class="tree-item is-selected">
                  <span class="tree-icon cube-icon" aria-hidden="true"></span>
                  <span><strong>Box 01</strong><small>Mesh · Standard</small></span>
                  <i class="state-dot" aria-label="表示中"></i>
                </div>
                <div class="tree-item">
                  <span class="tree-icon plane-icon" aria-hidden="true"></span>
                  <span><strong>Ground Plane</strong><small>Environment</small></span>
                  <i class="state-dot" aria-label="表示中"></i>
                </div>
              </section>
              <section class="tree-section">
                <div class="tree-group"><span>LIGHTS</span><b data-light-count>2</b></div>
                <div class="tree-item">
                  <span class="tree-icon light-icon" aria-hidden="true"></span>
                  <span><strong>Ambient Light</strong><small>Fill</small></span>
                  <i class="state-dot" aria-label="有効"></i>
                </div>
                <div class="tree-item">
                  <span class="tree-icon light-icon is-key" aria-hidden="true"></span>
                  <span><strong>Key Light</strong><small>Directional</small></span>
                  <i class="state-dot" aria-label="有効"></i>
                </div>
              </section>
              <section class="tree-section">
                <div class="tree-group"><span>CAMERA</span><b>1</b></div>
                <div class="tree-item">
                  <span class="tree-icon camera-icon" aria-hidden="true"></span>
                  <span><strong>Perspective</strong><small>45° FOV</small></span>
                </div>
              </section>
            </nav>
            <div class="model-note">
              <b>01</b><p><strong>SceneModelが正本</strong>描画状態はモデルから生成されます。</p>
            </div>
          </aside>

          <section class="viewport-panel" aria-label="3Dビュー">
            <div class="viewport-toolbar">
              <div class="view-title"><i></i><span>PERSPECTIVE</span><small>45°</small></div>
              <div class="tool-cluster" aria-label="ビュー表示設定">
                <button class="tool-button is-active" data-action="grid" type="button" aria-label="Grid表示を切り替え" aria-pressed="true">
                  <i class="grid-glyph" aria-hidden="true"></i><span>GRID</span>
                </button>
                <button class="tool-button is-active" data-action="axes" type="button" aria-label="Axes表示を切り替え" aria-pressed="true">
                  <i class="axes-glyph" aria-hidden="true"></i><span>AXES</span>
                </button>
                <button class="tool-button" data-action="reset" type="button" aria-label="カメラを初期視点へ戻す">
                  <i class="reset-glyph" aria-hidden="true">↺</i><span>RESET VIEW</span>
                </button>
              </div>
            </div>
            <div class="viewport" data-viewport>
              <div class="loading-state" data-loading>
                <span class="loading-cube" aria-hidden="true"></span>
                <span>INITIALIZING WEBGL</span>
              </div>
              <span class="world-label">WORLD / Y UP</span>
              <div class="interaction-hint">
                <span>左ドラッグ · 回転</span><span>右ドラッグ · 移動</span><span>ホイール · ズーム</span>
              </div>
            </div>
            <div class="viewport-statusbar">
              <span class="ready-status"><i></i><span data-status>INITIALIZING</span></span>
              <span class="status-divider"></span><span>WEBGL · ACES</span>
              <span class="status-spacer"></span><span>DPR ≤ 2</span>
            </div>
          </section>

          <aside class="panel inspector-panel" aria-label="設定パネル">
            <div class="panel-heading">
              <div><span class="eyebrow">INSPECTOR</span><h2 data-object-name>Box 01</h2></div>
              <span class="readonly-badge">READ ONLY</span>
            </div>
            <div class="inspector-scroll">
              <section class="property-section">
                <div class="property-heading"><span>TRANSFORM</span><i></i></div>
                <dl class="property-list">
                  <div><dt>Position</dt><dd data-box-position>0.00, 1.00, 0.00</dd></div>
                  <div><dt>Rotation Y</dt><dd>−18.00°</dd></div>
                  <div><dt>Scale</dt><dd>1.00, 1.00, 1.00</dd></div>
                </dl>
              </section>
              <section class="property-section">
                <div class="property-heading"><span>BOX GEOMETRY</span><i></i></div>
                <div class="metric-grid">
                  <div><span>WIDTH</span><strong data-box-width>2.00</strong><small>m</small></div>
                  <div><span>HEIGHT</span><strong data-box-height>2.00</strong><small>m</small></div>
                  <div><span>DEPTH</span><strong data-box-depth>2.00</strong><small>m</small></div>
                </div>
              </section>
              <section class="property-section">
                <div class="property-heading"><span>MATERIAL SNAPSHOT</span><i></i></div>
                <div class="swatch-row"><i></i><span><strong>#5F8CFF</strong><small>MeshStandardMaterial</small></span></div>
                <dl class="property-list compact">
                  <div><dt>Roughness</dt><dd>0.32</dd></div>
                  <div><dt>Metalness</dt><dd>0.08</dd></div>
                </dl>
              </section>
              <section class="property-section">
                <div class="property-heading"><span>CAMERA</span><i></i></div>
                <dl class="property-list">
                  <div><dt>Position</dt><dd data-camera-position>6.50, 5.20, 8.20</dd></div>
                  <div><dt>Target</dt><dd data-camera-target>0.00, 0.90, 0.00</dd></div>
                  <div><dt>Projection</dt><dd>Perspective</dd></div>
                </dl>
              </section>
              <div class="phase-card">
                <div><span>PHASE</span><strong>01 / 09</strong></div>
                <h3>VIEW FOUNDATION</h3>
                <p>カメラ、レンダラー、Orbit操作、Grid、Axes、初期Boxを実装済みです。</p>
                <i><b></b></i>
              </div>
            </div>
          </aside>
        </main>
      </div>
    `;
  }
}
