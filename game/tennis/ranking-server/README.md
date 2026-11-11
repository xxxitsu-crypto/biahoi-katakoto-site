# アザラシテニス共有ランキングの接続

ゲームは既存の GitHub Pages のまま利用します。共有記録の保存には Cloudflare Workers と D1 のアカウント設定が必要です。未設定時に端末内記録を共有ランキングとして表示する処理はありません。

## 接続手順

1. このディレクトリで `npx wrangler login` を実行。
2. `npx wrangler d1 create azarashi-tennis-ranking` でデータベースを作成。
3. 返された database_id を wrangler.jsonc に設定。
4. `npx wrangler d1 execute azarashi-tennis-ranking --remote --file schema.sql` でテーブルを作成。
5. `npx wrangler secret put RATE_LIMIT_SALT` で長いランダムな秘密値を設定。
6. `npx wrangler deploy` でAPIを公開。
7. `../ranking-config.js` の `window.SEAL_RANKING_API` に公開先の `https://…workers.dev` を設定して GitHub Pages に反映。
8. 別々の端末で名前とスコアを登録し、両端末で同じ記録が見えることを確認。

名前はNFC正規化後のUnicodeコードポイントで最大6文字です。日本語・英字を使用できます。結合絵文字は複数文字として数える場合があります。

ステージ選択で開始したプレイは開始ステージ別のランキングに分けます。スコア降順、同点はコンティニュー回数昇順、さらに同点は先に登録された記録を上位にします。

POSTの再送は同じ記録IDを使い二重登録を避けます。CORS、入力検証、パラメータ化SQL、IPアドレスのソルト付きハッシュを使った10秒の投稿間隔制限を備えています。生のIPアドレスは保存しません。

このAPIはクライアントが計算したスコアを受け取るため、改造したブラウザによるスコア偽造を完全には防ぎません。賞品などのある大会で使う場合には、サーバー側でプレイ内容を検証する追加設計が必要です。
