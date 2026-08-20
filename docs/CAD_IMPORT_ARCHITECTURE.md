# CAD import architecture

## 目的と範囲

外部3D / CADデータをブラウザ内でThree.jsのscene objectへ変換し、既存のViewport、
Object Tree、Transform、マテリアルプレビューで扱います。形式ごとの処理をImporterへ隔離し、
新しいJavaScript / WebAssembly Loaderを既存のscene・materialコードへ直接結合せずに
追加できることを優先します。

これはCAD編集kernelや完全な形式変換器ではありません。元ファイルのB-Rep、feature tree、
constraint、BIM semantic情報を編集・保存することは対象外です。

## データフロー

```text
File input / Drag & Drop
          │
          ▼
    ImportManager ─── importerRegistry（拡張子、accept、Experimental表示）
          │
          ▼
 format-specific ModelImporter
  GLTF / OBJ / STL / PLY / FBX / DAE / 3MF / STEP
          │
          ▼
 normalizeImportedRoot
  unit → Y-up → center → ground → bounds / normals / shadows
          │
          ▼
 ImportedModel { root: THREE.Object3D, metadata, warnings }
          │
          ▼
    ImportController
       ├─ JSON化可能なimport record → SceneStore
       └─ Object3D / Geometry / Material / Texture → ImportedAssetStore
          │
          ▼
 ImportedSceneAdapter → Three.js Scene → selection / Camera Auto Fit
```

`ModelImporter`は`id`、表示名、拡張子、Experimental状態、`canImport`、非同期`import`を
共通契約として持ちます。`ImportManager`は拡張子を正規化してImporterを選び、重複ID・
重複拡張子を拒否します。ファイル選択の`accept`と対応形式一覧も同じRegistryから導出します。

## 形式別の責務

| Importer | 実装 | 状態 | 固有の処理 |
| --- | --- | --- | --- |
| `GLTFImporter` | Three.js `GLTFLoader` | Stable / 推奨 | GLB / glTFを解析し、階層、標準glTFマテリアル、animation配列をruntimeへ保持します。 |
| `OBJImporter` | Three.js `OBJLoader` | Stable | Geometryを解析します。`mtllib`は検出して警告しますが、MTLは適用しません。 |
| `STLImporter` | Three.js `STLLoader` | Stable | Geometryへ既定のlight-gray PBRマテリアルを割り当てます。 |
| `PLYImporter` | Three.js `PLYLoader` | Stable | faceがあればPBR mesh、なければ`Points`として読み、vertex colorを保持します。 |
| `FBXImporter` | Three.js `FBXLoader` / `TGALoader` | Experimental | 階層、マテリアル、animation、ローカルtexture sidecarを保持し、binary配列をpreflightして`UnitScaleFactor`とLoaderのaxis補正を共通正規化で一度だけ適用します。 |
| `ColladaImporter` | Three.js `ColladaLoader` | Experimental | 文書の`unit` / `up_axis`とXML構造をLoader作成前に検証し、Loaderの補正を戻して共通正規化で一度だけ適用します。階層、マテリアル、animationとローカルsidecarを保持します。 |
| `ThreeMFImporter` | Three.js `3MFLoader` | Experimental | ZIP / XMLをpreflightして単一root modelのunit、mesh、マテリアルを読み込み、Z-upからY-upへ正規化します。 |
| `STEPImporter` | `occt-wasm` 4.3.1 | Experimental | Worker内でSTEPをOpen CASCADE shapeへ読み、品質別設定でtessellateして`BufferGeometry`へ変換します。 |

PLY / FBX / COLLADA / 3MFのThree.js addonは静的にmain bundleへ含めず、`import()`で
形式別のdynamic chunkとして生成します。利用者がその形式を選んだときだけ対応chunkを読み込み、
FBX圧縮配列preflightと3MF展開で使うThree.js vendored `fflate`も必要時だけ読み込みます。

## ローカルresource解決と安全上限

`.gltf`、FBX、DAEの相対URIは、同時に選択されたファイルを`LoadingManager`経由のBlob URLへ
対応付けます。query・fragment、URL encode、相対directory、大文字小文字を正規化し、
sidecarの完了を待ってからBlob URLをrevokeします。abort・解析失敗・sidecar失敗でも一時sceneと
URLを解放します。`data:` URIは許可し、HTTP(S)など外部URIは意図しない通信を避けるため拒否します。
Draco、KTX2 / Basis、Meshoptの追加decoderは現在登録していません。

- main threadで解析するGLB / glTF、FBX、DAE（各sidecarを含む）、OBJ、STL、PLYは、
  選択ファイル合計32 MiBまでです。
- binary FBXはLoader import / factoryより前にnode / property / depthと、圧縮配列の宣言展開量・
  streaming実展開量・圧縮比・宣言値との一致を検証します。
- 3MFは圧縮archive 16 MiB、4,096 entry、1 entryの展開後8 MiB、展開後合計128 MiB、
  圧縮比200:1を上限とし、ZIP64を拒否します。全entryのstreaming実展開量と宣言値の完全一致も
  `unzipSync`前に検証します。XMLはDOM構築前に100,000要素・深さ256へ制限します。
- DAEはDOCTYPE / ENTITY、`instance_node`、過大なXML / scene構造を拒否します。3MFもDOCTYPE / ENTITYを拒否し、
  単一root `3D/*.model`だけを許可してmulti-part、model relationship part、texture resourceを拒否します。
- PLY / FBX / DAE / 3MFの解析結果は50,000 scene node、深さ256、10,000 renderable、
  200万position vertex、200万vertex reference、200万primitiveまでです。
- STEPはWorker入力128 MiB、出力200万頂点・200万triangleまでです。
- glTF / FBX / DAEのanimation配列はruntimeへ保持しますが、現在は再生UIがありません。

## 共通正規化

アプリ内部の長さはmeter、上方向はY-upです。読み込み時に次の順でrootへ変換を適用します。

1. meshの不足normalとcast / receive shadow、mesh / points / lineのBounding Box / Sphereを準備する。
2. 指定または解決済みの単位をmeterへscaleする。
3. Z-up指定ならrootをX軸まわりに-90度回転してY-upへ合わせる。
4. Center Modelが有効ならBounding Boxの中心を原点へ移動する。
5. Place on Groundが有効ならBounding Boxの下端をY=0へ合わせる。

Autoの既知値はglTFがmeter / Y-up、STEPがmillimeterです。FBXは`UnitScaleFactor`
（1 file unitあたりのcentimeter）があればmeter換算値として渡し、Loaderがrootへ付けた
Z-up補正を一度戻してsource axisを共通正規化へ渡します。factorがなければmeterを仮定する
構造化warningを残します。DAEは文書の`unit meter`（既定1）と`up_axis`（Y_UP / Z_UP）を
Importerが検証し、ColladaLoaderのscale / rotationを一度戻して共通正規化へ渡します。
X_UPは明示的に拒否し、二重scale / rotationを防ぎます。3MFはroot modelの`unit`を検出して
Autoへ渡し、形式既定のZ-upからY-upへ一度だけ変換します。package inspectionが完了できない場合だけ
millimeterを仮定する構造化warningを残します。

OBJ / STL / PLYなど単位またはup-axisを取得できない形式でAutoを選ぶと、meter / Y-upを仮定し、
その仮定をwarningとしてimport recordへ残します。元の子objectのlocal transformは変更せず、
共通のimport rootに補正を集約します。

## SceneModelとruntime assetの境界

`ImportedSceneModel`はID、asset ID、ファイル情報、統計、warning、表示用階層、root transform、
material modeを持つJSON化可能なrecordです。一方、`THREE.Object3D`、Geometry、Material、
Textureは`ImportedAssetStore`だけが所有します。これによりSceneModelへ巨大なtyped arrayや
循環参照を混入させず、削除・アプリ終了時にGPU / CPU resourceを一度だけdisposeできます。

別々のasset rootが同一のGeometry / Material / Texture / Image / Skeleton /
instancing resourceを共有すると、一方だけを削除した時点で所有権が曖昧になります。
そのため登録時にasset間の共有を検出して明示的に拒否し、各resourceが
必ず1つのassetだけに所有される境界を維持します。

この分離の結果、import recordだけでは外部モデルを再構築できません。シーン永続化を追加する
場合は、元ファイルを再選択する仕組み、またはassetを別形式で保存・復元する仕組みが必要です。

Viewportのraycastでは子mesh / `Points` / `Line`をimport root IDへ対応付けます。Object Treeは元階層を表示しますが、
現段階の選択、visibility、Transform、material override、削除はimport root単位です。

## Material mode

- `Imported`: 読み込み時に各meshが持っていたマテリアルを使用します。
- `Custom`: アプリの共有マテリアルをimport root以下の全meshへ適用します。

読み込み時にMaterial AdapterがThree.jsマテリアルをidentityで重複排除し、base color、
roughness、metalness、opacity、emission、transmission、IORなどのscalar / colorを
アプリの`MaterialDefinitionModel`へ変換して共有ライブラリへ登録します。最初の変換結果は
Customモードの初期候補になります。Texture slotは共通モデルへ投影せず、元runtime materialの
所有物として保持するため、ImportedモードではglTF textureを含む元の見た目を維持します。

runtime assetは元マテリアル参照を保持するため、CustomからImportedへ戻したときに各meshの
割り当てを復元できます。Customで参照中の共有マテリアルは削除できません。

PLY point cloudの`PointsMaterial`はPBR共有マテリアルと互換でないため、Custom modeの
上書き対象に含めません。rootのmodeをCustomへ切り替えても`Points`は読み込み時のmaterialを
維持します。FBXの`Line`も同様にline materialを維持します。どちらも選択・表示・Transform・
resource解放はmeshと同じroot単位で扱います。

## STEPライブラリの選定

仕様書では`occt-import-js`を候補としていましたが、2026-08-19の調査時点では
[`occt-wasm` 4.3.1](https://github.com/andymai/occt-wasm/tree/v4.3.1)をexact pinしました。
選定理由は、Open CASCADE 8.0.1を使うTypeScript-first API、専用の`OcctWorker` helper、
明示的なshape解放、品質指定可能なtessellation API、およびWASMを静的URLとして渡せる
構成が、今回のVite / GitHub Pages構成に合うためです。重いSTEP処理はmain threadではなく
Workerで実行し、成功・失敗のどちらでもshapeを解放してWorkerを終了します。

WASMはJavaScript bundleへ埋め込まず、Viteが独立した`.wasm` assetとして出力し、Workerへ
そのURLを渡します。これにより静的hostingで配信でき、互換性のある変更版WASMを使う場合も
配布者がasset / URLを差し替えられます。現在のUIにWASM URLを変更する設定はありません。

### STEPの既知制限

- 現在の`importStep` → `tessellate` Worker経路は1つのtriangle meshへ変換するため、
  assembly階層、part名、色、元マテリアルをflattenし、構造化warningを返します。
- tessellation品質は形状再現の許容誤差を変えますが、CAD topology自体は保持しません。
- WASM SIMD、tail calls、WASM exception handlingが必要です。上流がkernel読込を確認した
  最小版はChrome / Edge 114、Safari 17.2、Firefox 121です。
- `occt-wasm`の現在のbuildはIGES moduleを含みません。IGES対応は別Importerと適切な
  browser対応libraryを改めて選定します。

## ライセンス

Three.js 3MF addonが同梱する[`fflate` 0.8.2](https://github.com/101arrowz/fflate/tree/v0.8.2)は
MITです。FBX圧縮配列preflightと3MF ZIP展開のdynamic chunkへruntime codeが含まれるため、
repository向けとPages artifact向けの両方の第三者通知へ、固定source、copyright、MIT全文を記載します。

`occt-wasm` 4.3.1のTypeScript wrapper / build toolingはMIT OR Apache-2.0、配布する
Open CASCADE WebAssemblyはLGPL-2.1-only WITH OCCT-exception-1.0です。Worker helperが
使うComlink 4.4.2はApache-2.0です。対応する正確なOCCT sourceは
[`andymai/OCCT@055a9a8a`](https://github.com/andymai/OCCT/tree/055a9a8a2b3fbb33da2ec9a5445d2b97ffbcd765)で、
[公式OCCT V8_0_1](https://github.com/Open-Cascade-SAS/OCCT/tree/V8_0_1)はupstream baselineです。
著作権表示、固定source link、LGPLとOCCT例外の全文は
[`THIRD_PARTY_LICENSES.md`](../THIRD_PARTY_LICENSES.md)を参照してください。

WASMのLGPLとOCCT例外の条件はアプリ本体のライセンスとは別に満たす必要があります。
再配布者は独立したWASM asset、著作権・ライセンス・例外通知、対応するsourceへのアクセス、
変更版へ置換する権利を維持してください。

`linkedom` 0.18.12（ISC）は実DAE / 3MF fixture testでNode.jsへ`DOMParser`を提供するdev/test-only依存です。
`src/`から参照せずViteのPages runtime artifactへ含まれないため、repository向け通知にはISC全文を
記載しますが、配布物に存在しないcodeの通知となる`public/THIRD_PARTY_LICENSES.txt`には含めません。

## 新しい形式を追加する手順

1. browser / static hosting対応、保守状況、ライセンス、WASM配布条件を確認する。
2. `ModelImporter`を実装し、Loader固有の出力を`THREE.Object3D`へ変換する。
3. `importerRegistry`へ1項目追加する。UIの対応拡張子とファイル選択条件は自動更新される。
4. 単位とup-axisが判明する場合はnormalization contextへ渡し、不明ならwarningを維持する。
5. 解析失敗、abort、resource解放を含む小さなfixture testを追加する。
6. runtime依存を追加した場合は、Pages artifactの第三者ライセンス通知とsource提供を更新する。

PLYはStable、FBX / COLLADA / 3MFはExperimentalとして独立Importer化済みです。残る候補は
3DM、IGES / IGS、BREP / BRP、IFC、DXFなどで、次の前提設計が未完了のため後続段階で扱います。

- 3DM: browser対応WASMのpayload・Worker境界と、NURBS、layer、object属性の保持方針を評価する。
- IGES / BREP: 現在の`occt-wasm` buildにIGES moduleがなく、BREPのformat variantも含めて
  browser対応parser、tessellation、license / source提供条件を選定する。
- IFC: 大規模BIM向けのWorker・memory上限に加え、element ID、type、spatial hierarchyを
  SceneModelへ保持する境界を設計してから`web-ifc`等を評価する。
- DXF: 2D line / polyline、block、textをmesh中心のsceneへどう対応付けるかを先に定義する。

形式名だけで既存Importerへ分岐を増やさず、各形式を独立Importerとして評価・実装します。
独自解析が必要なproprietary CAD形式は無理に追加せず、GLB / glTF、STEP、OBJ、STL、PLYなどへの
exportを案内します。

## テスト方針

unit testではRegistry選択と重複防止、正規化、ローカルresource解決、GLTF / OBJ / STLの
小さなfixtureに加え、PLYのmesh / point cloud・vertex color・Custom material除外、FBX / DAEの
unit / axis・animation・sidecar待機・abort / error cleanup、FBX binary配列、共通geometry budget、
3MFのZIP / XML安全上限・unit・material保持を検証します。DAE / 3MFは`linkedom`でNode.jsへ`DOMParser`を補う
dev/test-onlyの実fixtureもThree.js addonへ通し、mockだけでなく実loaderとの接続を確認します。

STEP unit testは注入したWorker clientでWorker境界・品質設定・必ず行うcleanupを検証します。
実ブラウザでのWASM起動と実在STEPファイルの表示はbuild後のsmoke testでも確認する必要が
あります。共通ではimport record command、runtime asset lifecycle、material round-trip、
Camera Auto Fitを検証します。
