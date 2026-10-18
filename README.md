# 婚礼美容シフト調整

婚礼美容室（メイク・着付け）の当日シフトを作り、施術枠にスタッフを自動で割り当てるWebアプリです。
claude.ai で作ったアプリを、このリポジトリで動く普通のWebページに作り直したものです。
スタッフ全員で同じデータを共有でき、スマートフォンからも使えます。

## できること

- **シフト表**：スタッフごとの時間軸（6:00〜20:00）に施術を表示。ブロックを押すと候補スタッフとマッチ度の内訳を表示
- **自動割り当て**：技術・レベル・勤務時間・指名・英語対応・評価をもとに点数をつけ、重なり（前後10分の余裕つき）がないように割り当て
- **手動の固定**：「この人に変更」で固定した担当は、自動割り当てをやり直しても残る
- **予定・施術**：日付ごとにご家族と施術枠を登録・編集・削除
- **スタッフ**：名前・担当・レベル・評価・技術・勤務時間を登録。日ごとに欠勤や勤務時間を変更
- **Excel**：テンプレートのダウンロード、取り込み（確認画面つき）、表示中の日の書き出し
- **LINEで送る**：表示中の日のシフトを文面にしてLINEで共有
- **バックアップ**：全データをJSONファイルに保存・復元
- **全員で共有**：Googleアカウントでログイン。登録したメンバーだけが見られ、誰かが変更するとみんなの画面にすぐ反映

---

## はじめての設定（最初に1回だけ）

全部で4ステップ、15〜20分ほどです。パソコンで行うのがおすすめです。

### ステップ1：Firebase のプロジェクトを作る（データの保存先）

1. <https://console.firebase.google.com/> を開き、Googleアカウントでログイン
2. 「プロジェクトを作成」→ 名前（例：`bridal-shift`）を入れて進む（Googleアナリティクスはオフで大丈夫）
3. 左のメニュー「構築」→ **Firestore Database** →「データベースの作成」
   - ロケーションは **asia-northeast1（東京）** を選ぶ
   - 「本番環境モードで開始」を選んで作成
4. 左のメニュー「構築」→ **Authentication** →「始める」→「Google」を選んで **有効にする** → 保存

### ステップ2：セキュリティルールと最初のメンバーを登録する

1. Firestore Database の「**ルール**」タブを開き、中身をすべて消して、このリポジトリの [`firestore.rules`](firestore.rules) の内容を貼り付けて「公開」
2. Firestore Database の「**データ**」タブで「コレクションを開始」
   - コレクションID：`config`
   - ドキュメントID：`members`
   - フィールド：名前 `emails`、タイプ **array**、値（string）に **あなたのGmailアドレス（すべて小文字）** を入れて保存

> 2人目以降のスタッフは、アプリの「スタッフ」タブ →「アプリを使える人」から追加できます。

### ステップ3：アプリに Firebase の設定を入れる

1. Firebase のトップ画面で「</>（ウェブ）」アイコンを押してアプリを追加（名前は何でもOK、Hostingのチェックは不要）
2. 表示される `firebaseConfig = { ... }` の `{ ... }` の部分をコピー
3. このリポジトリの [`firebase-config.js`](firebase-config.js) の `null` をその内容に置き換える

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "bridal-shift-xxxx.firebaseapp.com",
  projectId: "bridal-shift-xxxx",
  storageBucket: "bridal-shift-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

（この値は公開されても問題ありません。データはログインとセキュリティルールで守られます）

### ステップ4：GitHub Pages で公開する（スマホで開けるようにする）

1. GitHub のこのリポジトリ →「Settings」→ 左の「**Pages**」
2. 「Build and deployment」の Source を **GitHub Actions** にする
3. `main` ブランチに変更が入ると自動で公開されます。公開先のURLは
   **<https://shohei182.github.io/first-app/>** です
4. Firebase の Authentication →「設定」→「**承認済みドメイン**」に `shohei182.github.io` を追加

これで完了です。URLをLINEなどでスタッフに送り、スマホのブラウザで開いて「Googleでログイン」してもらいます。
（あらかじめ「アプリを使える人」にその人のGmailを追加しておいてください）

**ホーム画面に追加すると、アプリのように開けます。**
- iPhone（Safari）：共有ボタン →「ホーム画面に追加」
- Android（Chrome）：右上のメニュー →「ホーム画面に追加」

---

## Firebase を設定しない場合

`firebase-config.js` が `null` のままなら、**開いているブラウザの中だけ**にデータを保存します（1人で試す時向け）。
端末ごとにデータは別々で、ブラウザのデータを消すと消えるので、「Excel」タブの「バックアップ」でときどき保存してください。

## 手元で動かす

ビルドは不要です。簡易サーバーで配信して開きます。

```sh
python3 -m http.server 8000
# http://localhost:8000/ を開く
```

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `index.html` | 画面の構成 |
| `style.css` | 見た目（ライト・ダークモード、スマホ対応） |
| `app.js` | マッチング・割り当て・画面描画・Excel・LINE共有・メンバー管理 |
| `store.js` | データの保存（Firebase またはブラウザ）とログイン |
| `firebase-config.js` | Firebase の設定（ステップ3で入れる） |
| `firestore.rules` | Firebase のセキュリティルール（ステップ2で貼り付ける） |
| `.github/workflows/pages.yml` | GitHub Pages への自動公開 |
