# Render Viewer 3D

POV-Rayの明快なシーン構成と、GUIによるリアルタイム確認を組み合わせることを目指した、
パラメータ駆動型の3Dシーン・ライティング確認ツールです。

現在は仕様書の **Phase 2（オブジェクト編集）** まで実装しています。
**Phase 3以降は未実装です。**

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
- Scene Treeでのオブジェクト選択、表示 / 非表示、追加、複製、削除、名前変更
- InspectorでのTransform（位置・回転・スケール）とGeometryパラメータ編集
- Viewportのraycastによる選択とTransformControlsによる直接操作
- `W` / `E` / `R`による移動・回転・スケール切替
- `Delete`による削除、`Ctrl+D` / `Cmd+D`による複製
- 編集内容をSceneModelへ反映し、Three.js Sceneをモデルから同期する構成

マテリアル編集、ライト編集、テクスチャ、PNG出力、JSON入出力、比較機能など、
仕様書のPhase 3以降に該当する機能は未実装です。

## 表示と言語の設定

ヘッダー右側のボタンから表示言語、テーマ、簡易マニュアルを操作できます。
言語とテーマはブラウザ内に保存され、次回アクセス時に復元されます。初回の既定値は日本語・ダークテーマです。
サーバーへの設定送信やCookieは使用しません。

## ローカル実行

Node.js 22を推奨します（Vite 6の対応範囲はNode.js 18 / 20 / 22以上です）。

```bash
npm ci
npm run dev
```

Viteが表示する `/Render-Viewer-3D/` のURLをブラウザで開いてください。

## ビルドとプレビュー

```bash
npm test
npm run build
npm run preview
```

`npm test` はScene Storeの不変性、オブジェクト編集コマンド、Geometry生成、
SceneModelからThree.js Sceneへの追加・削除・差し替えとリソース再利用を検証します。
`npm run build` はprebuildでTypeScriptの型検査を実行後、`dist/`へ静的ファイルを生成します。
GitHub Pagesのプロジェクトパスに合わせ、Viteの`base`は`/Render-Viewer-3D/`です。

## デプロイ

Pull Requestではテストと型検査・ビルドを実行します。`main`ブランチへのpushでは、
検証に加えてPages artifactのアップロードと`github-pages` environmentへのデプロイを行います。

## 構成

```text
src/
├─ app/       # アプリケーションの組み立てとScene Store
├─ model/     # 永続化可能なSceneModel、不変Snapshot、初期シーン
├─ three/     # ViewportとSceneGraphのAdapter
├─ ui/        # 3ペインUIシェル
├─ main.ts
└─ styles.css
```

Three.jsのSceneは永続データの正本にせず、JSON化可能なSceneModelを正本として扱います。
Storeは深くfreezeしたSnapshotを公開し、SceneGraph AdapterがモデルのIDと型を基準に
Three.jsリソースをreconcileします。

## ライセンス

利用ライブラリは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) を参照してください。
