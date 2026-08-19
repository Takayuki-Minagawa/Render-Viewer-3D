# Render Viewer 3D

POV-Rayの明快なシーン構成と、GUIによるリアルタイム確認を組み合わせることを目指した、
パラメータ駆動型の3Dシーン・ライティング確認ツールです。

現在は仕様書の **Phase 1（最小3Dビュー）** を実装しています。

## 公開ページ

<https://takayuki-minagawa.github.io/Render-Viewer-3D/>

## Phase 1の機能

- TypeScript + Vite + Three.jsによる静的Webアプリ
- Perspective Camera / WebGL Renderer
- OrbitControlsによる回転・パン・ズーム
- Grid / Axesの表示切替
- 初期Box、Ground Plane、固定Ambient / Directional Light
- カメラの初期視点リセット
- SceneModel → Store → Three.js Adapterの分離構成
- GitHub ActionsによるGitHub Pagesデプロイ

オブジェクト編集、マテリアル編集、ライト編集、テクスチャ、PNG出力、JSON入出力、
比較機能は仕様書どおりPhase 2以降で段階的に実装します。

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

`npm test` はScene Storeの不変性と、SceneModelからThree.js Sceneへの追加・削除・差し替えを検証します。
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
