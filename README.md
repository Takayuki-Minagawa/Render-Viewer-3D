# Render Viewer 3D

TypeScriptとThree.jsで構築した、ブラウザ上で3Dプリミティブを追加・編集・確認できる、
パラメータ駆動型の3Dシーンエディターです。

> A browser-based, parameter-driven 3D scene editor built with TypeScript and Three.js.

現在は **Phase 3（共有マテリアル管理とリアルタイムWebGLプレビュー）** まで実装しています。
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
- ローカル画像・HDRIの読込、テクスチャのサンプラー管理には対応していません。
- Three.js/WebGLによる表示であり、POV-Rayとのピクセル互換性はありません。
- シーンのファイル保存・復元には未対応のため、ページを再読み込みすると編集内容は初期状態に戻ります。
- ライト編集、AO、PNG出力、JSON入出力、比較機能は未実装です。
- 外部の3Dモデルの読み込みには対応していません。

## 表示と言語の設定

ヘッダー右側のボタンから表示言語、テーマ、簡易マニュアルを操作できます。
言語とテーマはブラウザ内に保存され、次回アクセス時に復元されます。
初回の既定値は日本語・ダークテーマです。

## プライバシーと外部通信

- シーンの内容はブラウザのメモリ内で処理し、外部サーバーへ送信しません。
- `localStorage`は表示言語とテーマの保存にだけ使用します。
- Analytics、Cookie、外部API、外部CDNは使用していません。
- 対応状況一覧の公式資料リンクを利用者が開いた場合に限り、ブラウザがリンク先のPOV-Ray公式サイトへアクセスします。シーンデータは送信しません。

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
npm run typecheck
npm run build
npm run preview
```

`npm test` はScene Storeの不変性、オブジェクト編集コマンド、Geometry生成、
マテリアルプリセットと管理コマンド、SceneModel v1からv2への移行、ライブラリ検索、
Three.js材質への投影、共有リソースの再利用・破棄、IORのプレビュー制限、
TransformControls操作中のモデル同期を検証します。
`npm run build` はprebuildでTypeScriptの型検査を実行後、`dist/`へ静的ファイルを生成します。
GitHub Pagesのプロジェクトパスに合わせ、Viteの`base`は`/Render-Viewer-3D/`です。

## デプロイ

Pull Requestではテストと型検査・ビルドを実行します。`main`ブランチへのpushでは、
検証に加えてPages artifactのアップロードと`github-pages` environmentへのデプロイを行います。

## 構成

```text
src/
├─ app/             # アプリケーションの組み立てとScene Store
├─ model/           # 永続化可能なSceneModel、不変Snapshot、初期シーン
│  └─ material/    # マテリアルモデル、プリセット、操作、移行、対応状況カタログ
├─ three/           # ViewportとSceneGraphのAdapter
│  └─ material/    # MeshPhysicalMaterialへの投影、共有runtime、環境反射
├─ ui/              # 3ペインUIシェルとマテリアルライブラリ
├─ main.ts
└─ styles.css
```

Three.jsのSceneは永続データの正本にせず、JSON化可能なSceneModelを正本として扱います。
Storeは深くfreezeしたSnapshotを公開し、SceneGraph AdapterがモデルのIDと型を基準に
Three.jsリソースをreconcileします。現在はSceneModelをファイルへ保存するUIはありません。

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
GitHub Pagesの配布物には、実行時に使用するThree.jsのライセンス通知を
`THIRD_PARTY_LICENSES.txt`として同梱します。
