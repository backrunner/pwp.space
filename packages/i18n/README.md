# Misskey i18n

Misskey の言語ファイル本体 (ja-JP.yml など) はリポジトリ直下の `/locales` に置かれており、そこから Crowdin 連携やビルド資産が生成されます。

このパッケージは Misskey モノレポ内で、これらの言語ファイルを共通で扱うためのヘルパー群や型情報をまとめる位置づけです。バックエンド / フロントエンド / Service Worker など各パッケージが同じ翻訳データと型定義を利用できるようにすることを目的としており、npm での外部配布は想定していません。

PWP の登録承認文言は `src/registration-approval.ts` で補完します。Crowdin が管理する非日本語 YAML は編集せず、欠落・空文字列だけを補います。上流の翻訳が存在する場合はそちらを優先します。日本語と関西弁は既存の日本語ソースとフォールバックを使用します。この補完は共通ローダーに適用され、フロントエンドのビルドと Service Worker 用 locale JSON の両方へ反映されます。

検証: `pnpm --filter i18n build && pnpm --filter i18n test`。
