# glTF診断・軽量化コピーの実装と検証記録

検証日: 2026-09-22。ローカル環境: macOS arm64 / Node.js 22.18.0。GitHub Actionsは利用していない。

## 採用した範囲

- glTF Validator `2.0.0-dev.3.10`を操作時にWorkerで読み込み、ローカルglTF/GLBと選択済みsidecar、または現在のsceneのGLB snapshotを診断する。
- レポートは最大1,000 issue、1件のmessageは2,048文字、pointerは1,024文字、全体は4 MiBまで。入力は1ファイル64 MiB・合計128 MiB・256ファイル、declared allocationの保守的合算上限256 MiB。
- Workerは1操作ごとに作り、成功・失敗・取消・30秒timeout・画面破棄で終了する。外部URIは既存LocalResourceResolverで拒否し、未選択sidecarはIO_ERRORとしてレポートする。元のimport preflightは変更しない。
- @gltf-transform/core / extensions / functions `4.5.0`固定版のWebIOを使用。現在のsceneから作成した独立GLB snapshotを入力とし、accessorの重複除去と未使用accessor/buffer整理だけを行う。
- node/mesh/materialの名前・階層・材質値・animation・skin joint/weight・morph targetを保持する。別形状への簡略化、テクスチャ変換、Node専用Sharp処理、モデル送信は行わない。未知の拡張、外部/data URI、Draco/Meshopt/Basis圧縮を含むGLBは変換対象外とする。
- 元GLBと変換後GLBのValidator errorが0の場合だけ提供し、削減できなければ元GLBコピーを返してUIで説明する。元のscene・入力byte列を変更しない。
- 日本語/英語の独立パネルにissue分類・pointer、未検証拡張、byte前後比較、処理時間、report保存、copy保存、取消を設けた。生成レポートはprojectやUndoに保存しない。

## 軽量化の採用判断

`RV3D_UNIT_TEST=1 node scripts/benchmark-gltf-tools.mjs`で再現できる。fixtureは自作の三角形部品、各部品に異なるnode/mesh/material名、入れ子group、同一の数値データを持つ。animationありfixtureにはtranslation trackを含む。SDKを1回warmupし、5回の中央値を記録した。

| fixture | 元bytes | 出力bytes | 削減 | median | 作業領域のbyteベース概算 | Validator error/warning |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 3部品・animationあり | 2,388 | 1,776 | 25.6% | 2.10 ms | 17,880 bytes | 0 / 0 |
| 20部品・animationあり | 12,216 | 6,348 | 48.0% | 3.76 ms | 85,992 bytes | 0 / 0 |
| 1部品・animationなし | 832 | 832 | 0.0% | 0.66 ms | 6,656 bytes | 0 / 0 |

作業領域は `inputBytes × 6 + candidateBytes × 2` によるbyteベースの概算であり、実際のJS heap peak、GPUメモリ、ブラウザ全体の上限を表さない。時間にはValidatorとSDKの変換を含むが、Worker起動・scene snapshot作成・downloadは含まない。小規模な合成fixtureでの結果であり、一般のCADモデルや全端末の削減率・速度は保証しない。

複数fixtureの削減と本アプリと同じThree.js GLTFLoaderによる再読込を確認できたため、この限定presetを採用した。簡略化は誤差・境界・skin/morphの保持条件を別途検証しておらず、今回の採用対象外とした。

## ローカル検証

`RV3D_UNIT_TEST=1 node --test tests/asset-tools.test.mjs`:

- 正常GLB、不正accessor、ローカルsidecar、欠落sidecar、HTTP URI拒否、unknown extension。
- 複数fixtureのbyte削減、元byte不変、階層・名前・材質・animationの再読込、skin/morph保持。
- 削減なしの元コピー返却、未対応拡張/外部参照の変換拒否、Workerの取消・timeout・成功時のterminate。

`npx playwright test tests/e2e/asset-tools.spec.ts --project=chromium`:

- 実ブラウザWorkerでValidator・最適化が完了し、外部通信が発生しないこと。
- 入力選択から診断結果とJSON report download、現在sceneの軽量化copy保存準備までのUI操作。

配布buildではWorker/SDK/Validatorを別chunkへ出力する。devではViteの初回依存発見による画面reloadを避けるため対象ライブラリをprebundle対象に登録する。Node用SDKコードのbrowser externalization警告はあるがWebIOのみ使用し、Sharp/native binaryはPages配布物に含まれない。全ライセンスは `public/licenses/glTF-Tools-LICENSES.txt` に収録した。

ブラウザ検証結果: Chromium dev 2件・production preview 1件、Firefox dev 2件、WebKit dev 2件が成功。unitは8件成功。SDKのNode側transitive依存の最低版を踏まえ、開発/build環境のNode要件を22以上に統一した（Pagesも22）。
