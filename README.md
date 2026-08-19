# Render Viewer 3D

TypeScriptとThree.jsで構築した、ブラウザ上で3Dプリミティブを追加・編集・確認できる、
パラメータ駆動型の3Dシーンエディターです。

> A browser-based, parameter-driven 3D scene editor built with TypeScript and Three.js.

現在は **Phase 2（オブジェクト編集）** まで実装しています。
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
- Scene Treeでのオブジェクト選択、表示 / 非表示、プリミティブ追加
- Inspectorでの名前変更、複製、削除、Transform（位置・回転・スケール）とGeometryパラメータ編集
- Viewportのraycastによる選択とTransformControlsによる直接操作
- `W` / `E` / `R`による移動・回転・スケール切替
- `Delete`による削除、`Ctrl+D` / `Cmd+D`による複製
- 編集内容をSceneModelへ反映し、Three.js Sceneをモデルから同期する構成

## 現在の制限

- マテリアル編集、ライト編集、テクスチャ、PNG出力、JSON入出力、比較機能は未実装です。
- シーンの保存・復元には未対応のため、ページを再読み込みすると編集内容は初期状態に戻ります。
- 外部の3Dモデルやテクスチャの読み込みには対応していません。

## 表示と言語の設定

ヘッダー右側のボタンから表示言語、テーマ、簡易マニュアルを操作できます。
言語とテーマはブラウザ内に保存され、次回アクセス時に復元されます。初回の既定値は日本語・ダークテーマです。

## プライバシーと外部通信

- シーンの内容はブラウザのメモリ内で処理し、外部サーバーへ送信しません。
- `localStorage`は表示言語とテーマの保存にだけ使用します。
- Analytics、Cookie、外部API、外部CDNは使用していません。

## ローカル実行

Node.js 22を推奨します（対応範囲はNode.js 18 / 20 / 22以上です）。

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
SceneModelからThree.js Sceneへの追加・削除・差し替え、リソース再利用、
TransformControls操作中のモデル同期を検証します。
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

本リポジトリ固有のソースコードには、現時点でオープンソースライセンスを設定していません。
Publicリポジトリとして閲覧できますが、オープンソースとしての利用許諾を示すものではありません。

利用ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) を参照してください。
