# Render Viewer 3D

TypeScript・Three.js・Viteによる、ブラウザ内で3Dプリミティブと外部3D / CADモデルを編集・確認するアプリです。保存・復元、Undo／Redo、画像・GLB出力、部品確認、圧縮glTF、アニメーション、照明・PBR画像編集を提供します。

[公開ページ](https://takayuki-minagawa.github.io/Render-Viewer-3D/)

## できること

- Box / Sphere / Cylinder / Cone / Plane / Torusの追加、名称・寸法・位置・回転・拡大率の編集、複製・削除。
- Scene Treeと3Dビューからの選択、TransformControls、OrbitControls、Grid／Axes切替。
- 共有マテリアルの作成・検索・割当・複製・個別化、使用中材質の削除防止、8種類のプリセット。
- ローカル画像によるbase color／normal／roughness／metalness／AOマップ、繰返し・オフセット・回転・端処理。
- `.rv3d`プロジェクト保存・復元とIndexedDB自動保存。元モデル、sidecar、材質画像、HDR環境も保存。
- Undo／Redo。数値・名称入力、slider、gizmoの連続操作をまとめ、Escで編集中の操作を取消。
- 現在のViewport解像度でPNG出力、標準mesh・材質・animationのGLB出力。
- 透視／正投影、正面・背面・左右・上下・斜めの標準視点、選択物を画面に収めるFit。
- 蓋なし断面表示、mesh表面の2点間距離計測。内部単位はm、表示はmm／cm／m。
- 読込モデルの子node選択、表示指定、隔離、子孫へ継承する材質上書き。
- 読込clipの選択、再生・一時停止・解除、シーク、速度変更。
- Ambient／Directional Lightの色・強度・位置、露出、ローカルRadiance RGBE `.hdr`環境の編集。
- Draw call・triangle・geometry／texture数・import時間の表示、描画倍率・影の切替。
- 日本語／English、ダーク／ライトテーマ、簡易マニュアル。

描画は変更時に要求をまとめて行い、静止中の連続描画を止めます。animation再生中は連続描画します。

## 保存・復元と操作履歴

画面上部の「プロジェクト保存」で`.rv3d`をダウンロードし、「開く」で復元します。形式はversion付きmanifestと元ファイルのバイナリをまとめたコンテナです。最大512 MiB、manifest最大16 MiB、内包ファイル最大4,096件・1件128 MiBです。SHA-256、容量、型、数値、ID、参照を検査し、未知のversionや不正な参照を拒否します。コンテナversion 1とSceneModelのschemaVersionは別管理です。

元モデルを保存済みのimport設定で再解析し、別のruntime領域へ準備してからシーンを切り替えます。正規化済みモデルの外側へ編集Transformを戻すため、単位・軸補正を二重適用しません。復元失敗時は元シーンを維持します。準備領域はモデル・画像・HDRの展開後推定量を合計512 MiBに制限します。これはコンテナ容量とは別の上限で、解析中の一時領域や退避中の旧シーンを含む総メモリ上限ではありません。将来のImporter変更によって再解析結果が変わる可能性はあり、manifestにImporter版を記録します。任意のThree.js instanceやObject URLをファイルへ保存する形式ではありません。

自動保存は変更が確定して約800 ms後にIndexedDBへまとめて書き込みます。次回起動時に自動では開かず、「自動保存から復元」を押して復元します。保存中・保存済み・失敗を表示します。ブラウザ保存は利用環境の容量制限やデータ消去の影響を受けるため、持ち出し・長期保管には明示的な`.rv3d`保存を使います。

履歴は最大50件、現在のシーンに加えて履歴だけが保持するassetとsnapshotの推定量256 MiBを目安に古い履歴を破棄します。現在のシーンに必要なassetはこの履歴削減で破棄しません。GPUの正確なbyte数を測った上限ではありません。削除済みのモデル・画像も履歴が参照する間は保持し、不要になると解放します。カメラ移動と選択はUndo対象外です。新しい編集はRedo履歴を破棄し、プロジェクトを開くと以前の履歴をリセットします。import・画像読込・復元の非同期処理中は編集を直列化します。

| ショートカット | 操作 |
| --- | --- |
| W / E / R | 移動／回転／拡大縮小 |
| Ctrl/Cmd + D | プリミティブを複製 |
| Delete / Backspace | 選択したオブジェクトを削除 |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z、Ctrl/Cmd + Y | Redo |
| Ctrl/Cmd + S | プロジェクト保存 |
| Esc | 連続入力・gizmo編集を取消 |

入力欄ではブラウザの文字編集ショートカットを優先します。

## 外部3D / CADデータの読み込み

ImportボタンまたはViewportへのドラッグ＆ドロップを使います。sidecarは本体と同時に選択してください。単位、座標系、中央寄せ、接地、STEP tessellation品質を指定できます。

| 形式 | 拡張子 | 状態・主な扱い |
| --- | --- | --- |
| glTF / GLB | `.gltf`, `.glb` | 階層、mesh、標準材質、animation。Draco／Meshopt圧縮、KTX2／Basis textureに対応。 |
| Wavefront OBJ | `.obj` | 同時選択したMTL・画像を相対パスで解決。MTLはPhong系材質で、Custom PBR変換は近似。 |
| STL | `.stl` | Geometryと既定のlight gray材質。1 MiB以上は利用可能な環境でWorker解析。 |
| PLY | `.ply` | Stable。mesh／point cloudとvertex color。 |
| FBX | `.fbx` | Experimental。階層、材質、animation、ローカルtexture、宣言単位と軸を正規化。 |
| COLLADA | `.dae` | Experimental。階層、材質、animation、ローカルsidecar。unitとY_UP／Z_UPを正規化。 |
| 3MF | `.3mf` | Experimental。単一root model partのunit、mesh、材質。multi-part・texture resourceは未対応。 |
| STEP / STP | `.step`, `.stp` | Experimental。Open CASCADE WASMをWorkerで実行し、B-Repから単一triangle meshへ変換。 |

アプリ内部はmeter／Y-upです。AutoはglTFをmeter／Y-up、STEPをmillimeterとして扱い、FBX・DAE・3MFでは対応する宣言値を使います。不明なOBJ／STL／PLYの単位・軸はmeter／Y-upと仮定して警告します。正規化はimport rootへ一度だけ適用します。

rootの名称・Transform・表示・削除と、子nodeの選択・表示・隔離・材質変更を分けています。子nodeのlocal Transform編集は提供しません。子node IDは元階層の子indexパスです。親の材質指定は子孫へ適用され、より具体的な子の指定が優先します。指定解除で親／rootのImported・Custom材質へ戻り、表示指定解除で元の表示状態へ戻ります。Points／LineはPBR材質上書き対象外です。

[Importer設計・形式別上限](./docs/CAD_IMPORT_ARCHITECTURE.md)

## 出力・計測の範囲

PNGは現在のcanvas解像度で出力し、Grid／Axes／gizmo等の補助表示を含めるか選べます。高解像度指定・透明背景は未対応です。GLBは表示対象のobject・mesh・標準材質・animationを出力し、編集補助表示を除外します。プリミティブの編集パラメータ、POV-Ray概念プロファイル、全アプリ設定を完全に戻す用途には`.rv3d`を使用します。

断面には切断面の蓋を生成しません。計測はRaycasterによるworld-spaceのmesh表面2点間距離です。STEPも三角形化した面上で計測し、B-Repの厳密寸法・曲面間最短距離は計算しません。計測点、断面、再生位置、描画倍率はViewportの作業中設定で、専用projectに永続化する対象ではありません。標準視点・投影・カメラ、ライト・露出・HDR・影はSceneModelの保存対象です。

## POV-Ray概念と材質画像

POV-Ray本体は組み込んでおらず、SDLの入出力やピクセル互換を提供しません。WebGLの`preview`とPOV-Ray概念を保持する`pov`は別プロファイルで、自動変換・同期しません。「保存のみ」はViewportに効果を描かないという分類です。値はSceneModelと`.rv3d`には保持できます。

PNG／JPEG／WebPの画像マップは1ファイル16 MiB、一辺4096 px、約16 MP、画像storeの推定常駐量256 MiBが上限です。base colorはsRGB、normal／roughness／metalness／AOは数値データとして扱います。UVのないmeshでは画像を使わずscalar／base colorへフォールバックします。normalマップは接線空間、roughnessはG、metalnessはB、AOはRチャンネルを使います。bump map、SVG、アニメーション画像、POV-Ray image projectionは未対応です。ローカルHDRはRadiance RGBEのみ、32 MiB・一辺8192 px・8 MPまでです。

[POV-Ray材料概念の対応範囲](./docs/POVRAY_MATERIAL_COVERAGE.md)

## 現在の制限

- STEPのassembly階層、part名、色、元材質はflattenされます。CAD topologyは保持しません。
- 3MFのmulti-part・texture resource、DAEのX_UP、3DM／IGES／BREP／IFC／DXFは未対応です。
- GLB／glTF、FBX、DAE、OBJ、STL、PLYは入力合計32 MiBまで。STEPは入力128 MiB・出力200万頂点／triangleまで。展開・geometry・画像には別の上限があります。
- 解析後の上限検査だけでは解析中のピークメモリを保証しません。全形式のWorker化、streaming import、LOD、mesh簡略化、BVH、複数clipの同時再生は実装していません。
- GPU統計はrenderer.infoの件数です。正確なGPU容量やモデルの軽量化効果を示す測定値ではありません。
- procedural pattern、積層texture、media、caustics、subsurface、厳密なray tracing等のPOV-Ray効果はWebGLでは再現しません。
- WebKit自動試験は実機Safariの互換保証ではありません。対象端末のGPU・WASM対応は別途確認してください。

## プライバシー

選択したモデル、MTL・buffer・画像sidecar、材質画像、HDRはブラウザ内で処理し、アプリから外部サーバーへアップロードしません。`.rv3d`とIndexedDBは元ファイルのbytesを含みます。`localStorage`は言語・テーマに使用します。

HTTP(S)等の外部model resource URIを拒否し、ローカルファイルとして選択した参照を解決します。decoder／transcoder／WASMはPagesのbase配下に同梱し、外部CDN・API・Analyticsを使用しません。利用者が公式資料リンクを開いた場合はそのサイトへアクセスします。

## ローカル実行・検証

Node.js 22を推奨します。

```bash
npm ci
npm run dev
```

Viteの`/Render-Viewer-3D/`を開きます。インストール済みThree.jsが参照するdecoder／transcoder資産をViteがPagesのbase配下へ出力します。GLTFLoaderとdecoder JSは必要時に遅延読込し、外部CDNや追加の手動コピーは使いません。

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

`npm test`は`scripts/test.mjs`が`tests/*.test.mjs`を自動検出します。モデル・履歴・保存形式・UI cache・材質・Importer・resource解放等を検証し、`npm run build`は型検査後に`dist/`を生成します。

実ブラウザの検証は任意の開発用コマンドとして実行できます。ブラウザのダウンロードとローカルserver起動が必要です。

```bash
npx playwright install chromium firefox webkit
npm run test:e2e
# 1種類だけの場合
npm run test:e2e -- --project=chromium
```

STEPではWASM SIMD、tail calls、WASM exception handlingが必要です。上流`occt-wasm` 4.3.1のkernel読込確認の最小版はChrome／Edge 114、Safari 17.2、Firefox 121です。この版情報は本アプリの全機能・全端末保証を意味しません。

[実装・検証マトリクス](./docs/IMPLEMENTATION_VALIDATION.md)／[元の調査・作業計画](./docs/REFACTORING_AND_FEATURE_PLAN.md)

## デプロイ

GitHub Actionsの使用量を抑えるため、検証workflowは`workflow_dispatch`による手動起動のみです。PR作成・更新では自動実行しません。レビュー・テスト・型検査・ビルドはローカルで行い、`main`へのmerge後はPages公開workflowを実行します。Pages workflowは配布に必要なinstall・test・buildとartifactの公開を含みます。

## 構成

```text
src/
├─ app/          # Store、履歴、project形式、復元、自動保存、import・画像制御
├─ importers/    # Registry、形式別解析、preflight、decoder、Worker、正規化
├─ model/        # JSON化できるSceneModel、material、root/node編集コマンド
├─ three/        # 描画要求、scene adapter、asset所有、animation、export、環境
├─ ui/           # shell、dialog、tree、inspector、material list/detail、各tools
├─ main.ts
└─ styles.css
```

SceneModelを正本とし、Immerの構造共有とdeep freezeで不変Snapshotを公開します。Three.js resourceはruntime storeが別に所有し、現在のシーン・履歴・進行中処理の参照に応じて保持・解放します。元ファイルはproject asset領域が保持し、保存時にdescriptorとbytesをまとめます。

## POV-Rayとの関係

本プロジェクトは独立した非公式プロジェクトであり、Persistence of Vision Raytracer Pty. Ltd.
またはPOV-Ray開発チームとの提携・承認関係はありません。POV-Rayの名称は材料概念と
用語の参照のために使用しています。

POV-Ray、Persistence of Vision Ray Tracer、およびPOV-Teamは
Persistence of Vision Raytracer Pty. Ltd.の商標です。

## ライセンス

本リポジトリ固有のソースコードには、現時点でオープンソースライセンスを設定していません。
Publicリポジトリとして閲覧できますが、オープンソースとしての利用許諾を示すものではありません。

利用ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) を参照してください。
GitHub Pagesの配布物には、実行時に使用するThree.js、Three.js addon内のfflate、
occt-wasm、Comlink、およびOpen CASCADE WebAssemblyの通知を
`THIRD_PARTY_LICENSES.txt`として同梱し、LGPL-2.1全文を
`licenses/LGPL-2.1.txt`、OCCT例外全文を`licenses/OCCT-exception-1.0.txt`として配布します。
