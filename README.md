# 思考マップ

画像と枝で考えを整理し、文章やAIからツリーを作れる、公開型の
マインドマップです。Next.jsの静的画面とCloudflare Pages Functionsを
組み合わせ、D1へマップ、R2へ画像を保存します。

## 主な機能

- ノードの追加・編集・削除、ドラッグ移動、枝の開閉
- 拡大・縮小、全体表示、`F`キーで中央へ戻る
- 元に戻す・やり直す、自動整列、800ms間隔の自動保存
- JPEG・PNG・WebP画像の選択、ドロップ、貼り付け
- インデント・箇条書き・Markdown見出しからツリーを生成
- Cloudflare Workers AIで文章を整理してツリー化
- 公開閲覧画面と、パスワードで保護した編集画面
- WCAG AAを意識した文字・UIコントラスト

## 構成

- `/`：公開閲覧画面
- `/edit/`：編集画面
- D1：マップ本体と画像メタデータ
- R2：アップロード画像
- Workers AI：文章から階層JSONを生成

初期版は1マップ（slug: `default`）です。

## セットアップ

Node.js 20以上とCloudflareアカウントが必要です。

```bash
npm install
npx wrangler d1 create thought-map
npx wrangler r2 bucket create thought-map-assets
npx wrangler pages project create thought-map --production-branch=main
cp wrangler.example.jsonc wrangler.jsonc
```

作成されたD1のIDを`wrangler.jsonc`へ設定します。次にテーブルを作ります。

```bash
npx wrangler d1 migrations apply thought-map --local
npx wrangler d1 migrations apply thought-map --remote
```

編集パスワードのハッシュを生成します。

```bash
node scripts/generate-password-hash.mjs "十分に長いパスワード"
```

ローカルでは、出力された値とランダムなCookie署名鍵を`.dev.vars`へ
設定します。`.dev.vars.example`を参考にしてください。

本番ではCloudflare PagesのSecretへ2つの値を登録します。

```bash
npx wrangler pages secret put TREEMAP_ADMIN_PASSWORD_HASH --project-name=thought-map
npx wrangler pages secret put TREEMAP_SESSION_SECRET --project-name=thought-map
```

署名鍵は、たとえば次のコマンドで作れます。

```bash
openssl rand -base64 48
```

## ローカル実行

UIだけを確認する場合：

```bash
npm run dev
```

D1・R2・Pages Functionsを含めて確認する場合：

```bash
npm run pages:dev
```

Workers AIは`wrangler.example.jsonc`で`remote: true`にしているため、
AI整理のみCloudflareのリモート環境を使用します。

## デプロイ

```bash
npm run build
npx wrangler pages deploy out --project-name=thought-map
```

## セキュリティ

- パスワードはPBKDF2-SHA256ハッシュのみ保存
- 編集CookieはHMAC署名、HttpOnly、Secure、SameSite=Strict、12時間
- 書き込みAPIは認証と同一Originを確認
- D1のversion列で古い画面からの上書きを拒否
- 画像はJPEG・PNG・WebP、1枚5MBまで
- マップは最大500ノード、AI入力は最大12,000文字

## ライセンス

[MIT License](./LICENSE)
