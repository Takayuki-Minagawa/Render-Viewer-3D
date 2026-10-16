# 監査追加修正計画（2026-10-16）

## 対象と進め方

添付「コンピューターユース監査」の B-001〜B-008、および修正に必要な取消・保存状態・入力表示の改善を実装する。ユーザー確認済みの範囲であり、R-01〜R-40 全体の機能追加は今回の対象ではない。複数世代保存、ツリー検索、材質パネル統合等は別途計画する。

対象の基準コミットは `4a135bbf2f2186483edb4ff1225dcf8b42f669eb`。監査資料中の過去の試験結果やローカル証拠パスは参考情報として扱い、今回の変更はこのチェックアウトで検証する。調査 → 本計画の作成 → 実装 → 回帰検証の順で進める。外部への投稿・デプロイは行わない。

## GitHubから収集した参考資料

以下をGitHubのraw配信から取得し、現行依存の実装と照合した。Three.jsは導入版と同系列のr185、Comlinkは導入版v4.4.2を参照した。

| 領域 | 資料 | 今回採用する知見 |
| --- | --- | --- |
| カメラ | [Three.js OrbitControls r185](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/controls/OrbitControls.js) | updateは保存座標を設定した後でもminDistance/maxDistanceで距離を補正する。復元と投影切替の前に距離制約を整合させる。 |
| メモリ | [WebGLAttributes](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLAttributes.js)、[WebGLObjects](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLObjects.js)、[WebGLMorphtargets](https://github.com/mrdoob/three.js/blob/r185/src/renderers/webgl/WebGLMorphtargets.js) | CPUのbacking bufferとGPUのattribute単位の割当は異なる。interleaved、instance、morphも区別して保守的に集計する。 |
| Worker RPC | [Comlink README v4.4.2](https://github.com/GoogleChromeLabs/comlink/blob/v4.4.2/README.md)、[Comlink実装](https://github.com/GoogleChromeLabs/comlink/blob/v4.4.2/src/comlink.ts) | RPCはmessage応答を待つ。Worker自身のerror/messageerrorや応答停止を別途監視し、取消・時間上限で待機を終了する。 |
| Worker異常 | MDN GitHub [error](https://github.com/mdn/content/blob/main/files/en-us/web/api/worker/error_event/index.md)、[messageerror](https://github.com/mdn/content/blob/main/files/en-us/web/api/worker/messageerror_event/index.md)、[terminate](https://github.com/mdn/content/blob/main/files/en-us/web/api/worker/terminate/index.md) | 異常をPromiseへ伝播し、タイマー・listener・Workerを必ず解放する。終了イベントが常に届くとは仮定しない。 |
| 保存完了 | [MDN IDBTransaction complete](https://github.com/mdn/content/blob/main/files/en-us/web/api/idbtransaction/complete_event/index.md) | ブラウザ保存済みはtransactionのcommit完了を基準とする。ファイル出力とIndexedDBのrevision・時刻・表示を分離する。 |
| 操作取消 | [MDN inert](https://github.com/mdn/content/blob/main/files/en-us/web/html/reference/global_attributes/inert/index.md) | inert配下はクリック・focus・支援技術から利用できない。取消領域はロック対象の外へ置き、完了後に元のinert状態を戻す。 |
| 数値入力 | [MDN valueAsNumber](https://github.com/mdn/content/blob/main/files/en-us/web/api/htmlinputelement/valueasnumber/index.md) | 空欄・不正入力を0へ変換しない。確定時はモデルの正規化結果を表示へ戻す。 |
| 検索入力 | [MDN compositionstart](https://github.com/mdn/content/blob/main/files/en-us/web/api/element/compositionstart_event/index.md)、[setSelectionRange](https://github.com/mdn/content/blob/main/files/en-us/web/api/htmlinputelement/setselectionrange/index.md) | focusと選択範囲は別の状態。検索欄自身を置き換えず、結果領域のみ更新してキャレット・IMEの入力ノードを維持する。 |
| フォーカス | [WAI-ARIA APG keyboard interface](https://github.com/w3c/aria-practices/blob/main/content/practices/keyboard-interface/keyboard-interface-practice.html) | 更新でfocusを失わない。実際に対象を削除した場合のみ近隣の操作対象へ移す。 |

## 実装順・受入条件

| 項目 | 修正方針 | 回帰確認 |
| --- | --- | --- |
| B-001 カメラ復元 | 保存位置と注視点の距離を余裕を持って包含するOrbitControls制約を設定してからupdate。投影切替にも適用。 | 10mm・通常・100mのFit、名前付き視点、ファイル/自動保存復元、投影切替後にカメラとモデルが一致し、直後の操作で不連続に変わらない。 |
| B-002 STEP待機停止 | error/messageerror、同期起動失敗、初期化/解析の時間上限、AbortSignalを扱うWorker lifecycleを追加。読込ごとに取消signalを作り、ロック外の進行状態/取消UIに接続。 | 初期化異常・解析中異常・応答停止・取消でreject/cleanupし、旧シーン・既存履歴を維持、busy/inertを解除。次の読込・保存・Undoが可能。 |
| B-003 自動保存抑止 | ファイル出力と自動保存のrevisionを分離。手動出力完了でも未保存の自動保存を予約し、各保存先と時刻・ファイル名を別表示。 | 変更から800ms以内に手動保存しても、ダウンロードと後続IndexedDBの両方が最新内容。失敗と競合する非同期処理でも保存済みと誤表示しない。 |
| B-004 数値表示 | ライト/露出/各PBR mapの確定・blur時に正規化後のモデル値を表示。空欄・不正値は適用せず復帰し、補正/無効入力を日英で案内。 | 境界外、空欄、再入力、位置/照射先、全mapでモデルと表示一致。編集確定後のUndoと保存復元を維持。 |
| B-005 検索キャレット | 詳細カタログの検索入力とfilterを保持し、検索結果だけ更新。 | 文頭/途中挿入・選択置換・compositionイベントで入力ノード、順序、選択範囲を維持。実IME実機確認とイベント模擬は区別。 |
| B-006 ツリーフォーカス | ID単位で行を再利用し、名称・表示・選択状態を更新。削除時のみ近隣へfocus。 | 同一ボタンをSpaceで往復操作、別行の変更でもfocus維持。実際の削除時の移動先を検証。 |
| B-007 材質使用数 | インスペクターの初期生成と更新で既存の共通材質使用数関数を使用。 | primitive、読込root、子nodeの混在と解除でライブラリと件数一致。共有先一覧の新規UIは今回追加しない。 |
| B-008 メモリ概算 | CPU backing bufferを一度、GPU attribute/interleaved ownerを割当単位で加算。morph/instanceを含める。 | 別view・重複view・共有attribute・interleaved・morph・instance、履歴上限と復元失敗時の解放を確認。GPU実測値とは表示しない。 |

カメラ/メモリ、Worker、数値UI、検索/ツリー/使用数を独立して実装し、ProjectControllerとアプリ接続部は一担当で統合する。既存保存形式の互換と依存バージョンを維持する。今回の修正に不要なライブラリ更新・全40要望の追加・性能の保証は含めない。

## 検証計画

1. 各原因を再現する単体/DOMテストと、実ブラウザでのみ確認できるfocus・キャレット・WebGL・取消の回帰試験を追加する。
2. 変更ごとに対象テストを実行し、全体を `RV3D_UNIT_TEST=1 node --test --test-concurrency=4 tests/*.test.mjs` で確認する。既存 `npm test` ランナーはこの環境で60秒制限に達するため、同じファイル群を直接実行する。
3. `npm run build` で型検査と配布ビルドを確認する。
4. クラウド用Playwright設定 `/workspace/.cloud-setup/render-viewer-3d/playwright.config.mjs` と既存Chromiumを使い、新規回帰試験、関連する既存E2E、配布版の代表試験を実行する。描画を含む試験は1 workerで動かす。
5. 実行した件数、失敗/skip、残る制約、変更ファイルを記録する。実機IME、Firefox/WebKit、物理GPUを未実行なら成功扱いにしない。

## 実施記録

- GitHub調査と本計画の作成後、B-001〜B-008を実装した。保存形式と依存バージョンの変更はない。
- カメラ復元・投影切替で必要な距離制約を拡張し、読込アセットのメモリ概算をCPU backing bufferとGPU割当単位に分離した。morph・instance属性も含める。
- STEPの初期化は30秒、各解析RPCは120秒、後処理は5秒を上限にした。Workerのerror/messageerror、取消、応答停止を終了処理へ接続し、未完了RPCのlistenerも解放する。読み込み用の取消ダイアログは編集領域のinertから独立させ、終了時に元の操作状態とフォーカスを戻す。
- 手動ファイル出力とブラウザ自動保存のrevision・状態・完了時刻を分離した。ファイル名と時刻は現在のセッションでの結果を表示する。ファイル出力完了はダウンロード開始までを指し、OS側の書込完了を判定するものではない。
- 数値入力は確定・blur後にモデルの正規化値を表示し、空欄・不正値を適用しない。検索欄を保持して結果だけ更新し、ツリー行はIDで再利用する。材質使用数はインスペクターとライブラリで同じ集計を使用する。
- 単体・DOMテストは **415件成功、失敗・skipなし**。`RV3D_UNIT_TEST=1 node --test --test-concurrency=4 tests/*.test.mjs` を使用した。IDBのrequest成功とtransaction完了の区別、保存競合、容量エラー、取消時の資産解放と履歴維持も検証した。
- `npm run build` 成功（TypeScript型検査を含む）。既存のNode組込みモジュール外部化と500 kB超chunkの警告は残る。
- 新規Chromium回帰テスト **14件成功**。初回の13件成功後、ライト表示のテストが別パネルの同名要素も取得していたためselectorを対象パネルに限定し、残り1件を再実行して成功した。
- 関連する既存Chromium E2E **6件成功**（`project.spec.ts` 5件、`material-maps.spec.ts` 1件）。modalのfocus判定は初回にブラウザの応答8.73秒が既定5秒を超えた。trace上ではfocus拒否が成功していたため、条件を維持して待機枠を15秒にし、対象dialogの明示と操作再開後のfocus確認を追加して再実行した。
- `RV3D_PREVIEW=1` による配布ビルドの代表試験 **4件成功**（`production.spec.ts` 3件、`viewport.spec.ts` のidle/PNG/GLB出力1件）。公開base pathでの読込・復元、圧縮モデル/STEPの遅延ロード、HDR・照明のUndo/保存復元を確認した。
- Chromiumは新規14件・既存6件・配布版4件の **計24件成功**。`git diff --check` も成功した。
- ブラウザ検証はこのクラウド環境のChromium・ソフトウェア描画で実施した。Firefox/WebKit、物理GPU、実機IMEは未検証。IMEについてはcompositionイベントを模擬し、入力ノードと選択範囲の維持を検証した。

### 主な変更箇所

| 領域 | 実装 | 追加・拡張したテスト |
| --- | --- | --- |
| カメラ・メモリ | `src/three/camera-constraints.ts`、`scene-adapter.ts`、`imported-asset-store.ts` | `tests/audit-camera.test.mjs`、`imported-memory-estimate.test.mjs`、`tests/e2e/audit-camera.spec.ts` |
| Worker・取消 | `src/importers/worker-lifecycle.ts`、`STEPImporter.ts`、`src/ui/project-operation.ts`、`import-dialog-controller.ts`、`src/app/create-application.ts` | `tests/worker-lifecycle.test.mjs`、`importers-step.test.mjs`、`tests/e2e/audit-project.spec.ts` |
| 保存・履歴 | `src/app/project-controller.ts`、`src/ui/project-toolbar.ts` | `tests/project-controller-audit.test.mjs`、`tests/e2e/audit-project.spec.ts` |
| 数値入力 | `src/ui/committed-number-input.ts`、`appearance-tools.ts`、`material-map-tools.ts` | `tests/audit-numeric-inputs.test.mjs`、`tests/e2e/audit-numeric.spec.ts` |
| 検索・使用数・ツリー | `src/ui/material-detail-view.ts`、`material-library-view-base.ts`、`scene-editor-view.ts`、`scene-tree-view.ts`、`src/model/material/material-commands.ts` | `tests/audit-material-ui.test.mjs`、`scene-tree-reconciliation.test.mjs`、`tests/e2e/audit-material.spec.ts`、`audit-tree.spec.ts` |

利用方法の変更は `README.md` に記載した。
