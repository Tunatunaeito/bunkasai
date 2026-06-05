# Un Deux Crois 注文予約システム

HTML / CSS / JavaScript を GitHub Pages に置き、Google Apps Script + Google Sheets をバックエンドにする構成です。支払い機能なしで、注文予約、編集、キャンセル、管理、完成表示まで動きます。

現在の設定内容:

- 店名: `Un Deux Crois`
- 注文 API URL: `https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec`
- 商品:
  - `シュガーバタークロッフル` `¥400`
  - `チョコクロッフル` `¥450`
  - `ベリークリームクロッフル` `¥500`

## 納品ファイル

- `index.html`: お客様向け注文画面
- `edit.html`: 注文変更・キャンセル画面
- `admin.html`: 管理画面
- `display.html`: 完成表示画面
- `style.css`: 共通デザイン
- `script.js`: 共通ロジック
- `manifest.webmanifest` / `sw.js`: PWA 用
- `google-apps-script/Code.gs`: Google Apps Script
- `assets/*.svg`: 商品画像とアプリアイコン

## 1. Google Sheets 構成

Apps Script をこのスプレッドシートに紐づけて使います。`Code.gs` は初回実行時に `Orders` シートとヘッダーを自動作成します。

保存列は次の通りです。

| 列 | 項目 |
| --- | --- |
| A | 注文番号 |
| B | 編集トークン |
| C | 名前 |
| D | 学年 |
| E | 商品名 |
| F | 個数 |
| G | 合計金額 |
| H | 注文時刻 |
| I | 更新時刻 |
| J | ステータス |
| K | 注文JSON |

## 2. Google Apps Script 設定

1. Google スプレッドシートを新規作成します。
2. `拡張機能` → `Apps Script` を開きます。
3. 既存コードを削除し、[`google-apps-script/Code.gs`](/Users/tuna/Documents/文化祭/google-apps-script/Code.gs) の内容を丸ごと貼り付けます。
4. もし Apps Script をスプレッドシートに紐づけず単体で作っている場合は、`SPREADSHEET_ID` に対象スプレッドシートのIDを入れます。
5. `ADMIN_PASSWORD_HASH` を自分の管理パスワードの SHA-256 ハッシュに置き換えます。
6. 商品を変更したい場合は `PRODUCT_CATALOG` を編集します。
7. 保存します。
8. `デプロイ` → `新しいデプロイ` → `種類の選択` で `ウェブアプリ` を選びます。
9. 実行ユーザーは `自分`、アクセスできるユーザーは `全員` にします。
10. デプロイ後に表示される Web アプリ URL をコピーします。

### SPREADSHEET_ID の取り方

Google スプレッドシートの URL が次のような場合:

```text
https://docs.google.com/spreadsheets/d/ここがID/edit#gid=0
```

`/d/` と `/edit` の間の文字列が `SPREADSHEET_ID` です。

### SHA-256 ハッシュの作り方

管理用パスワードを決めて、ブラウザのコンソールで次を実行するとハッシュを作れます。

```js
const text = "ここに管理パスワード";
const bytes = new TextEncoder().encode(text);
crypto.subtle.digest("SHA-256", bytes).then((buffer) => {
  console.log(Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join(""));
});
```

## 3. フロントエンド設定

[`script.js`](/Users/tuna/Documents/文化祭/script.js) の `gasWebAppUrl` は設定済みです。

```js
gasWebAppUrl: "https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec",
```

このリポジトリでは、店名 `Un Deux Crois` とクロッフル3商品を設定済みです。

重要:

- `script.js` の `products`
- `Code.gs` の `PRODUCT_CATALOG`

この 2 か所の商品ID・商品名・価格は必ずそろえてください。

重要:

Apps Script を先にデプロイ済みでも、今回 `Code.gs` の商品内容をクロッフル屋向けに更新しています。[`google-apps-script/Code.gs`](/Users/tuna/Documents/文化祭/google-apps-script/Code.gs) を Apps Script 側に貼り直して、同じデプロイを更新してください。

2026年6月5日に確認したところ、共有された Apps Script URL は `NO_SPREADSHEET` を返していました。Apps Script を単体で作っている場合は、`SPREADSHEET_ID` の設定も必要です。

## 4. GitHub Pages 公開手順

1. このフォルダ一式を GitHub リポジトリにアップロードします。
2. GitHub のリポジトリ画面で `Settings` → `Pages` を開きます。
3. `Build and deployment` の `Source` で `Deploy from a branch` を選びます。
4. ブランチは `main`、フォルダは `/ (root)` を選んで保存します。
5. 数分待つと `https://ユーザー名.github.io/リポジトリ名/` で公開されます。
6. 公開 URL で `index.html` が開くことを確認します。

プロジェクトサイトなので、公開URLの例は次の形です。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

## 5. 管理画面と完成表示画面

- 管理画面: `https://.../admin.html`
- 完成表示画面: `https://.../display.html`
- 注文変更画面: 注文完了後に表示される編集URL

大型モニターには `display.html` をフルスクリーン表示してください。

## 6. QRコード作成方法

1. GitHub Pages の注文ページ URL をコピーします。
2. QR コード作成機能のあるブラウザ共有メニュー、または任意の QR コード作成サービスに URL を貼り付けます。
3. できた QR コードを印刷して模擬店前に掲示します。
4. 読み取り先は `index.html` ではなく、公開ルート URL にしておくと分かりやすいです。

例:

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

## 7. 運用メモ

- 注文番号は `#101` から連番で発行されます。
- 注文変更時は同じ行を上書きします。
- キャンセル時は削除せず、ステータスだけ `キャンセル` に変わります。
- 管理画面では `受付中 / 調理中 / 完成 / 受取済み / キャンセル` に変更できます。
- 完成表示画面は 5 秒ごとに自動更新します。
- 編集URLはランダムな長いトークンで管理しています。

## 8. 先に確認するポイント

- `script.js` の `gasWebAppUrl` は設定済みか
- `Code.gs` の `ADMIN_PASSWORD_HASH` を設定したか
- 商品設定を `script.js` と `Code.gs` の両方でそろえたか
- Apps Script を `全員` アクセスで再デプロイしたか

## 9. 今の状態からのおすすめ手順

1. [`google-apps-script/Code.gs`](/Users/tuna/Documents/文化祭/google-apps-script/Code.gs) の最新内容を Apps Script に貼り直します。
2. Apps Script が単体プロジェクトなら `SPREADSHEET_ID` を、紐づけ型ならそのままでOKです。
3. `ADMIN_PASSWORD_HASH` を自分の管理パスワードのハッシュに設定して保存します。
4. Apps Script の `デプロイを管理` から、既存のウェブアプリを編集して再デプロイします。
5. このフォルダを GitHub にアップロードして GitHub Pages を有効化します。
6. 公開 URL にスマホでアクセスして、注文画面が `Un Deux Crois` になっていることを確認します。
7. その公開 URL を QR コード化して掲示します。

## 参考リンク

- GitHub Pages の概要: https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
- GitHub Pages の公開元設定: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Apps Script Web アプリ: https://developers.google.com/apps-script/guides/web
- Apps Script Content Service: https://developers.google.com/apps-script/guides/content
