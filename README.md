# Render Viewer 3D

TypeScriptとThree.jsで構築した、ブラウザ上で3Dプリミティブと外部3D / CADモデルを
追加・編集・確認できる、パラメータ駆動型の3Dシーンエディターです。

> A browser-based, parameter-driven 3D scene editor built with TypeScript and Three.js.

現在は **Phase 4（拡張可能な3D / CADモデル読み込み）** まで実装しています。
POV-Ray本体は組み込んでおらず、POV-Ray SDLの入出力やレンダリング結果の一致を
提供するものではありません。

## 公開ページ

<https://takayuki-minagawa.github.io/Render-Viewer-3D/>

## 実装済みの機能

### Phase 1（最小3Dビュー）

- TypeScript + Vite + Three.jsによる静的Webアプリ
- Perspective Camera / WebGL Renderer
- OrbitControlsによる回転・パン・ズーム
- Grid / Axesの表示切替
- 初期Box、Ground Plane、固定Ambient / Directional Light
- カメラの初期視点リセット
- 日本語（既定）/ Englishの表示切替
- ダーク / ライトテーマの切替
- 日英対応の簡易マニュアル
- SVGファビコン
- SceneModel → Store → Three.js Adapterの分離構成
- GitHub ActionsによるGitHub Pagesデプロイ

### Phase 2（オブジェクト編集）

- Box / Sphere / Cylinder / Cone / Plane / Torusの6種類のプリミティブ追加
- Scene Treeでのオブジェクト選択、表示 / 非表示、プリミティブ追加
- Inspectorでの名前変更、複製、削除、Transform（位置・回転・スケール）とGeometryパラメータ編集
- Viewportのraycastによる選択とTransformControlsによる直接操作
- `W` / `E` / `R`による移動・回転・スケール切替
- `Delete`による削除、`Ctrl+D` / `Cmd+D`による複製
- 編集内容をSceneModelへ反映し、Three.js Sceneをモデルから同期する構成

### Phase 3（マテリアル管理とWebGLプレビュー）

- オブジェクト間で共有できるマテリアルライブラリ
- マテリアルの作成、検索、カテゴリ絞り込み、使用数表示、割り当て、複製、名称変更、個別化
- 使用中マテリアルの削除防止
- Matte、Matte Plastic、Glossy Plastic、Metal、Glass、Frosted Glass、Wood Base、Concreteの8プリセット
- Color、Diffuse、Specular、Roughness、Metallic、Reflection、Transmission、IOR、Opacity、Emissionの基本編集
- 数値項目のスライダーと数値入力、代表的なIORのプリセット
- Transparent、Double sided、Wireframeの切替
- Three.js `MeshPhysicalMaterial`によるリアルタイムプレビュー
- 外部HDRIを使用しない、ローカル生成のニュートラルな環境反射
- Box / Sphere / Planeで材質差を確認できる初期シーン
- POV-Ray材料概念を「直接プレビュー」「近似プレビュー」「保存のみ」に分類する対応状況一覧
- `texture`、`pigment`、`normal`、`finish`、`interior`、`media`などを分離したSceneModel v2

詳細は [POV-Ray material concept coverage](./docs/POVRAY_MATERIAL_COVERAGE.md) を参照してください。

### Phase 4（拡張可能な3D / CADモデル読み込み）

- GLB / glTF、OBJ、STL、および実験的なSTEP / STPの読み込み
- 拡張子からImporterを選択するRegistry / ImportManager構成
- Importボタン、複数ファイル選択、およびViewportへのドラッグ＆ドロップ
- 単位、座標系、中央寄せ、接地、STEP tessellation品質の読み込みオプション
- `.gltf`から参照するローカルbuffer・画像を、同時選択したsidecarファイルから解決
- 読み込み後のObject Tree、メタデータ、警告、およびroot単位の選択・表示・Transform・削除
- 読み込み元のマテリアルとアプリの共有マテリアルを切り替えるImported / Customモード
- 読み込みマテリアルのPBR scalar / colorを共有MaterialDefinitionへ変換し、Custom候補として登録
- 読み込み直後にモデル全体を収めるCamera Auto Fit
- STEPの解析と三角形化をWeb Worker内のOpen CASCADE WebAssemblyで実行

## 外部3D / CADデータの読み込み

ViewportのImportボタン、またはドラッグ＆ドロップから読み込みます。GLB / glTFを
推奨交換形式とし、対応拡張子とファイル選択の`accept`値はImporter Registryから生成します。

| 形式 | 拡張子 | Loader | 状態・主な扱い |
| --- | --- | --- | --- |
| glTF / GLB | `.gltf`, `.glb` | Three.js `GLTFLoader` | 推奨。階層・mesh・標準glTFマテリアルを保持します。ローカルsidecarは本体と同時に選択します。 |
| Wavefront OBJ | `.obj` | Three.js `OBJLoader` | Geometry中心。`mtllib`参照は警告し、現在はfallbackマテリアルで表示します。 |
| STL | `.stl` | Three.js `STLLoader` | Geometry中心。light gray、roughness 0.6、metallic 0の既定マテリアルを割り当てます。 |
| STEP / STP | `.step`, `.stp` | `occt-wasm` 4.3.1 | Experimental。Worker内でB-Repを三角形meshへ変換します。 |

アプリ内部の長さはmeter、上方向はY-upです。AutoではglTFをmeter / Y-up、STEPを
millimeterとして扱います。単位または座標系を検出できない形式はmeter / Y-upとして扱い、
Inspectorへ警告を表示します。Center ModelとPlace on Groundは読み込み時のBounding Boxを
使用します。Low / Medium / High品質はSTEP tessellationの細かさを変更します。

Object Treeには読み込んだ階層を表示しますが、現段階の選択、Transform、表示切替、
マテリアル上書きは読み込んだモデルのroot単位です。Importedモードへ戻すと、読み込み時の
meshマテリアルを復元します。詳しい設計、追加手順、ライブラリ選定理由は
[CAD import architecture](./docs/CAD_IMPORT_ARCHITECTURE.md) を参照してください。

## POV-Ray概念プロファイルとWebGLプレビュー

マテリアルは、Three.jsで表示するためのWebGLプレビュープロファイルと、
POV-Rayの材料概念を整理して保持するプロファイルを別々に持ちます。
「基本」タブのプレビュー値とPOV-Ray概念プロファイルは相互に自動変換・同期されません。
POV-Ray概念プロファイルを変更してもWebGL表示は変わらず、プレビュー値を変更しても
POV-Ray概念プロファイルは自動更新されません。

対応状況の意味は次のとおりです。

| 表示 | 意味 |
| --- | --- |
| 直接プレビュー | 対応するThree.jsプロパティへ近い形で反映します。POV-Rayと同じ画像になることを保証しません。 |
| 近似プレビュー | Three.js/WebGLの物理ベース材質で概念を近似します。 |
| 保存のみ | SceneModel内に構造や値を保持しますが、Viewportでは描画しません。ファイルへの永続保存を意味しません。 |

例として、SceneModelは2.333を超えるIORも保持できますが、現在のThree.jsプレビューでは
`MeshPhysicalMaterial`の範囲に合わせて1〜2.333へ制限して表示します。

## 現在の制限

- POV-Rayの実行ファイル、ソースコード、公式アセットは含まれていません。
- POV-Ray SDLの読込、書出し、構文検証、任意の材質の往復変換には対応していません。
- WebGLプレビュープロファイルとPOV-Ray概念プロファイルの相互変換・同期は行いません。
- プロシージャルパターン、積層texture、image map、normal / bump map、media、caustics、subsurfaceなどは、概念カタログまたはSceneModel内の保持対象であり、現在のViewportでは描画しません。
- マテリアルエディター単体でのローカル画像・HDRI読込とテクスチャのサンプラー管理には対応していません。glTFから参照される画像はglTFリソースとして読み込みます。
- Three.js/WebGLによる表示であり、POV-Rayとのピクセル互換性はありません。
- シーンのファイル保存・復元には未対応のため、ページを再読み込みすると編集内容は初期状態に戻ります。
- ライト編集、AO、PNG出力、JSON入出力、比較機能は未実装です。
- 対応形式はGLB / glTF、OBJ、STL、STEP / STPです。PLY、FBX、DAE、3MF、3DM、IGES、BREP、IFC、DXFなどは未実装です。
- OBJのMTLマテリアルは未対応です。
- Draco、KTX2 / Basis、Meshoptなど、追加decoderを必要とするglTF圧縮・texture形式は未対応です。
- STEPはExperimentalです。現在のWorker tessellation経路ではassembly階層、名称、色、元マテリアルを単一meshへflattenし、警告を表示します。
- 読み込み階層は表示用です。子node単位の選択・Transform・表示切替・マテリアル変更には未対応です。
- glTF animationはruntimeへ読み込みますが、再生UIはありません。
- 読み込んだThree.js assetはブラウザメモリだけに保持します。SceneModelのimport recordだけではモデルを復元できず、ページ再読み込み後は再importが必要です。
- main threadで解析するGLB / glTF（sidecarを含む）、OBJ、STLは、UI停止を避けるため選択ファイル合計32 MiBまでです。STEPはWorkerで解析し、入力128 MiB、出力200万頂点・200万triangleまでに制限します。
- 大規模モデル向けのLOD、mesh簡略化、永続cache、streaming importは未実装です。

## 表示と言語の設定

ヘッダー右側のボタンから表示言語、テーマ、簡易マニュアルを操作できます。
言語とテーマはブラウザ内に保存され、次回アクセス時に復元されます。
初回の既定値は日本語・ダークテーマです。

## プライバシーと外部通信

- 選択したモデル本体とローカルsidecarはブラウザのメモリ内で処理し、アプリから外部サーバーへアップロードしません。
- `localStorage`は表示言語とテーマの保存にだけ使用します。
- Analytics、Cookie、外部API、外部CDNは使用していません。
- `.gltf`内のHTTP(S)など外部resource URIは読み込みを拒否します。参照resourceはローカルファイルとして本体と同時に選択してください。
- 対応状況一覧の公式資料リンクを利用者が開いた場合に限り、ブラウザがリンク先のPOV-Ray公式サイトへアクセスします。シーンデータは送信しません。

## ローカル実行

Node.js 22を推奨します（対応範囲はNode.js 18 / 20 / 22以上です）。

```bash
npm ci
npm run dev
```

Viteが表示する `/Render-Viewer-3D/` のURLをブラウザで開いてください。

### STEPのブラウザ要件

通常のThree.js表示に加えて、STEPではWASM SIMD、tail calls、WASM exception handlingが
必要です。`occt-wasm` 4.3.1がkernel読込を確認している最小バージョンはChrome / Edge
114、Safari 17.2、Firefox 121です。要件を満たさないブラウザでは、GLB / glTF、OBJ、STLを
使用するか、STEPを事前に変換してください。

## ビルドとプレビュー

```bash
npm test
npm run typecheck
npm run build
npm run preview
```

`npm test` はScene Storeの不変性、オブジェクト編集コマンド、Geometry生成、
マテリアルプリセットと管理コマンド、SceneModel v1からv2への移行、ライブラリ検索、
Three.js材質への投影、共有リソースの再利用・破棄、IORのプレビュー制限、
TransformControls操作中のモデル同期に加え、Importer選択、単位・座標・原点の正規化、
glTF sidecar解決、OBJ / STL / STEP変換、import record、runtime assetの再利用・破棄、
マテリアル切替、Camera Auto Fitを検証します。
`npm run build` はprebuildでTypeScriptの型検査を実行後、`dist/`へ静的ファイルを生成します。
GitHub Pagesのプロジェクトパスに合わせ、Viteの`base`は`/Render-Viewer-3D/`です。

## デプロイ

Pull Requestではテストと型検査・ビルドを実行します。`main`ブランチへのpushでは、
検証に加えてPages artifactのアップロードと`github-pages` environmentへのデプロイを行います。

## 構成

```text
src/
├─ app/                 # アプリケーションの組み立て、Scene Store、import制御
├─ importers/           # Registry、ImportManager、形式別Importer、共通正規化
├─ model/               # JSON化可能なSceneModel、不変Snapshot、初期シーン
│  └─ material/        # マテリアルモデル、プリセット、操作、移行、対応状況カタログ
├─ three/               # Viewport、SceneGraph、runtime import assetのAdapter
│  └─ material/        # MeshPhysicalMaterialへの投影、共有runtime、環境反射
├─ ui/                  # 3ペインUI、import UI、マテリアルライブラリ
├─ main.ts
└─ styles.css
```

Three.jsのSceneは永続データの正本にせず、JSON化可能なSceneModelを正本として扱います。
Storeは深くfreezeしたSnapshotを公開し、SceneGraph AdapterがモデルのIDと型を基準に
Three.jsリソースをreconcileします。現在はSceneModelをファイルへ保存するUIはありません。
import recordはJSON化できますが、実体のObject3D、Geometry、Material、Textureは
`ImportedAssetStore`がruntime assetとして別に所有します。このためimport recordだけを保存しても
外部モデルは復元できません。

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
GitHub Pagesの配布物には、実行時に使用するThree.js、occt-wasm、Comlink、および
Open CASCADE WebAssemblyの通知を`THIRD_PARTY_LICENSES.txt`として同梱し、
LGPL-2.1全文を`licenses/LGPL-2.1.txt`、OCCT例外全文を
`licenses/OCCT-exception-1.0.txt`として配布します。
