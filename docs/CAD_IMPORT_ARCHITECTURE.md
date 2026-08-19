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
  GLTF / OBJ / STL / STEP
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

| Importer | 実装 | 固有の処理 |
| --- | --- | --- |
| `GLTFImporter` | Three.js `GLTFLoader` | GLB / glTFを解析し、階層、標準glTFマテリアル、animation配列をruntimeへ保持します。 |
| `OBJImporter` | Three.js `OBJLoader` | Geometryを解析します。`mtllib`は検出して警告しますが、MTLは適用しません。 |
| `STLImporter` | Three.js `STLLoader` | Geometryへ既定のlight-gray PBRマテリアルを割り当てます。 |
| `STEPImporter` | `occt-wasm` 4.3.1 | Worker内でSTEPをOpen CASCADE shapeへ読み、品質別設定でtessellateして`BufferGeometry`へ変換します。 |

`.gltf`の相対URIは、同時に選択されたファイルを`LoadingManager`経由のBlob URLへ対応付けます。
query・fragment、URL encode、相対directory、大文字小文字を正規化し、使い終わったBlob URLは
revokeします。`data:` URIは許可し、HTTP(S)など外部URIは意図しない通信を避けるため拒否します。
Draco、KTX2 / Basis、Meshoptの追加decoderは現在登録していません。

## 共通正規化

アプリ内部の長さはmeter、上方向はY-upです。読み込み時に次の順でrootへ変換を適用します。

1. meshの不足normal、Bounding Box / Sphere、cast / receive shadowを準備する。
2. 指定単位をmeterへscaleする。Autoの既知値はglTFがmeter、STEPがmillimeter。
3. Z-up指定ならrootをX軸まわりに-90度回転してY-upへ合わせる。
4. Center Modelが有効ならBounding Boxの中心を原点へ移動する。
5. Place on Groundが有効ならBounding Boxの下端をY=0へ合わせる。

OBJ / STLなど単位またはup-axisを取得できない形式でAutoを選ぶと、meter / Y-upを仮定し、
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

Viewportのraycastでは子meshをimport root IDへ対応付けます。Object Treeは元階層を表示しますが、
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

## 新しい形式を追加する手順

1. browser / static hosting対応、保守状況、ライセンス、WASM配布条件を確認する。
2. `ModelImporter`を実装し、Loader固有の出力を`THREE.Object3D`へ変換する。
3. `importerRegistry`へ1項目追加する。UIの対応拡張子とファイル選択条件は自動更新される。
4. 単位とup-axisが判明する場合はnormalization contextへ渡し、不明ならwarningを維持する。
5. 解析失敗、abort、resource解放を含む小さなfixture testを追加する。
6. runtime依存を追加した場合は、Pages artifactの第三者ライセンス通知とsource提供を更新する。

次の候補はThree.js addonがあるPLY / FBX / COLLADA / 3MF、Rhino 3DM、IFC、DXF、BREPです。
IGESを含め、形式名だけで既存Importerへ分岐を増やさず、各形式を独立Importerとして評価・
実装します。独自解析が必要なproprietary CAD形式は無理に追加せず、GLB / glTF、STEP、OBJ、
STLなどへのexportを案内します。

## テスト方針

unit testではRegistry選択と重複防止、正規化、ローカルresource解決、GLTF / OBJ / STLの
小さなfixture、STEP worker境界・品質設定・必ず行うcleanup、import record command、runtime
asset lifecycle、material round-trip、Camera Auto Fitを検証します。STEP unit testは注入した
Worker clientを使うため、実ブラウザでのWASM起動と実在STEPファイルの表示はbuild後の
smoke testでも確認する必要があります。
