# Render Viewer 3D：リファクタリング調査・追加機能の作業計画

調査日：2026-09-07（日本時間）

対象：`eb75164fe1d6e71311d7913810d509e13e319b79`

状態：**R1〜R6、F1〜F12の提供機能を実装し、独立レビューと確定版の検証（単体293件・E2E48件・公開用build15件）が成功しました。PR／Pagesの追跡先は実装・検証記録に記載します。**

本書の調査根拠・工数・優先順位は計画作成時点の記録として残します。現在の実装・採用判断・検証証拠は[実装・検証記録](./IMPLEMENTATION_VALIDATION.md)を参照してください。W7〜W9の条件付き項目は、STL Workerを採用し、BVH／LOD／mesh簡略化等は診断・実利用計測後の判断として未採用です。

## 1. 結論

**リファクタリングは一部に必要。既存の分離構成を維持して段階的に改善する。**

`model → Store → Three.js Adapter`、Importer Registry、画像・モデルのruntime asset管理、STEPのWorker化は既にある。全面的な再実装やUIフレームワークへの移行を優先する根拠は見つからなかった。

優先する改善は、UI責務の分割、静止中の描画停止、変更範囲に応じた状態・DOM更新、保存とUndoに対応するasset寿命管理である。追加機能は **プロジェクト保存・復元、Undo／Redo、PNG出力** から進める。次にGLB出力、圧縮glTF対応、CAD向けの確認機能を検討する。

これはコードの静的調査とWebの一次資料を組み合わせた提案である。ファイル行数だけで品質を判定しておらず、性能低下量や消費電力削減率は未計測。工数・優先順位は本アプリへの適用判断であり、参照資料が本アプリを評価したものではない。

## 2. 現状と維持する設計

| 確認対象 | 現状 | 判断 |
| --- | --- | --- |
| `package.json`、`tsconfig.json` | TypeScript strict、Three.js、Vite。`npm test`、型検査、ビルドを用意 | 型検査を維持。調査だけを理由に依存バージョンを変更しない |
| `src/app/`、`src/model/`、`src/three/` | 状態、モデル、描画の責務を分離 | 保存・履歴・出力もこの境界に沿って追加する |
| `src/importers/registry.ts`、`ImportManager.ts` | 形式登録とImporter選択を集約 | 形式追加のためにUIへ拡張子の分岐を増やさない |
| `src/three/imported-asset-store.ts`、`src/three/material/` | assetの所有権、再利用、破棄を実装 | 「解放処理がない」という指摘は該当しない。履歴を追加する際に所有権を拡張する |
| `src/ui/scene-editor-view.ts`、既存cacheテスト | Tree・Inspectorの再構築抑制を実装 | 既存cacheと入力中のフォーカス保持を維持する |
| `tests/`、`.github/workflows/` | 36個のテストファイル。モデル、Importer、fixture、材質、resource解放等を検証。CIでテストとビルド | 単体テストは既存資産を活用。実ブラウザの描画・操作を別途補う |
| `README.md`の現在の制限 | 保存、出力、履歴UI、子node編集、圧縮glTF、animation再生UI等がない | 実装済み機能と重複しない候補を選ぶ |

## 3. リファクタリング候補

優先度はP1＝直近、P2＝次段階、P3＝計測や利用目的に応じて実施。重大障害を再現したという意味ではない。

### R1：UIの責務分割（P1）

**根拠：** `src/ui/app-shell.ts`は1,220行で、イベント振り分け、ショートカット、import dialog、設定、テンプレートを扱う。`scene-editor-view.ts`は1,079行でTreeと各Inspectorを扱い、`material-library-view-base.ts`は967行で一覧、詳細、検索、入力同期、フォーカス復元を扱う。

**作業：** ImportDialog、ShortcutController、SceneTreeView、PrimitiveInspector、ImportedInspector、MaterialListView、MaterialDetailViewへ責務単位で分割する。`AppShell`は組み立て・更新通知に絞る。既に分離された`material-basic-editor.ts`等を再利用し、行数削減だけを目的とした細分化はしない。

**完了条件：** 日英切替、ダイアログ、連続入力、選択、複製直後の名称入力が同じ動作を保つ。既存cache・フォーカス試験が通り、実ブラウザでキーボード操作も通る。分割方針はコードの責務に基づく本調査の判断。

### R2：変更時描画へ移行（P1）

**根拠：** `src/three/scene-adapter.ts:95`で常時`setAnimationLoop`を開始し、244行目の`#render()`が毎回描画する。208行目ではOrbitControlsのdampingを無効にしている。静止した編集画面でも描画が続く構造である。

**作業：** `requestRender()`で次の1フレームへ要求をまとめる。モデル変更、OrbitControls変更、TransformControlsの操作・hover、選択、resize、画像decode完了、環境変更、画面復帰で再描画する。将来のanimation再生中だけ連続描画を有効にする。

**完了条件：** 静止後10秒間の追加renderが0回になる（明示的な外部イベントを除く）。ドラッグ・hover・テクスチャ反映が途切れない。通常画面と非表示タブからの復帰を確認する。変更時描画はThree.js公式が3Dエディター向けの用途として説明している。[公式資料](https://threejs.org/manual/en/rendering-on-demand.html)

### R3：変更範囲に応じた状態・DOM更新（P1の計測、最適化は結果次第）

**根拠：** `src/app/scene-store.ts:19`はすべての更新で`structuredClone`→deep freeze→全listener通知を行う。値が変わらないrecipeも通知する。材質の入力イベントからこの経路へ到達する。`material-library-view-base.ts:164`以降は各renderでカテゴリ・プリセット・一覧を更新し、390行目以降は一覧DOMを作り直す。詳細側・Scene Tree側には既存の再構築抑制がある。

**作業：** まずオブジェクト数、import階層数、材質数を変えて計測する。no-op通知抑制、操作中のpreviewと確定commitの区別、変更領域の通知、材質使用数の索引、一覧行の再利用を順に検討する。構造共有を採用する場合も不変snapshot契約は維持する。

**完了条件：** カメラだけの変更で材質一覧を再生成しない。同値更新で不要な通知をしない。変更前snapshotが不変である。固定fixture・同一端末で入力処理時間の中央値とp95を比較し、改善を実測できた変更だけを採用する。全体コピーにはGPU geometry実体を含まないため、モデルファイル容量に比例するコピーと断定しない。

### R4：操作履歴とasset寿命の境界を整備（P1、保存・Undoの前提）

**根拠：** `src/app/create-application.ts`で各操作を直接Storeへ接続している。`src/three/imported-scene-adapter.ts`は使用されなくなったassetを削除し、`ImportedAssetStore.delete()`はgeometry・material等をdisposeする。現在の削除動作として妥当だが、以前のSceneModelだけを戻してもUndoは成立しない。

**作業：** 編集操作をtransactionとしてまとめ、履歴対象、まとめ方、asset参照を定義する。現シーン・Undo・Redo・進行中処理が参照するassetを管理する。GPU常駐を無制限に保持せず、元ファイル等から再構成する方針とCPU/GPUの容量上限を定める。

**完了条件：** import削除→Undo、画像差替え→Undo、新しい操作によるRedo破棄、履歴上限超過、非同期import中の操作で欠落や二重解放が起きない。Three.js resourceは明示的なdisposeが必要で、履歴に残すモデルと実体の寿命を分ける設計が必要になる。[公式Cleanup](https://threejs.org/manual/en/cleanup.html)／[公式EditorのHistory実装](https://github.com/mrdoob/three.js/blob/master/editor/js/History.js)

### R5：Importerの検査・解析・正規化の境界整理（P2）

**根拠：** `ThreeMFImporter.ts`は903行でZIP/XML検査と形式処理を扱う。既に`zip-preflight.ts`等は分離済み。`assertRenderableGeometryBudget`はPLY／FBX／DAE／3MFから呼ばれる一方、GLTF／OBJ／STLからは呼ばれない。これらにも入力byte上限はあるが、同一の解析後node・geometry上限にはなっていない。STEPは別途Workerの出力上限を持つ。

**作業：** 3MFのXML／関係／mesh検査を副作用の少ない関数へ分割する。各Importerの入力・展開・出力上限、失敗時破棄を一覧化し、GLTF／OBJ／STLへ共通の解析後検査を適用できるか検証する。形式特有の単位・軸変換は維持する。Workerへの移行は計測後、DOM依存の少ない形式から試作する。

**完了条件：** 上限内fixtureは成功し、超過fixtureは理由を表示して終了する。解析失敗・中断後にassetが残らない。単位・軸補正が二重適用されない。解析後検査だけでは解析中のピークメモリやUI停止を防げないため、事前検査・Worker化と区別して記録する。WorkerはDOMを直接操作できず、通常のmessageはコピーされるので、Three.jsインスタンスの丸ごと転送を前提にしない。[MDN Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)

### R6：ブラウザ検証とテスト登録の改善（P1）

**根拠：** `package.json`は36テストファイルを明示列挙している。既存テストにはVite経由のモジュール読込、linkedom、fixture検証があるが、Playwright等の実ブラウザE2E構成はない。Node上の試験だけではWebGL描画、ファイル選択、Worker/WASM読込、ダウンロードを通しで確認できない。

**作業：** 既存テストは維持し、テスト追加の登録漏れを防ぐ列挙スクリプト等を検討する。PlaywrightでVite起動と連携し、起動・選択・Transform・ローカルimport・テクスチャ・PNG／保存復元の最小E2Eを段階追加する。[Playwright Web server](https://playwright.dev/docs/test-webserver)

**完了条件：** テスト追加が自動検出される。GitHub Pagesのbase配下でJS／Worker／WASM／decoderが読み込める。まずChromium、続いてFirefoxとWebKitを対象とし、STEPは実際の対応環境でも手動確認する。WebKitの自動試験のみで実機Safari互換を保証しない。

## 4. 有効な追加機能

表の優先度は、編集内容の保全と既存機能の活用を重視した提案。新形式の大量追加より、現在の編集・importを保存して再利用できることを優先する。

| ID | 優先度 | 機能と利用価値 | 実装方針・制約・Web根拠 |
| --- | --- | --- | --- |
| F1 | P1・最優先 | **プロジェクト保存・復元／自動保存**：再読み込み後も編集を続けられる | SceneModel、元モデルとsidecar、材質画像、import設定をまとめる。IndexedDBは構造化データとBlobを扱える。ブラウザ保存は容量不足・消去があるため、明示的なファイル出力も提供する。[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)／[容量・消去](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) |
| F2 | P1 | **Undo／Redo**：削除・Transform・材質編集を戻せる | コマンドまたはtransaction履歴。スライダー1操作や1ドラッグを1履歴にまとめる。入力欄の文字編集とショートカットが衝突しないようにする。assetの保持・再生成が前提。[Three.js Editor History](https://github.com/mrdoob/three.js/blob/master/editor/js/History.js) |
| F3 | P1 | **PNG出力**：レビュー資料・記録に使える | 最初は現在のViewport解像度を出力。直前に描画して`canvas.toBlob()`を使う。Grid／Axes／gizmoの含有を選べるようにする。高解像度・透明背景は後続。常時`preserveDrawingBuffer`を有効にする必要はない。[公式Screenshot解説](https://threejs.org/manual/en/tips.html) |
| F4 | P2 | **GLB出力**：他の3Dソフトへ編集結果を渡せる | `GLTFExporter`を必要時に読み込む。object／mesh／標準材質・animationの対応範囲を決め、helpersを除外する。POV-Ray概念、プリミティブ編集パラメータ、全アプリ設定の完全保存は専用project形式で行う。[GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html) |
| F5 | P2 | **Draco／Meshopt／KTX2対応**：圧縮された実用glTFを開ける | GLTFLoaderへdecoderを接続し、必要なWASM等を同梱する。KTX2にはrenderer能力判定を組み込む。外部CDNを使わない方針と入力resource拒否を保ち、展開後geometry・画像の予算も追加する。[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html) |
| F6 | P2 | **正投影・標準視点・再Fit**：形状・寸法を確認しやすい | 現在のPerspectiveのみのCameraModelを拡張し、正面／側面／上面・選択物へのFitをUI化する。読み込み直後のAuto Fitは既にあるので新規扱いしない。[OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html) |
| F7 | P2 | **断面表示・2点間計測**：内部形状や大きさを確認できる | clipping planeとRaycasterのworld-space交点を使う。内部meter、表示mm等を明示する。最初は断面の蓋なし・mesh上の2点距離とする。STEPも三角形化した表面上の計測であり、B-Repの厳密計測とは区別する。[Material clippingPlanes](https://threejs.org/docs/pages/Material.html#clippingPlanes)／[Raycaster](https://threejs.org/docs/pages/Raycaster.html) |
| F8 | P2 | **子node選択・隔離表示・材質変更**：部品ごとに確認できる | 既存のimport階層表示を操作へ拡張する。再読込で対応が保てるnode IDとroot／node二層の選択を設計する。raycastの再帰探索は利用できるが、ID永続化と親子Transformはアプリ側の仕事。[Raycaster](https://threejs.org/docs/pages/Raycaster.html) |
| F9 | P2 | **animation再生・停止・シーク・速度**：既に保持しているclipを閲覧できる | `AnimationMixer`をasset単位で管理する。再生時のみ連続描画。clip終了・削除時に停止とuncacheを行う。通常の編集Transformとanimationが上書きし合わない状態管理を用意する。[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html) |
| F10 | P2 | **ライト・露出編集、ローカルHDRI、normal／roughness等の画像編集**：材質の見え方を調整できる | 最初は既存Ambient／Directional Lightの色・強度・位置と露出編集。その後に環境とPBR画像channelを拡張する。色画像と数値データ画像のcolor spaceを区別し、GPUメモリ上限を保つ。高機能な物理材質は描画負荷も増える。[MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html) |
| F11 | P2 | **OBJ＋MTL対応**：既存OBJデータの外観を改善できる | 同時選択されたMTL／textureをLocalResourceResolverで解決する。相対参照と欠落を検証する。MTLからPBRへの変換は近似である旨を表示する。[MTLLoader](https://threejs.org/docs/pages/MTLLoader.html) |
| F12 | P3 | **大規模データ向け診断・品質設定**：重いモデルで原因と調整方法が分かる | draw call、triangle、geometry／texture数、取込時間を表示し、影・pixel ratioを切替可能にする。renderer.infoはGPUメモリbyteの完全な測定ではない。BVH／LOD／簡略化はボトルネックを実測後に個別評価する。[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) |

## 5. 作業計画

工数は担当者1名の実装・関連テスト・文書更新を含む概算人日。大規模fixtureの入手、対象端末数、既存試験の失敗調査で変わる。確約日程ではなく、W0後に再見積もりする。

| 作業 | 依存 | 目安 | 成果物・受入条件 |
| --- | --- | --- | --- |
| W0：基準状態の記録 | なし | 1〜2日 | テスト・型検査・ビルド結果、固定fixture、端末・ブラウザ・性能測定手順を記録。最小E2Eの土台を作る |
| W1：UI分割と操作境界 | W0 | 3〜5日 | R1。既存DOM cache・フォーカス・日英表示の回帰なし。保存・履歴操作を追加できるinterfaceを定める |
| W2：描画と更新の改善 | W0。W1との変更範囲を調整 | 2〜4日 | R2を実装。R3は計測で必要性を確認した範囲だけ変更。静止render停止、入力p95比較を記録 |
| W3：project形式・asset参照の設計 | W0、W1 | 2〜3日 | schema、manifest、import元と画像の保存、検証・migration、asset寿命を文書化。小さいround-trip試作を作る |
| W4：手動保存・復元 | W3 | 4〜7日 | F1の手動保存。primitive＋材質画像＋glTFとsidecar＋STEPで復元し、復元失敗時は元シーンを保つ |
| W5：Undo／Redo | W3。全asset復元はW4を利用 | 3〜5日 | F2、R4。複製・削除・Transform・材質・import操作を戻せる。履歴上限、Redo破棄、非同期競合を試験 |
| W6：自動保存とPNG | 自動保存はW4、PNGはW2 | 2〜4日 | IndexedDBへ変更確定後に保存し、保存中／保存済み／失敗を表示。PNGの寸法・非空画像・helper切替を確認 |
| W7：GLB出力とimport改善 | W0、W4。出力と復元の境界を共有 | 4〜7日 | F4、F5、F11とR5のうち選んだ項目を小さなPRに分ける。全部入りの固定工数ではなく、優先項目を選んで再見積もり |
| W8：CAD確認・階層・再生・外観 | W1〜W5でできた基盤 | 選択機能ごとに2〜6日、子node編集は5〜10日 | F6〜F10を利用目的に合わせ順次実装。計測精度、親子Transform、再生と編集の関係を個別に検証 |
| W9：性能拡張 | W2、R5の計測結果 | 調査1〜2日後に見積もり | F12、Worker追加、必要ならBVH／LOD。採用判断に測定値と追加依存のコストを残す |

**最初の提供単位：W0〜W6。** 目安17〜30人日。保存・復元を早期に提供し、続いてUndoと自動保存を加える。W7以降は別の提供単位として扱う。R3の広範なStore置換や全ImporterのWorker移行を最初の提供条件にしない。

### 5.1 保存・復元の具体的な仕様作業

以下のチェックは設計・実装の完了を表します。混在projectの最終ブラウザ検証は5.3と実装・検証記録で別管理します。

- [x] project containerのversionとSceneModelのschemaVersionを区別し、既存v1→v2材質migrationとの整合を確認する。
- [x] manifest、SceneModel、モデル元ファイル、sidecar、材質画像、importオプション、importerバージョン情報の対応を設計する。
- [x] 元ファイルはBlob等の永続化可能な形で保持し、Object URLやThree.js instanceを保存形式に含めない。
- [x] 元ファイルを再importして復元する方式を基本に試作する。保存済みのroot Transformを復元するとき、単位・軸・中央寄せ・接地の補正を二重に適用しない。
- [x] 将来のimporter変更で結果が変わるリスクを記録する。正規化mesh cacheを併用する場合も、元ファイルと編集パラメータを失わない。
- [x] 読込データの型、有限数値、ID重複、material／asset参照、件数、容量、未知のschema versionを検証する。ZIP採用時は展開上限・entry path・重複を検査する。
- [x] 別の一時Store／asset領域へ復元して検証後に切り替える。失敗時は元の作業内容と選択を保つ。
- [x] 自動保存は変更確定後に間隔をまとめて行い、容量超過や保存不可を表示する。ブラウザ保存の消去に備えてファイル保存を提供する。

IndexedDBの非同期保存とBlob対応を利用し、quotaやevictionを前提に復旧可能な導線を用意する。[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)／[Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

### 5.2 Undo／Redoの具体的な仕様作業

- [x] camera操作・選択・表示設定のうち履歴に含めるものを明文化する。毎フレームのcamera変化は履歴にしない。
- [x] 数値入力、slider、gizmoは開始〜確定を1 transactionにする。Escによる中止で元値に戻せるようにする。
- [x] importや画像読込は成功時に1操作として確定し、完了の遅い古い処理がUndo後に書き戻さないようgeneration／abortと接続する。
- [x] history entryが参照するasset IDを列挙し、履歴件数と総保持byteの両方へ上限を設ける。
- [x] import削除→Undo→Redo、画像差替え→Undo、材質override→Undoで外観と参照が戻ることを試験する。共有材質の複製・参照は既存モデル試験と不変snapshotの履歴試験で確認する。
- [x] 新しい操作を行ってRedoを破棄した際、不要assetが解放されることを確認する。

### 5.3 共通の検証・完了条件

- [x] `npm ci`、`npm test`、`npm run typecheck`、`npm run build`が対象のNode環境で成功する。
- [x] 初期シーン、小〜中規模mesh、深い階層、多材質、テクスチャ、point cloud、skinned animation、STEPのfixtureを用意する（形式別の生成fixtureを含む）。
- [x] 日英・light／dark・入力フォーカス・ショートカット・file input・ドラッグ＆ドロップを実ブラウザで確認する。
- [x] import／削除／Undo／履歴破棄を反復し、warm-up後のresource数が増え続けないことを調べる。rendererの内部cacheがあるため絶対ゼロは要求しない。
- [x] 静止render回数、入力処理p95、import時間、ピークの推定メモリ、buildのchunkサイズを同じ条件で比較する。メモリは固定STL fixtureの同期／Worker解析についてRSSをサンプリングし、厳密なGPU heap測定とは区別する。
- [x] 外部resource URI拒否とローカル処理方針を維持する。decoderはPagesのbase配下から取得し、モデルを外部送信しない。
- [x] `README.md`、`CAD_IMPORT_ARCHITECTURE.md`、必要なら`POVRAY_MATERIAL_COVERAGE.md`と第三者ライセンスを実装内容に合わせて更新する。

性能比較は静止render、Store／DOM処理、parser時間、chunkサイズとブラウザprocessの推定ピークRSSについて完了しました。メモリの測定条件・限界は実装・検証記録に記載しています。実機Safari／モバイルGPUでの手動確認は、3ブラウザ自動試験とは区別します。

## 6. 当面の優先対象にしないもの

- **UIフレームワークへの全面移行**：現在の分離とテストを生かした改修で対応可能。移行だけでは保存やUndoのasset問題を解決しない。
- **IFC／DXF／IGES等の一括追加**：既存資料にもある通り、BIM属性、2D要素、parserの対応範囲が異なる。利用する実データが決まってから個別に調査する。
- **POV-Rayとの完全互換**：現在は概念プロファイル保持とWebGLプレビュー。SDL入出力・外部renderer連携は別プロジェクト規模の仕様検討として扱う。
- **WebGPU全面移行・高負荷なポスト処理**：現在のWebGL表示を維持し、性能・画質要件を計測してから評価する。
- **クラウド共有・共同編集**：現在のローカル完結という用途から優先度を下げる。追加する場合は保存形式を固めた後に検討する。

## 7. 調査時点の検証記録（実装前の基準値）

ソースコード、README、既存設計資料、36テストファイルの構成、CI定義を確認した。Three.js公式、Three.js公式リポジトリ、MDN、Playwright公式をWebで参照した。リンク先の最新版とロックされた依存バージョンのAPI差分は、各機能の実装開始時に確認する。

実行環境：Node.js v22.18.0、npm 10.9.3。初回の依存取得はネットワーク名前解決エラー（`registry.npmjs.org`の`ENOTFOUND`）で失敗したが、ネットワーク利用可能な実行で再試行して成功した。依存取得時は`--ignore-scripts --no-audit --no-fund`を指定した。依存バージョンとロックファイルは変更していない。

| 確認 | 結果 |
| --- | --- |
| `npm test` | **248件成功、失敗0、skip 0**。約2.20秒 |
| `npm run build`のprebuild | **`tsc --noEmit`成功**。独立した`npm run typecheck`の重複実行はしていない |
| `npm run build` | **成功**。Viteのビルド部分は約1.33秒 |
| bundle | メインJS 964.75 kB、gzip 256.47 kB。500 kB超過のchunk警告あり |
| STEP用WASM出力 | 22,196.78 kB、gzip 7,085.17 kB。ファイル出力サイズであり、起動時に全量取得したという測定ではない |
| ファイル差分 | 本Markdownを追加。アプリのソース・設定・依存定義は変更していない |

chunk警告はビルド失敗ではない。追加の改善候補としてW0／W9で初回読込とimport時のnetwork waterfallを測り、必要な機能のdynamic import境界を評価する。ファイルを分割しただけで初回転送量が減るとは限らず、既に遅延読込される形式やSTEPのWASMと区別する。

ブラウザの実操作、GPU性能測定、全形式の実機相互運用は今回の調査では未実施。これらはW0以降の作業であり、本書の提案を実装済み・性能実証済みとは扱わない。


## 8. 実装後の確認先

- 実装マトリクス、条件付き未採用項目、最終テスト／PR／公開記録：[IMPLEMENTATION_VALIDATION.md](./IMPLEMENTATION_VALIDATION.md)
- UI不変更新の固定fixture比較：[UI_REFACTOR_BENCHMARK.md](./UI_REFACTOR_BENCHMARK.md)
- 使い方・保存形式・制限：[README](../README.md)

上記5.3の実測・実機条件は、個別の単体試験だけで完了扱いにしません。最終バッチの対象・結果を記録した時点でチェックを更新します。
