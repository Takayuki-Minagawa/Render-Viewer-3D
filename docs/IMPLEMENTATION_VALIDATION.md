# 実装・検証記録

更新日：2026-09-07。元の[調査・作業計画](./REFACTORING_AND_FEATURE_PLAN.md)に対する実装状況です。

**R1〜R6、F1〜F12の提供機能を実装し、単体293件・3ブラウザE2E48件・公開用build検証15件が成功しました。** W7〜W9の条件付き検討事項をすべて採用したという意味ではありません。PR・Pagesの追跡先は末尾に記載します。

## 対応マトリクス

右列は実装中の個別検証記録です。「最終待ち」とした対象も、後述の確定版一括検証で成功を確認しました。

| ID | 実装・採用内容 | 現在の証拠・残る確認 |
| --- | --- | --- |
| R1 | ImportDialogController、ShortcutController、SceneTreeView、PrimitiveInspector、ImportedInspector、MaterialListView、MaterialDetailViewへ責務分割 | 既存UIテスト、DOM同一性・node操作・日英投影ラベルの新規回帰テスト成功。最終ブラウザ一括は後記欄へ追記 |
| R2 | DemandRendererによる要求集約、操作・resize・画面復帰・画像更新時の再描画、再生中のみ連続描画 | scheduler単体試験。静止10秒のブラウザE2Eを用意。並行編集中のVite再読込の影響を除いた最終再実行待ち |
| R3 | Immer構造共有、no-op通知抑制、材質割当配列・一覧行再利用、使用数索引、category／preset／light DOM cache | 不変Snapshot試験、[UI比較測定](./UI_REFACTOR_BENCHMARK.md)。ブラウザ入力から表示までのp95をこの値から推定しない |
| R4 | history transaction、現在／Undo／Redo／処理中assetの保持、50件・推定256 MiBで履歴削減、非同期処理の直列化 | 編集group／cancel／Redo破棄・import削除中のasset保持試験。GPU byte上限の厳密測定ではない |
| R5 | 3MF preflight分割、GLTF／OBJ／STLへ共通geometry検査、glTF宣言／KTX2 header検査、STL Worker追加 | 上限・外部URI拒否・Worker lifecycle試験、実decoder／MTL／STEPブラウザfixture |
| R6 | `tests/*.test.mjs`自動検出、Playwright設定、Chromium／Firefox／WebKit、Pages base配下のdecoder／Worker／WASM試験 | 3ブラウザのImporter個別確認、最終一括と正確な件数は後記欄へ追記。実機Safari保証は含まない |
| F1 | `.rv3d`手動保存／復元、元モデル・sidecar・画像・HDR、version・参照・checksum検査、IndexedDB自動保存、明示的復旧 | primitive・元sidecarのcontainer round-tripと不正入力試験。全資源混在projectの最終操作確認は後記欄へ追記 |
| F2 | Undo／Redo、連続入力・slider・gizmoの境界、Esc取消、asset保持、履歴上限 | 履歴単体試験、材質override Undo／Redo・隔離UndoのChromium E2E成功。レビュー修正後の最終一括待ち |
| F3 | 現canvas解像度のPNG、補助表示含有選択、出力前render | PNG signature・寸法・非空サイズを検査するE2E。最終再実行待ち |
| F4 | GLTFExporterの遅延読込、helper除外、geometry／material／texture／animation snapshot、GLB出力 | export snapshot単体試験、GLB header／mesh件数／helper除外E2E。最終再実行待ち |
| F5 | ローカルDraco／Meshopt／KTX2／Basis、renderer能力判定、Pages内decoder配布、展開・画像budget | Draco Box、Meshopt triangle、KTX2 fixtureの実ブラウザ確認。外部CDNを使わない |
| F6 | 正投影・7標準視点・Fit、camera up／projection／表示範囲保存、日英ラベル | Chromium標準視点／Fit試験、日英投影表示試験成功 |
| F7 | global clipping plane、不可視面のpick除外、mesh表面2点距離、mm／cm／m | Chromiumで正投影・計測・断面の連携成功。蓋・B-Rep厳密計測は対象外 |
| F8 | tree／raycast子node選択、3状態visibility、隔離、継承材質override、project保存・材質削除保護 | 子index ID、元visibility復元、親子材質優先順位、Bone／Transform維持、参照拒否の単体試験。実UI Undo／Redo E2E成功 |
| F9 | 1clip選択、再生／一時停止／解除、seek、速度、mixer停止・uncache | wrapper維持、速度、終了・解除の単体試験。同名clip選択等のレビュー修正後に再検証 |
| F10 | light色／強度／位置、露出、Radiance RGBE HDR、normal／roughness／metalness／AO画像、色空間区別 | HDR事前検査、PBR map lifecycle／UV／共有材質試験。照明・画像の最終ブラウザ操作確認は後記欄へ追記 |
| F11 | OBJ＋MTL＋画像、MTL相対パス、複数library、欠落・外部URI拒否、Phong→Custom PBR近似警告 | OBJ／MTL単体試験と2×2画像の実ブラウザ読込成功 |
| F12 | draw calls、triangles、geometry／texture数、import時間、pixel ratio・影切替 | UI統計と固定Importer benchmark。BVH／LOD／mesh簡略化は未採用、以下に判断を記録 |

## 条件付き検討の判断

- UI frameworkへの移行、全ImporterのWorker化、BVH、LOD、mesh簡略化、streaming、追加CAD形式の一括導入は行っていません。元計画でも利用データ・計測・依存コストに基づく個別判断とされていた項目です。
- 主thread処理を減らす対象として、DOM依存がなくtyped geometry bufferをtransferできるSTLを選び、1 MiB以上をWorkerへ移しました。Workerがない環境ではmain threadへfallbackします。
- 下記は同一プロセスでの**同期parser単体**比較です。Worker導入後の総所要時間短縮やブラウザ操作遅延の改善率を測った値ではありません。Worker起動・転送にもコストがあります。
- BVHはraycast、LOD／簡略化はdraw call・triangle負荷を実利用fixtureで確認してから選ぶ方針を維持します。現在は件数・import時間の診断と品質設定を提供します。

## Importerの固定fixture測定

コマンド：`node scripts/benchmark-importers.mjs`。Node.js v22.18.0、各2回warm-up後7回、p95欄は7標本の最大値。合成triangleのASCII STL／OBJを使用しました。以下は文書更新時の再実行値です。実装時の別実行値とdecoder配布の詳細は[Importer boundaries](./IMPORTER_BOUNDARIES.md)にあります。

| 形式 | triangle | 入力bytes | 中央値 | p95相当（最大値） |
| --- | ---: | ---: | ---: | ---: |
| STL ASCII | 10,000 | 860,035 | 3.76 ms | 5.66 ms |
| OBJ | 10,000 | 80,024 | 3.92 ms | 5.73 ms |
| STL ASCII | 100,000 | 8,600,035 | 36.24 ms | 37.54 ms |
| OBJ | 100,000 | 800,024 | 38.20 ms | 43.11 ms |

これらはローカル測定値で、実機GPU・モバイル・CAD形状一般への性能保証ではありません。UIの測定条件・値は別の[UI比較記録](./UI_REFACTOR_BENCHMARK.md)に記載しています。

## 状態更新の固定fixture測定

`node scripts/benchmark-store.mjs`、Node.js v22.18.0、1,000オブジェクト、20回warm-up後100回のカメラ更新で比較しました。全量clone＋freezeの中央値2.595 ms／p95 2.941 msに対し、Immer更新は中央値0.004 ms／p95 0.005 msでした。Store単体の値であり、DOM・描画や履歴全体の処理時間は含みません。

## 個別検証の記録

- 既存のUI cache・材質・設定試験と追加UI reconciliation試験が成功。子node tools、材質一覧の同一DOM保持、連続入力group、Esc取消、日英正投影ラベルを確認。
- imported-node editingと既存imported scene／materialモデル試験の23件が成功。継承材質・隔離解除・元の非表示・未知参照・資源参照・Bone／Transform維持を確認。
- Chromiumの子node操作E2Eが成功。OBJ実import→tree子選択→材質Undo／Redo→隔離Undo→日英と正投影表示まで、pageerrorなし。
- Chromiumの正投影・標準視点・Fit・距離計測・断面pick除外E2Eが成功。
- Draco／Meshopt／KTX2、OBJ＋MTL画像、STL Worker、実OCCTによるSTEP boxの寸法・triangle数について、Chromium／Firefox／WebKitの個別検証を実施。正確な最終一括結果は下記へ集約する。
- 並行編集中のVite HMRによってパネル状態が初期化され、静止10秒＋出力E2Eが失敗した実行がある。これを製品不具合や合格として扱わず、変更確定後の同じ対象で再検証する。

## ブラウザの推定ピークメモリ比較

`node scripts/benchmark-browser-memory.mjs`、macOS、Chromium 153.0.8010.12。同じ100,000 triangle・8,600,035 bytesのASCII STLを25回解析・geometry破棄し、同期STLLoader（変更前の解析方式）と今回のWorker処理を比較しました。各方式3回、新しいブラウザを起動して初期画面を安定させ、browserと子processのRSS合計を20 ms間隔で取得しています。アプリ全体の旧版を起動した比較ではありません。

| 方式 | 観測最大RSSの中央値（範囲） | 開始時からの増分中央値 | 25回の所要時間中央値 |
| --- | ---: | ---: | ---: |
| 同期解析 | 858.7 MiB（857.8〜858.8） | 324.3 MiB | 1,183.9 ms |
| Worker解析 | 658.7 MiB（656.7〜697.1） | 124.7 MiB | 1,949.5 ms |

このfixtureではWorkerの観測最大RSSが小さくなり、合計時間は起動・転送のため増えました。Worker採用は総時間短縮の主張ではなく、同期parserをUI threadから移す判断です。RSSの合算は共有pageを重複計上し、サンプリング間のpeakを取り逃がすため、推定値です。GPU専用メモリ、JS heap、他端末の厳密な上限を表しません。

## レビュー修正

- 独立レビューを繰り返し、gizmoのEsc取消、同名animation clip切替、保存入力検証、取消時のRedo保持、カメラresetの不要な履歴、modalの非同期編集排他を修正して再確認。最終レビューで追加のマージ阻害指摘なし。
- 履歴容量は現シーンの使用分を除く追加assetとsnapshot概算256 MiBを対象に修正。大きな現シーンでも名称変更をUndoできます。
- 復元stageの展開後推定量を512 MiBで制限し、超過時の旧scene・選択・Undo維持とstage解放を検証。原本container512 MiBとは別の制限です。解析中ピークと旧sceneを含む総メモリ量はこれを超え得ます。
- clean install後の並列SSR試験でVite依存最適化の待機が発生したため、単体試験ではブラウザ用prebundleを無効化し、runnerに60秒上限を追加。devのComlink prebundleは維持しました。
- WebKitのIndexedDB Blob保存失敗を実ブラウザで再現し、該当する互換エラーだけArrayBuffer recordへ再保存する処理を追加。旧Blob読込とquota等のエラー表示を維持し、単体5件とWebKitの保存・再起動・復旧試験で確認しました。

## 最終一括検証・公開（追記欄）

| 項目 | 状態 |
| --- | --- |
| clean install | `npm ci --prefer-offline --no-audit --no-fund`成功、46 packages。制限環境で未cacheの型定義取得に失敗した後、ネットワーク接続可能な実行で成功 |
| 全unit testの件数・成功数 | **293件成功、失敗0、skip 0**。Node.js v22.18.0／npm 10.9.3、約1.78秒 |
| TypeScript | `npm run typecheck`およびbuildのprebuild成功 |
| production build・chunkサイズ | 成功。main **1,040.57 kB／gzip 282.05 kB**。500 kB超chunk警告は残る。STEP WASM 22,196.78 kBは遅延取得 |
| Chromium全E2E | 最終一括の16件成功 |
| Firefox全E2E | 最終一括の16件成功 |
| WebKit全E2E | 自動保存の互換修正後、最終一括の16件成功。3ブラウザ計**48件成功**、約2.0分 |
| 公開用buildの3ブラウザ検証 | **15件成功**、約59.9秒。`RV3D_PREVIEW=1`、3ブラウザ各5件 |
| 複合project復元、画像差替えUndo、resource反復 | Draco／Meshopt＋KTX2／STEPを混在保存・復元。別のprojectで4種PBR画像＋STEP、HDR＋露出＋lightを復元。color画像差替えUndoと6回のdrop→削除→Undo→Redo→履歴解放で、warm-up後のgeometry／texture件数が増加しないことを確認 |
| 独立reviewの指摘修正・再review | 3サブエージェントによる担当外reviewと修正後の再reviewを実施。指摘を修正し、追加のマージ阻害指摘なし |
| PR・merge commit | 未作成／未記録 |
| GitHub Pages最終公開 | 未実行／未記録 |

検証workflowは手動起動だけに変更し、PR更新ごとのActionsは使用しません。最後のmainへのmergeに伴うPages公開workflowを使用します。

公開用buildの試験はdev専用の検証APIを使わず、file chooser・操作UI・downloadから確認しました。初期表示でDraco／Basis／OCCT WASMを取得せず、必要なimport時だけ同一originの`/Render-Viewer-3D/`配下から取得することも検査しています。PNGのsignature・寸法、GLBのheader・mesh数・helper除外、静止10秒で追加描画0回を確認しました。

mainのgzipは実装前256.47 kBに対し282.05 kBで、機能追加全体では約10%増加しています。追加機能実装直後の327.07 kBからはglTF関連の遅延読込によって約14%削減しました。初回bundleが実装前より小さくなったという意味ではありません。

実機Safari・モバイルGPUの手動相互運用、およびGPUを含む厳密なピークメモリの測定は実施していません。上記RSSサンプリング、resource数の反復試験、展開後の推定量と制限、Node parser測定から判断した範囲であり、実機GPU全般の性能を保証する値ではありません。
