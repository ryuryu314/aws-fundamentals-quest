# AWS クラウドクエスト

四国めたんと一緒に AWS Certified Cloud Practitioner（CLF-C02）を学ぶ、非公式の試験対策ゲームです。問題は独自に作成した練習問題で、実際の試験問題ではありません。AWS が承認・提供するものではありません。

[ブラウザで今すぐプレイ](https://ryuryu314.github.io/aws-fundamentals-quest/)（ログイン・インストール不要）

## あそび方

- **本試験モード**：65問・90分。分野ごとに 16 / 19 / 22 / 8 問を抽出します。選択肢は単一選択と複数選択があり、問題一覧から移動・見直しマークを付けられます。
- **10問チャレンジ**：制限時間なしでランダムに10問を練習します。
- **苦手を復習**：間違えた問題を最大10問ずつ出題し、正解した問題はリストから外れます。
- 回答・見直し・残り時間はブラウザ内に保存されます。模試の制限時間は中断中も進み、時間切れで提出されます。履歴は直近30回を保存します。
- **読み上げ**：問題画面のプレーヤーで問題文と全選択肢を、結果画面では正解と解説を四国めたんの声で再生します。停止・シーク・速度調整ができ、問題や画面の切り替え時には停止します。音量はプレーヤーまたは端末側で調整できます。音声は再生時に取得するため、閲覧者側に VOICEVOX は不要です。
- 提出後に正答率、分野別結果、解答・解説を確認できます。未回答や選択数が不足した問題は不正解です。

公式試験は65問中50問が採点対象で、15問は採点対象外です。公式の合格基準は換算スコア700点であり、単純な正答率とは異なります。このアプリでは全問を均等に採点して正答率を表示し、公式のスコアや合否を推定しません。出題範囲・サービスの仕様は変更されることがあるため、最新情報は [AWS公式試験ガイド](https://docs.aws.amazon.com/aws-certification/latest/cloud-practitioner-02/) と [試験概要](https://aws.amazon.com/jp/certification/certified-cloud-practitioner/) を確認してください。

## 開発

Node.js 24 を推奨します。

```sh
npm ci
npm run dev
npm test
npm run build
```

ブラウザの `localStorage` を利用します。データは同じブラウザ・同じサイト内に保存され、ブラウザのデータ削除や端末変更によって失われます。アカウント登録やサーバーは不要です。

## クレジットと利用条件

- 四国めたん立ち絵： [東北ずん子・ずんだもんプロジェクト公式素材](https://zunko.jp/con_illust.html#illust_00500)（`public/metan/met011.png`）。画像には配布元の[キャラクター利用ガイドライン](https://zunko.jp/guideline.html)が適用され、本リポジトリの MIT ライセンスの対象外です。利用の際は非商用・商用の条件を各自で確認してください。
- 読み上げ音声：**VOICEVOX:四国めたん（ノーマル）**。VOICEVOX ENGINE 0.26.0 で問題文・選択肢・正解・解説を録音しました。`public/voice` の音声には [VOICEVOX利用規約](https://voicevox.hiroshiba.jp/term/) と [音源利用規約](https://zunko.jp/con_ongen_kiyaku.html) が適用され、コードの MIT ライセンスの対象外です。再利用・再配布時もクレジット表記と両規約の遵守が必要です。
- AWS および関連する名称は Amazon Web Services, Inc. またはその関連会社の商標です。
- アプリのコードと独自問題は [MIT License](LICENSE) です。四国めたんの画像とキャラクターの権利には適用されません。

## 音声の更新

問題を変更した場合は、公式 VOICEVOX ENGINE をローカルで起動してから `npm run voice:generate` を実行してください。`VOICEVOX_URL`（標準：`http://127.0.0.1:50021`）と `FFMPEG_PATH`（標準：`ffmpeg`）を環境変数で指定できます。エンジンは四国めたんのノーマルを名前で選択します。英語のAWSサービス名・略語の読みは `scripts/voice-text.mjs` で管理し、画面の表記を変えずに録音のみ読み替えます。

生成済みファイルは内容と生成条件のハッシュで再利用します。`npm test` は全114問・228ファイルが現在の問題と一致していることを検証します。エンジン本体や ffmpeg は配布物に含めません。

## 公開

`main` への push 時に GitHub Actions がテスト・ビルドし、GitHub Pages へ配信します。GitHub の Settings → Pages で Source を GitHub Actions に設定します。
GitHub Actions の `Generate voice assets` でも録音できます。全分割の成果物を `gh run download RUN_ID --pattern 'voice-*' --dir recordings` で取得し、`node scripts/import-voice.mjs recordings` と `npm test` を実行してください。取り込みは全問題の録音・文章・音声データのハッシュが揃った場合のみ行います。
