import { IMPORT_FILE_INPUT_ACCEPT } from "../importers";

export function appShellTemplate(): string {
    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-copy"><strong>RENDER VIEWER</strong><small data-i18n="brand.subtitle">パラメトリック3Dシーンツール</small></span></div>
          <div class="header-tools">
            <div class="header-meta"><span class="phase-badge" data-i18n="header.phase">フェーズ 5</span><span class="header-divider" aria-hidden="true"></span><span class="scene-name" data-scene-name>Lighting Study 01</span></div>
            <div class="header-actions" role="group" data-i18n-aria-label="header.controls" aria-label="表示と言語の設定">
              <button class="header-button" data-action="language" type="button"><i aria-hidden="true">文/A</i><span data-language-label>English</span></button>
              <button class="header-button" data-action="theme" type="button" aria-pressed="false"><i data-theme-icon aria-hidden="true">☀</i><span data-theme-label>ライト</span></button>
              <button class="header-button" data-action="manual" type="button" data-i18n-aria-label="manual.openLabel"><i aria-hidden="true">?</i><span data-i18n="manual.open">使い方</span></button>
            </div>
          </div>
        </header>

        <main class="workspace">
          <aside class="panel scene-panel" data-i18n-aria-label="scene.panelLabel">
            <div class="panel-heading scene-heading"><div><span class="eyebrow" data-i18n="scene.eyebrow">シーンモデル</span><h1 data-i18n="scene.title">シーン</h1></div><span class="schema-badge">JSON v2</span></div>
            <details class="primitive-menu">
              <summary data-i18n-aria-label="scene.addObjectLabel"><i aria-hidden="true">＋</i><span data-i18n="scene.addObject">オブジェクト追加</span><b aria-hidden="true">⌄</b></summary>
              <div class="primitive-grid">
                <button type="button" data-add-primitive="box"><i class="tree-icon cube-icon" aria-hidden="true"></i><span data-i18n="primitive.box">ボックス</span></button>
                <button type="button" data-add-primitive="sphere"><i class="tree-icon sphere-icon" aria-hidden="true"></i><span data-i18n="primitive.sphere">球</span></button>
                <button type="button" data-add-primitive="cylinder"><i class="tree-icon cylinder-icon" aria-hidden="true"></i><span data-i18n="primitive.cylinder">円柱</span></button>
                <button type="button" data-add-primitive="cone"><i class="tree-icon cone-icon" aria-hidden="true"></i><span data-i18n="primitive.cone">円錐</span></button>
                <button type="button" data-add-primitive="plane"><i class="tree-icon plane-icon" aria-hidden="true"></i><span data-i18n="primitive.plane">平面</span></button>
                <button type="button" data-add-primitive="torus"><i class="tree-icon torus-icon" aria-hidden="true"></i><span data-i18n="primitive.torus">トーラス</span></button>
              </div>
            </details>
            <nav class="scene-tree" data-i18n-aria-label="scene.structureLabel">
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.objects">オブジェクト</span><b data-object-count>0</b></div><div data-object-list></div></section>
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.lights">ライト</span><b data-light-count>0</b></div><div data-light-list></div></section>
              <section class="tree-section"><div class="tree-group"><span data-i18n="scene.camera">カメラ</span><b>1</b></div><div class="tree-item tree-item-static" data-camera-item><span class="tree-icon camera-icon" aria-hidden="true"></span><span><strong data-i18n="scene.perspective">透視投影</strong><small>45° FOV</small></span></div></section>
            </nav>
            <div class="model-note"><b>03</b><p><strong data-i18n="scene.modelNoteTitle">SceneModelが正本</strong><span data-i18n="scene.modelNoteBody">編集結果はモデルを経由して描画へ反映されます。</span></p></div>
          </aside>

          <section class="viewport-panel" data-i18n-aria-label="viewport.panelLabel">
            <div class="viewport-toolbar"><div class="view-title"><i></i><span data-view-projection data-i18n="viewport.perspective">透視投影</span><small data-view-fov>45°</small></div><div class="tool-cluster" data-i18n-aria-label="viewport.settingsLabel">
              <button class="tool-button import-tool-button" data-action="import" type="button" data-i18n-aria-label="import.openLabel"><i class="import-glyph" aria-hidden="true">↓</i><span data-i18n="import.open">Import Model</span></button>
              <button class="tool-button is-active" data-action="grid" type="button" data-i18n-aria-label="viewport.gridLabel" aria-pressed="true"><i class="grid-glyph" aria-hidden="true"></i><span data-i18n="viewport.grid">グリッド</span></button>
              <button class="tool-button is-active" data-action="axes" type="button" data-i18n-aria-label="viewport.axesLabel" aria-pressed="true"><i class="axes-glyph" aria-hidden="true"></i><span data-i18n="viewport.axes">軸</span></button>
              <button class="tool-button" data-action="reset" type="button" data-i18n-aria-label="viewport.resetLabel"><i class="reset-glyph" aria-hidden="true">↺</i><span data-i18n="viewport.reset">視点リセット</span></button>
            </div></div>
            <div class="viewport" data-viewport><div class="loading-state" data-loading><span class="loading-cube" aria-hidden="true"></span><span data-i18n="viewport.loading">WebGLを初期化中</span></div><div class="drop-overlay" data-drop-overlay aria-hidden="true"><span class="drop-overlay-glyph">↓</span><strong data-i18n="import.dropTitle">3D / CADモデルをドロップ</strong><small data-i18n="import.dropBody">ファイルはブラウザ内だけで処理されます。</small></div><div class="import-toast" data-import-status role="status" aria-live="polite" hidden></div><span class="world-label" data-i18n="viewport.world">ワールド / Y軸上向き</span><div class="interaction-hint"><span data-i18n="viewport.rotateHint">左ドラッグ・回転</span><span data-i18n="viewport.panHint">右ドラッグ・移動</span><span data-i18n="viewport.zoomHint">ホイール・ズーム</span></div></div>
            <div class="viewport-statusbar"><span class="ready-status"><i></i><span data-status>初期化中</span></span><span class="status-divider"></span><span>WEBGL · ACES</span><span class="status-spacer"></span><span>DPR ≤ 2</span></div>
          </section>

          <aside class="panel inspector-panel" data-i18n-aria-label="inspector.panelLabel">
            <div class="panel-heading"><div><span class="eyebrow" data-i18n="inspector.eyebrow">インスペクター</span><h2 data-inspector-title>未選択</h2></div><span class="readonly-badge" data-inspector-badge>未選択</span></div>
            <div class="inspector-scroll" data-inspector-body></div>
          </aside>
        </main>

        <input class="visually-hidden" data-import-file-input type="file" accept="${IMPORT_FILE_INPUT_ACCEPT}" multiple tabindex="-1">
        <dialog class="import-dialog" data-import-dialog aria-labelledby="import-dialog-title">
          <form method="dialog" class="import-dialog-card" data-import-options-form>
            <div class="import-dialog-header"><div><span class="eyebrow" data-i18n="import.eyebrow">3D / CAD FILES</span><h2 id="import-dialog-title" data-i18n="import.title">Import model</h2></div><button class="dialog-close" type="submit" value="cancel" data-i18n-aria-label="import.cancelLabel">×</button></div>
            <p class="import-dialog-intro" data-i18n="import.description">Choose a model and normalization options. Processing stays in your browser.</p>
            <section class="import-supported"><h3 data-i18n="import.supportedFormats">Supported formats</h3><ul data-import-formats></ul></section>
            <div class="import-option-grid">
              <label><span data-i18n="import.unit">Unit</span><select data-import-unit name="import-unit"><option value="auto" data-i18n="import.unitAuto">Auto</option><option value="millimeter">mm</option><option value="centimeter">cm</option><option value="meter">m</option><option value="inch">in</option><option value="foot">ft</option></select></label>
              <label><span data-i18n="import.coordinate">Coordinate system</span><select data-import-coordinate name="import-coordinate"><option value="auto" data-i18n="import.coordinateAuto">Auto</option><option value="y-up">Y-Up</option><option value="z-up">Z-Up</option></select></label>
            </div>
            <div class="import-checks">
              <label><input type="checkbox" data-import-center checked><span data-i18n="import.center">Center model</span></label>
              <label><input type="checkbox" data-import-ground checked><span data-i18n="import.ground">Place on ground</span></label>
            </div>
            <fieldset class="import-quality"><legend data-i18n="import.quality">Triangulation quality</legend>
              <label><input type="radio" name="import-quality" value="low"><span data-i18n="import.qualityLow">Low</span></label>
              <label><input type="radio" name="import-quality" value="medium" checked><span data-i18n="import.qualityMedium">Medium</span></label>
              <label><input type="radio" name="import-quality" value="high"><span data-i18n="import.qualityHigh">High</span></label>
            </fieldset>
            <div class="import-dialog-note"><strong data-i18n="import.sidecarsTitle">Sidecar files</strong><span data-i18n="import.sidecarsBody">For glTF, select referenced .bin and image files with the model; for FBX and COLLADA / DAE, also select referenced image files.</span></div>
            <div class="import-dialog-actions"><button class="secondary-action" type="submit" value="cancel" data-i18n="import.cancel">Cancel</button><button class="primary-action" type="button" data-action="choose-import-files"><span data-i18n="import.chooseFiles">Choose files</span></button></div>
          </form>
        </dialog>

        <dialog class="manual-dialog" data-manual-dialog aria-labelledby="manual-title">
          <div class="manual-header"><div><span class="eyebrow">RENDER VIEWER 3D</span><h2 id="manual-title" data-i18n="manual.title">簡易マニュアル</h2></div><form method="dialog"><button class="dialog-close" type="submit" value="close" data-i18n-aria-label="manual.closeLabel">×</button></form></div>
          <div class="manual-body">
            <p class="manual-intro" data-i18n="manual.intro">オブジェクト、マテリアル、3Dビュー操作の要点をまとめています。</p>
            <section><h3><span>00</span><b data-i18n="manual.projectTitle">保存・履歴・ビューの機能</b></h3><ul><li data-i18n="manual.projectSave"></li><li data-i18n="manual.projectRecover"></li><li data-i18n="manual.projectHistory"></li><li data-i18n="manual.viewportTools"></li></ul></section>
            <section><h3><span>01</span><b data-i18n="manual.sceneTitle">オブジェクト操作</b></h3><ul><li data-i18n="manual.addPrimitive">「オブジェクト追加」から6種類の形状を追加できます。</li><li data-i18n="manual.selectObject">一覧または3Dビューでオブジェクトを選択します。</li><li data-i18n="manual.visibility">一覧右端で表示を切り替えます。</li></ul></section>
            <section><h3><span>02</span><b data-i18n="manual.editTitle">インスペクター</b></h3><ul><li data-i18n="manual.editName">名前を編集すると一覧にも反映されます。</li><li data-i18n="manual.editTransform">位置・回転・拡大率をXYZごとに編集できます。</li><li data-i18n="manual.editGeometry">形状固有の寸法や分割数を編集できます。</li><li data-i18n="manual.duplicateDelete">複製と削除は下部から実行します。</li></ul></section>
            <section><h3><span>03</span><b data-i18n="manual.materialTitle">マテリアル</b></h3><ul><li data-i18n="manual.materialOpen">オブジェクトを選択し、インスペクターからライブラリを開きます。</li><li data-i18n="manual.materialSearch">名前・タグ・POV-Rayキーワードで検索できます。</li><li data-i18n="manual.materialAssign">マテリアルを選択中のオブジェクトへ割り当てます。</li><li data-i18n="manual.materialShared">共有変更は使用中の全オブジェクトへ反映されます。</li><li data-i18n="manual.materialStatus">対応状況でWebGLプレビューとの関係を確認できます。</li><li data-i18n="manual.materialAdvanced">詳細タブではPOV-Ray材料特性を一覧できます。</li><li data-i18n="manual.materialDisclaimer">WebGL表示はPOV-Rayレンダリングそのものではありません。</li></ul></section>
            <section><h3><span>04</span><b data-i18n="manual.shortcutsTitle">編集ショートカット</b></h3><ul><li data-i18n="manual.shortcutModes">W：移動、E：回転、R：拡大縮小。</li><li data-i18n="manual.shortcutDuplicate">Ctrl/Cmd + D：複製。</li><li data-i18n="manual.shortcutDelete">Delete / Backspace：削除。</li><li data-i18n="manual.shortcutInput">入力・ボタン操作中は無効です。</li></ul></section>
            <section><h3><span>05</span><b data-i18n="manual.navigationTitle">カメラ操作</b></h3><ul><li data-i18n="manual.rotate">左ドラッグ：回転。</li><li data-i18n="manual.pan">右ドラッグ：移動。</li><li data-i18n="manual.zoom">ホイール：ズーム。</li><li data-i18n="manual.reset">視点リセット：初期位置へ戻します。</li></ul></section>
            <section><h3><span>06</span><b data-i18n="manual.displayTitle">表示設定</b></h3><ul><li data-i18n="manual.grid">グリッドを切り替えます。</li><li data-i18n="manual.axes">XYZ軸を切り替えます。</li><li data-i18n="manual.theme">ライト・ダークテーマを切り替えます。</li></ul></section>
            <section><h3><span>07</span><b data-i18n="manual.languageTitle">言語と閉じ方</b></h3><ul><li data-i18n="manual.language">English / 日本語で言語を切り替えます。</li><li data-i18n="manual.escape">Esc、閉じる、またはダイアログ外で閉じます。</li></ul></section>
          </div>
          <a class="manual-license-link" href="${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener noreferrer" data-i18n="manual.thirdPartyLicenses">第三者ライセンス・著作権表示</a>
          <form method="dialog" class="manual-footer"><button type="submit" value="close" data-i18n="manual.close">閉じる</button></form>
        </dialog>
      </div>
    `;
  }
