# 追加機能と検証・採否記録

2026-09-22。既存のモデル表示、保存・履歴、インポート機能を拡張した記録です。使い方と制限は[README](../README.md#出力計測の範囲)を参照してください。

## 実装範囲

| 対象 | 結果 |
| --- | --- |
| W0：運用 | 検証workflowを削除。GitHub Actionsは手動のPages公開のみ。独立のテストjobやPR/push起動を設置しない |
| W1／F1：PNG | 任意解像度・Full HD・4K・透過背景・縦横比固定。alpha対応rendererの出力bufferを同期captureし、画面と同じtone mapping・blend順序を維持。描画設定を復元 |
| W2／F2：レビュー | 複数視点、camera／clip／cap／表示／隔離、静的mesh上の注記、再取付、Undo、project／autosaveへの保存。schema 1／2→3移行 |
| W3／F6：glTF診断 | Khronos Validatorを遅延Workerで実行。選択済みローカルresourceだけを解決。JSONレポート、件数／容量／時間制限、取消 |
| W4／F3：計測 | 複数距離・3点角度・world AABB、頂点スナップ、名称／単位／削除、project／Undo。表示位置と値は現在のtransformから算出 |
| W5／F4：STEP | 固定occt-wasm 4.3.1のXCAF→GLB経路で階層・部品名・色・複数配置を保持。旧flatten保存形式を識別して復元 |
| W6／F5：cap | 単一平面のstencil表示。閉じた不透明meshに限定し、PNGにも反映。cap自身を選択・計測・GLBに含めない |
| W7／F7：BVH | 採用条件未達のため未導入。下記の端末・fixtureでは通常raycastのp95が50 ms以内。再測定用scriptを保存 |
| W8／F8：GLB整理 | accessorの重複・未使用データ整理を採用。名前・階層・材質・animationを保持する範囲に限定。削減しなければ元出力を返す |

形状簡略化・texture再圧縮は今回は提供しません。F8は可逆な数値データ整理だけで複数fixtureの削減効果が確認でき、非可逆処理の追加を要しなかったためです。BVHと同じく、未導入の機能を実装済みとして扱いません。

## 設計と制限

- 注記・距離・角度はroot ID／node ID／local座標／geometry fingerprintを保存し、runtime asset IDを参照キーにしません。参照切れは非表示・未解決とし、Undoや注記の再取付で復旧します。
- 静的surfaceの計測でありskin／morph・animation surface追従は対象外です。外形寸法はworld AABBです。
- capは閉じたmeshの検査を通る形状だけに適用し、検査費用を抑えるため1mesh 20万triangleまで。CADの切断geometryは生成しません。
- PNGは最大4096×4096。GPUのtexture／renderbuffer上限も検査します。描画buffer・depth/stencil・MSAA・PNG encodingの作業領域が必要で、上限での実機GPU動作を一律保証するものではありません。出力cameraはrendererごとに投影別で再利用し、ガラス材質の内部textureが出力ごとに蓄積しないようにします。
- glTF診断と整理は新規Workerを処理ごとに作り、取消・30秒timeout・完了時に終了します。入力のbyte列を元sceneと分離し、外部URIは取得しません。
- 過去の[実装・検証記録](./IMPLEMENTATION_VALIDATION.md)にあるCI運用は当時の履歴です。現在はPages公開以外のGitHub Actionsを使用しません。

PNGは当初の「linear render target＋出力postprocess」案から変更しました。半透明の重なりとtoneMapped無効の補助表示で画面との色差が確認されたためです。renderer生成時からalphaを有効にし、出力用cameraと指定解像度で通常と同じ描画経路を使います。`toBlob`が同期取得するbitmapを利用し、encodingの完了を待たずに画面サイズ・pixel ratio・背景・補助表示を復元します。

## 選択処理の測定とBVH採否

端末：Apple M4 Max、macOS Darwin 25.6.0 arm64、Three.js r185。fixtureは `SphereGeometry(1, 1024, 512)`、1,046,528 triangles、indexed、DoubleSide。20回warm-up後、周囲の異なる視点から中心へ100rayを発射し、全交点を取得しました。clip時の可視判定を維持するため、比較対象は最初の交点だけを返す方式ではありません。

| 実行環境 | 中央値 | p95 | 最大 |
| --- | ---: | ---: | ---: |
| Node.js v22.18.0 | 36.60 ms | 37.53 ms | 38.02 ms |
| Chromium 153.0.8010.12 | 28.70 ms | 29.60 ms | 31.50 ms |

採用基準の「通常raycast p95 > 50 ms」を超えなかったためBVHは導入しません。速度が遅い端末や別の実データで問題が出れば再評価します。この測定はFPS、click-to-display、GPUメモリ、全モデルの速度保証ではありません。

```bash
node scripts/benchmark-raycast.mjs
# ローカル開発serverを4173で起動してから
node scripts/benchmark-raycast-browser.mjs
node scripts/benchmark-gltf-tools.mjs
```

## 一次資料

- [Three.js renderer](https://threejs.org/docs/pages/WebGLRenderer.html)／[r185 stencil sample](https://github.com/mrdoob/three.js/blob/r185/examples/webgl_clipping_stencil.html)：PNG出力とcapのAPI・描画方式。
- [model-viewer annotations](https://modelviewer.dev/examples/annotations)：モデル上の注記・寸法表示の設計参考。runtime依存としては未導入。
- [occt-wasm v4.3.1](https://github.com/andymai/occt-wasm/releases/tag/v4.3.1)：固定版のXCAF／GLB出力を利用。上流mainの新APIを前提にしない。
- [Khronos glTF Validator](https://github.com/KhronosGroup/glTF-Validator)／[glTF Transform](https://github.com/donmccurdy/glTF-Transform)：診断とデータ整理。採用版・ライセンスはlockfileと[第三者通知](../THIRD_PARTY_LICENSES.md)に固定。
- [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh)：性能候補として評価。今回は依存を追加していない。
- [GitHub Pages workflow](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：許可された公開用途だけに使用。
