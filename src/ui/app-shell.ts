import type {
  DeepReadonly,
  SceneSnapshot,
  Vec3Model,
} from "../model/scene-model";
import {
  loadAppPreferences,
  saveAppPreferences,
  toggleLocale,
  toggleTheme,
  type AppPreferences,
} from "./app-preferences";
import { translate, type MessageKey } from "./i18n";

interface AppActions {
  toggleGrid: () => void;
  toggleAxes: () => void;
  resetCamera: () => void;
}

type UiStatus = "initializing" | "ready" | "error";

export class AppShell {
  readonly viewportElement: HTMLElement;
  readonly #root: HTMLElement;
  readonly #abortController = new AbortController();
  readonly #gridButton: HTMLButtonElement;
  readonly #axesButton: HTMLButtonElement;
  readonly #languageButton: HTMLButtonElement;
  readonly #themeButton: HTMLButtonElement;
  readonly #manualDialog: HTMLDialogElement;
  readonly #loadingElement: HTMLElement;
  readonly #statusText: HTMLElement;
  #preferences: AppPreferences;
  #status: UiStatus = "initializing";

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#preferences = loadAppPreferences();
    this.#root.innerHTML = this.#template();
    this.viewportElement = this.#query<HTMLElement>("[data-viewport]");
    this.#gridButton = this.#query<HTMLButtonElement>("[data-action='grid']");
    this.#axesButton = this.#query<HTMLButtonElement>("[data-action='axes']");
    this.#languageButton = this.#query<HTMLButtonElement>(
      "[data-action='language']",
    );
    this.#themeButton = this.#query<HTMLButtonElement>("[data-action='theme']");
    this.#manualDialog = this.#query<HTMLDialogElement>("[data-manual-dialog]");
    this.#loadingElement = this.#query<HTMLElement>("[data-loading]");
    this.#statusText = this.#query<HTMLElement>("[data-status]");
    this.#applyPreferences();
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
    this.#languageButton.addEventListener(
      "click",
      () => this.#setLocale(toggleLocale(this.#preferences.locale)),
      options,
    );
    this.#themeButton.addEventListener(
      "click",
      () => this.#setTheme(toggleTheme(this.#preferences.theme)),
      options,
    );
    this.#query<HTMLButtonElement>("[data-action='manual']").addEventListener(
      "click",
      () => this.#manualDialog.showModal(),
      options,
    );
    this.#manualDialog.addEventListener(
      "click",
      (event) => {
        if (event.target === this.#manualDialog) this.#manualDialog.close();
      },
      options,
    );
  }

  update(model: SceneSnapshot): void {
    this.#setPressed(this.#gridButton, model.helpers.gridVisible);
    this.#setPressed(this.#axesButton, model.helpers.axesVisible);
    this.#query("[data-camera-position]").textContent = this.#format(model.camera.position);
    this.#query("[data-camera-target]").textContent = this.#format(model.camera.target);
    this.#query("[data-object-count]").textContent = String(model.objects.length);
    this.#query("[data-light-count]").textContent = String(model.lights.length);
    this.#query("[data-scene-name]").textContent = model.name;

    const box = model.objects.find((item) => item.geometry.type === "box");
    if (box?.geometry.type === "box") {
      this.#query("[data-object-name]").textContent = box.name;
      this.#query("[data-box-position]").textContent = this.#format(box.transform.position);
      this.#query("[data-box-width]").textContent = box.geometry.width.toFixed(2);
      this.#query("[data-box-height]").textContent = box.geometry.height.toFixed(2);
      this.#query("[data-box-depth]").textContent = box.geometry.depth.toFixed(2);
    }
  }

  refreshPreferences(): void {
    this.#applyPreferences();
  }

  setReady(): void {
    this.#status = "ready";
    this.#loadingElement.classList.add("is-hidden");
    this.#renderStatus();
  }

  setError(message?: string): void {
    this.#status = "error";
    this.#loadingElement.classList.remove("is-hidden");
    this.#loadingElement.classList.add("is-error");
    this.#loadingElement.textContent =
      message ?? translate(this.#preferences.locale, "error.webgl");
    this.#renderStatus();
  }

  dispose(): void {
    this.#abortController.abort();
    this.#root.replaceChildren();
  }

  #setPressed(button: HTMLButtonElement, pressed: boolean): void {
    button.setAttribute("aria-pressed", String(pressed));
    button.classList.toggle("is-active", pressed);
  }

  #setLocale(locale: AppPreferences["locale"]): void {
    this.#preferences = { ...this.#preferences, locale };
    saveAppPreferences(this.#preferences);
    this.#applyLocale();
  }

  #setTheme(theme: AppPreferences["theme"]): void {
    this.#preferences = { ...this.#preferences, theme };
    saveAppPreferences(this.#preferences);
    this.#applyTheme();
  }

  #applyPreferences(): void {
    this.#applyLocale();
    this.#applyTheme();
  }

  #applyLocale(): void {
    const { locale } = this.#preferences;
    document.documentElement.lang = locale;
    document.title = translate(locale, "document.title");
    document
      .querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute("content", translate(locale, "document.description"));
    this.viewportElement
      .querySelector<HTMLCanvasElement>(".viewport-canvas")
      ?.setAttribute("aria-label", translate(locale, "viewport.canvasLabel"));

    for (const element of this.#root.querySelectorAll<HTMLElement>("[data-i18n]")) {
      const key = element.dataset.i18n as MessageKey | undefined;
      if (key) element.textContent = translate(locale, key);
    }
    for (const element of this.#root.querySelectorAll<HTMLElement>(
      "[data-i18n-aria-label]",
    )) {
      const key = element.dataset.i18nAriaLabel as MessageKey | undefined;
      if (key) element.setAttribute("aria-label", translate(locale, key));
    }

    this.#renderLanguageButton();
    this.#renderThemeButton();
    this.#renderStatus();
  }

  #applyTheme(): void {
    const { theme } = this.#preferences;
    document.documentElement.dataset.theme = theme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#0b0e13" : "#eef2f7");
    this.#renderThemeButton();
  }

  #renderLanguageButton(): void {
    const { locale } = this.#preferences;
    const switchesToEnglish = locale === "ja";
    this.#languageButton.setAttribute(
      "aria-label",
      translate(
        locale,
        switchesToEnglish
          ? "language.switchToEnglish"
          : "language.switchToJapanese",
      ),
    );
    this.#query("[data-language-label]").textContent = translate(
      locale,
      switchesToEnglish ? "language.english" : "language.japanese",
    );
  }

  #renderThemeButton(): void {
    const { locale, theme } = this.#preferences;
    const switchesToLight = theme === "dark";
    this.#themeButton.setAttribute(
      "aria-label",
      translate(
        locale,
        switchesToLight ? "theme.switchToLight" : "theme.switchToDark",
      ),
    );
    this.#themeButton.setAttribute("aria-pressed", String(theme === "light"));
    this.#query("[data-theme-icon]").textContent = switchesToLight ? "☀" : "☾";
    this.#query("[data-theme-label]").textContent = translate(
      locale,
      switchesToLight ? "theme.light" : "theme.dark",
    );
  }

  #renderStatus(): void {
    this.#statusText.textContent = translate(
      this.#preferences.locale,
      `status.${this.#status}` as MessageKey,
    );
  }

  #format(vector: DeepReadonly<Vec3Model>): string {
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
              <small data-i18n="brand.subtitle">パラメトリック3Dシーンツール</small>
            </span>
          </div>
          <div class="header-tools">
            <div class="header-meta">
              <span class="phase-badge" data-i18n="header.phase">フェーズ 1</span>
              <span class="header-divider" aria-hidden="true"></span>
              <span class="scene-name" data-scene-name>Lighting Study 01</span>
            </div>
            <div class="header-actions" role="group" data-i18n-aria-label="header.controls" aria-label="表示と言語の設定">
              <button class="header-button" data-action="language" type="button" aria-label="英語に切り替え">
                <i aria-hidden="true">文/A</i><span data-language-label>English</span>
              </button>
              <button class="header-button" data-action="theme" type="button" aria-label="ライトモードに切り替え" aria-pressed="false">
                <i data-theme-icon aria-hidden="true">☀</i><span data-theme-label>ライト</span>
              </button>
              <button class="header-button" data-action="manual" type="button" data-i18n-aria-label="manual.openLabel" aria-label="簡易マニュアルを開く">
                <i aria-hidden="true">?</i><span data-i18n="manual.open">使い方</span>
              </button>
            </div>
          </div>
        </header>

        <main class="workspace">
          <aside class="panel scene-panel" data-i18n-aria-label="scene.panelLabel" aria-label="シーン一覧">
            <div class="panel-heading">
              <div><span class="eyebrow" data-i18n="scene.eyebrow">シーンモデル</span><h1 data-i18n="scene.title">シーン</h1></div>
              <span class="schema-badge">JSON v1</span>
            </div>
            <nav class="scene-tree" data-i18n-aria-label="scene.structureLabel" aria-label="シーン構成">
              <section class="tree-section">
                <div class="tree-group"><span data-i18n="scene.objects">オブジェクト</span><b data-object-count>2</b></div>
                <div class="tree-item is-selected">
                  <span class="tree-icon cube-icon" aria-hidden="true"></span>
                  <span><strong>Box 01</strong><small data-i18n="scene.boxMeta">メッシュ・標準マテリアル</small></span>
                  <i class="state-dot" data-i18n-aria-label="scene.visible" aria-label="表示中"></i>
                </div>
                <div class="tree-item">
                  <span class="tree-icon plane-icon" aria-hidden="true"></span>
                  <span><strong>Ground Plane</strong><small data-i18n="scene.groundMeta">環境</small></span>
                  <i class="state-dot" data-i18n-aria-label="scene.visible" aria-label="表示中"></i>
                </div>
              </section>
              <section class="tree-section">
                <div class="tree-group"><span data-i18n="scene.lights">ライト</span><b data-light-count>2</b></div>
                <div class="tree-item">
                  <span class="tree-icon light-icon" aria-hidden="true"></span>
                  <span><strong>Ambient Light</strong><small data-i18n="scene.ambientMeta">補助光</small></span>
                  <i class="state-dot" data-i18n-aria-label="scene.enabled" aria-label="有効"></i>
                </div>
                <div class="tree-item">
                  <span class="tree-icon light-icon is-key" aria-hidden="true"></span>
                  <span><strong>Key Light</strong><small data-i18n="scene.directionalMeta">平行光</small></span>
                  <i class="state-dot" data-i18n-aria-label="scene.enabled" aria-label="有効"></i>
                </div>
              </section>
              <section class="tree-section">
                <div class="tree-group"><span data-i18n="scene.camera">カメラ</span><b>1</b></div>
                <div class="tree-item">
                  <span class="tree-icon camera-icon" aria-hidden="true"></span>
                  <span><strong data-i18n="scene.perspective">透視投影</strong><small>45° FOV</small></span>
                </div>
              </section>
            </nav>
            <div class="model-note">
              <b>01</b><p><strong data-i18n="scene.modelNoteTitle">SceneModelが正本</strong><span data-i18n="scene.modelNoteBody">描画状態はモデルから生成されます。</span></p>
            </div>
          </aside>

          <section class="viewport-panel" data-i18n-aria-label="viewport.panelLabel" aria-label="3Dビュー">
            <div class="viewport-toolbar">
              <div class="view-title"><i></i><span data-i18n="viewport.perspective">透視投影</span><small>45°</small></div>
              <div class="tool-cluster" data-i18n-aria-label="viewport.settingsLabel" aria-label="ビュー表示設定">
                <button class="tool-button is-active" data-action="grid" type="button" data-i18n-aria-label="viewport.gridLabel" aria-label="グリッド表示を切り替え" aria-pressed="true">
                  <i class="grid-glyph" aria-hidden="true"></i><span data-i18n="viewport.grid">グリッド</span>
                </button>
                <button class="tool-button is-active" data-action="axes" type="button" data-i18n-aria-label="viewport.axesLabel" aria-label="座標軸表示を切り替え" aria-pressed="true">
                  <i class="axes-glyph" aria-hidden="true"></i><span data-i18n="viewport.axes">軸</span>
                </button>
                <button class="tool-button" data-action="reset" type="button" data-i18n-aria-label="viewport.resetLabel" aria-label="カメラを初期視点へ戻す">
                  <i class="reset-glyph" aria-hidden="true">↺</i><span data-i18n="viewport.reset">視点リセット</span>
                </button>
              </div>
            </div>
            <div class="viewport" data-viewport>
              <div class="loading-state" data-loading>
                <span class="loading-cube" aria-hidden="true"></span>
                <span data-loading-label data-i18n="viewport.loading">WebGLを初期化中</span>
              </div>
              <span class="world-label" data-i18n="viewport.world">ワールド / Y軸上向き</span>
              <div class="interaction-hint">
                <span data-i18n="viewport.rotateHint">左ドラッグ・回転</span><span data-i18n="viewport.panHint">右ドラッグ・移動</span><span data-i18n="viewport.zoomHint">ホイール・ズーム</span>
              </div>
            </div>
            <div class="viewport-statusbar">
              <span class="ready-status"><i></i><span data-status>初期化中</span></span>
              <span class="status-divider"></span><span>WEBGL · ACES</span>
              <span class="status-spacer"></span><span>DPR ≤ 2</span>
            </div>
          </section>

          <aside class="panel inspector-panel" data-i18n-aria-label="inspector.panelLabel" aria-label="設定パネル">
            <div class="panel-heading">
              <div><span class="eyebrow" data-i18n="inspector.eyebrow">インスペクター</span><h2 data-object-name>Box 01</h2></div>
              <span class="readonly-badge" data-i18n="inspector.readOnly">読み取り専用</span>
            </div>
            <div class="inspector-scroll">
              <section class="property-section">
                <div class="property-heading"><span data-i18n="inspector.transform">変形</span><i></i></div>
                <dl class="property-list">
                  <div><dt data-i18n="inspector.position">位置</dt><dd data-box-position>0.00, 1.00, 0.00</dd></div>
                  <div><dt data-i18n="inspector.rotationY">Y軸回転</dt><dd>−18.00°</dd></div>
                  <div><dt data-i18n="inspector.scale">拡大率</dt><dd>1.00, 1.00, 1.00</dd></div>
                </dl>
              </section>
              <section class="property-section">
                <div class="property-heading"><span data-i18n="inspector.boxGeometry">ボックス形状</span><i></i></div>
                <div class="metric-grid">
                  <div><span data-i18n="inspector.width">幅</span><strong data-box-width>2.00</strong><small>m</small></div>
                  <div><span data-i18n="inspector.height">高さ</span><strong data-box-height>2.00</strong><small>m</small></div>
                  <div><span data-i18n="inspector.depth">奥行き</span><strong data-box-depth>2.00</strong><small>m</small></div>
                </div>
              </section>
              <section class="property-section">
                <div class="property-heading"><span data-i18n="inspector.material">マテリアル</span><i></i></div>
                <div class="swatch-row"><i></i><span><strong>#5F8CFF</strong><small>MeshStandardMaterial</small></span></div>
                <dl class="property-list compact">
                  <div><dt data-i18n="inspector.roughness">粗さ</dt><dd>0.32</dd></div>
                  <div><dt data-i18n="inspector.metalness">金属度</dt><dd>0.08</dd></div>
                </dl>
              </section>
              <section class="property-section">
                <div class="property-heading"><span data-i18n="inspector.camera">カメラ</span><i></i></div>
                <dl class="property-list">
                  <div><dt data-i18n="inspector.position">位置</dt><dd data-camera-position>6.50, 5.20, 8.20</dd></div>
                  <div><dt data-i18n="inspector.target">注視点</dt><dd data-camera-target>0.00, 0.90, 0.00</dd></div>
                  <div><dt data-i18n="inspector.projection">投影方式</dt><dd data-i18n="inspector.perspective">透視投影</dd></div>
                </dl>
              </section>
              <div class="phase-card">
                <div><span data-i18n="phase.label">フェーズ</span><strong>01 / 09</strong></div>
                <h3 data-i18n="phase.title">ビュー基盤</h3>
                <p data-i18n="phase.description">カメラ、レンダラー、Orbit操作、グリッド、座標軸、初期ボックスを実装済みです。</p>
                <i><b></b></i>
              </div>
            </div>
          </aside>
        </main>

        <dialog class="manual-dialog" data-manual-dialog aria-labelledby="manual-title">
          <div class="manual-header">
            <div><span class="eyebrow">RENDER VIEWER 3D</span><h2 id="manual-title" data-i18n="manual.title">簡易マニュアル</h2></div>
            <form method="dialog">
              <button class="dialog-close" type="submit" value="close" data-i18n-aria-label="manual.closeLabel" aria-label="簡易マニュアルを閉じる">×</button>
            </form>
          </div>
          <div class="manual-body">
            <p class="manual-intro" data-i18n="manual.intro">3Dビューの基本操作と表示設定をまとめています。</p>
            <section>
              <h3><span>01</span><b data-i18n="manual.navigationTitle">カメラ操作</b></h3>
              <ul>
                <li data-i18n="manual.rotate">左ドラッグ：シーンの周囲を回転します。</li>
                <li data-i18n="manual.pan">右ドラッグ：視点を上下左右へ移動します。</li>
                <li data-i18n="manual.zoom">マウスホイール：ズームイン・ズームアウトします。</li>
                <li data-i18n="manual.reset">「視点リセット」：初期カメラ位置へ戻します。</li>
              </ul>
            </section>
            <section>
              <h3><span>02</span><b data-i18n="manual.displayTitle">表示設定</b></h3>
              <ul>
                <li data-i18n="manual.grid">「グリッド」で床面グリッドを表示・非表示にします。</li>
                <li data-i18n="manual.axes">「軸」でXYZ座標軸を表示・非表示にします。</li>
                <li data-i18n="manual.theme">太陽／月ボタンでライト・ダークテーマを切り替えます。</li>
              </ul>
            </section>
            <section>
              <h3><span>03</span><b data-i18n="manual.languageTitle">言語</b></h3>
              <p data-i18n="manual.language">「English」または「日本語」ボタンで表示言語を切り替えます。</p>
            </section>
            <section>
              <h3><span>04</span><b data-i18n="manual.shortcutTitle">閉じる操作</b></h3>
              <p data-i18n="manual.escape">Escキー、閉じるボタン、またはダイアログ外を選択すると閉じます。</p>
            </section>
          </div>
          <form class="manual-footer" method="dialog">
            <button type="submit" value="close" data-i18n="manual.close">閉じる</button>
          </form>
        </dialog>
      </div>
    `;
  }
}
