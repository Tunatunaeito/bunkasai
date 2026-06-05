# Un Deux Crois 文化祭クロッフル販売システム

Google Apps Script + Google Sheets をバックエンドにし、GitHub Pages に静的フロントを置く構成です。オンライン決済はなく、受取時間予約と現地 Airペイ 決済に特化しています。

## 納品ファイル

- `index.html`
- `customer.html`
- `cashier.html`
- `handover.html`
- `display.html`
- `admin.html`
- `style.css`
- `script.js`
- `manifest.webmanifest`
- `sw.js`
- `google-apps-script/Code.gs`

## 画面一覧

- `index.html`
  - お客様の注文画面
  - 商品選択、時間枠選択、注文確定
- `customer.html`
  - お客様待機画面
  - 状態、前にいる組数、完成通知表示
- `cashier.html`
  - レジ担当画面
  - 注文番号検索、決済完了
- `handover.html`
  - 受け渡し担当画面
  - 完成、受取完了
- `display.html`
  - 大型モニター表示
  - 完成注文番号一覧
- `admin.html`
  - 運営管理画面
  - 注文一覧、売上、時間枠残数、受付停止、完売切替

## Google Sheets 構成

Apps Script は次の4シートを使います。`Code.gs` が初回実行時に自動作成します。

### 1. `Settings`

| 列 | 内容 |
| --- | --- |
| A | `key` |
| B | `value` |
| C | `note` |

初期キー:

- `store_name`
- `hero_title`
- `hero_message`
- `announcement_message`
- `payment_message`
- `order_stop_message`
- `order_closed_message`
- `sold_out_message`
- `sale_date`
- `sale_start_time`
- `sale_end_time`
- `slot_minutes`
- `default_slot_capacity`
- `accepting_orders`
- `sold_out`

### 2. `Products`

| 列 | 内容 |
| --- | --- |
| A | `active` TRUE/FALSE |
| B | `productId` |
| C | `name` |
| D | `description` |
| E | `price` |
| F | `imageUrl` |
| G | `sortOrder` |

ここを編集すれば、商品名、価格、画像、説明をコード修正なしで変更できます。

### 3. `TimeSlots`

| 列 | 内容 |
| --- | --- |
| A | `active` TRUE/FALSE |
| B | `slotId` |
| C | `label` |
| D | `startTime` |
| E | `endTime` |
| F | `capacity` |
| G | `sortOrder` |

ここを編集すれば、時間枠数、枠の並び、各時間枠の上限数をコード修正なしで変更できます。

補足:

- `setupFestivalSheets` またはスプレッドシート上部メニューの `文化祭クロッフル > 時間枠を再生成` を使うと、`Settings` の開始時刻、終了時刻、枠長、初期上限から `TimeSlots` を作り直せます。
- 当日の細かい調整は `TimeSlots` を直接編集する運用がいちばん早いです。

### 4. `Orders`

| 列 | 内容 |
| --- | --- |
| A | 注文番号 |
| B | 参照トークン |
| C | 名前 |
| D | 学年 |
| E | 受取枠ID |
| F | 受取枠ラベル |
| G | 受取開始 |
| H | 受取終了 |
| I | 商品一覧 |
| J | 個数一覧 |
| K | 商品総数 |
| L | 合計金額 |
| M | 注文時刻 |
| N | 更新時刻 |
| O | ステータス |
| P | 決済時刻 |
| Q | 完成時刻 |
| R | 受取時刻 |
| S | キャンセル時刻 |
| T | 注文JSON |

## ステータス

- `決済待ち`
- `調理待ち`
- `完成`
- `受取済`
- `キャンセル`

自動キャンセル:

- `決済待ち` の注文が受取時間枠終了を過ぎると、自動で `キャンセル` になります。
- キャンセルされた注文は時間枠残数計算から除外されるため、在庫枠が自動で開放されます。

## 当日変更できる項目

次はコード修正不要です。

- 商品名
- 商品価格
- 商品画像
- 商品説明
- 販売開始時間
- 販売終了時間
- 時間枠の長さ
- 各時間枠の上限数
- 受付停止
- 受付再開
- 完売設定
- 案内メッセージ

変更方法:

- 商品系は `Products`
- 時間枠系は `TimeSlots`
- 開始/終了/枠長の初期値は `Settings`
- 受付停止、再開、完売、メッセージは `admin.html` でも変更可能

## Apps Script 設定

1. Google スプレッドシートを作成します。
2. `拡張機能` → `Apps Script` を開きます。
3. 既存コードを削除します。
4. [`google-apps-script/Code.gs`](/Users/tuna/Documents/文化祭/google-apps-script/Code.gs) の中身を丸ごと貼り付けます。
5. `SPREADSHEET_ID` を対象シートのIDに合わせます。
6. `ADMIN_PASSWORD_HASH` を管理用パスワードの SHA-256 にします。
7. `PUBLIC_SITE_URL` を GitHub Pages の公開URLにします。
8. `NOTIFICATION_EMAIL` を運営通知先メールにします。
9. 保存します。
10. `setupFestivalSheets` を一度実行して、権限承認と初期シート作成を行います。
11. `デプロイ` → `新しいデプロイ` → `ウェブアプリ` を選びます。
12. 実行ユーザーは `自分`、アクセスは `全員` にします。
13. 表示された `/exec` URL を `script.js` の `gasWebAppUrl` に設定します。

### SHA-256 の作り方

ブラウザのコンソールで次を実行します。

```js
const text = "ここに管理パスワード";
const bytes = new TextEncoder().encode(text);
crypto.subtle.digest("SHA-256", bytes).then((buffer) => {
  console.log(Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join(""));
});
```

## GitHub Pages 公開手順

1. このフォルダを GitHub リポジトリにアップロードします。
2. GitHub の `Settings` → `Pages` を開きます。
3. `Deploy from a branch` を選びます。
4. ブランチは `main`、フォルダは `/ (root)` を選んで保存します。
5. 数分後に次のURLで公開されます。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

主な公開URL:

- 注文画面: `https://.../`
- 待機画面: `https://.../customer.html?token=...`
- レジ画面: `https://.../cashier.html`
- 受け渡し画面: `https://.../handover.html`
- 管理画面: `https://.../admin.html`
- 完成モニター: `https://.../display.html`

## PWA

- `manifest.webmanifest`
- `sw.js`

が入っているため、iPhone の Safari で `ホーム画面に追加` すればアプリ風に使えます。

更新が反映されない場合:

- Safari を再読み込み
- ホーム画面アプリを一度削除して再追加

## QRコード運用

QRコードのリンク先は注文画面の公開URLです。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

印刷用には `SVG`、SNS共有やスマホ保存用には `PNG` が使いやすいです。

## 現在の初期設定

- 店名: `Un Deux Crois`
- 管理者パスワード: `88888888`
- 通知先: `tunaeito@gmail.com`
- Apps Script URL: `https://script.google.com/macros/s/AKfycby5RqvOCMNI3C34NdgRIiLQ_tyvkNx_bzG_uuqbEJiGDcO8cIPK2gqe3FZbD4Z85FWJHw/exec`

## テスト手順

1. `index.html` で商品と時間枠を選ぶ
2. 注文確定後、`customer.html` に遷移して状態表示を確認
3. `cashier.html` で注文番号を検索し、`決済完了`
4. `handover.html` で `完成`
5. `display.html` に注文番号が出ることを確認
6. `handover.html` で `受取完了`
7. 時間枠終了までに決済しない注文は `キャンセル` に変わることを確認
