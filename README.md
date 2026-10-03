# world-narrative

ゲームの世界設定を追加・検証・採用し、短い探索ゲームへ出力する制作フレームワークのMVP。

神話・人物・事件・科学的制約・遊びのいずれから始めても、真実、信念、資料、未確定事項を分けて保存する。ライターは凍結した正史から差分を作り、構造検査、到達性検査、任意のJev判定を経て、作者の理由付きで採用する。

## 遊ぶ

Node.js 24以上、pnpm、justを使う。

```sh
pnpm install
just demo
just serve
```

[http://127.0.0.1:4173](http://127.0.0.1:4173) を開く。サンプル「灰潮の入り江」は、72時間の締切の中で南の水門と北の採石場を訪ねる二つのエピソード。調査によって住民の誤信を確かめ、限られた粉・時間・労働を配分する。選択によって守れるものと残る負担が変わる。

`just demo` は `.tmp/demo-project/project.json` に正史と採用履歴を保存し、`.tmp/demo-game/` にゲームを出力する。同じプロジェクトへの再実行では、採用済みの提案を繰り返し追加しない。

テキストでも探索できる。

```sh
pnpm narrative play .tmp/demo-project --interactive
pnpm narrative play .tmp/demo-project --steps travel:place.quarry,act:quarry.read-ledger
```

## 設定を制作する

サンプルの初期世界と提案を使った、一件の採用手順。

```sh
pnpm narrative schema --out .tmp/schemas
pnpm narrative init .tmp/my-world --world examples/ash-estuary/world.json
pnpm narrative preview .tmp/my-world examples/ash-estuary/tide.proposal.json

# TYPESAFE_API_KEY または TYPESAFEAI_API_KEY を環境変数に設定した場合
pnpm narrative review .tmp/my-world examples/ash-estuary/tide.proposal.json --out .tmp/tide-review.json

# 作者が内容を確認し、判定結果がclearの場合に採用
pnpm narrative apply .tmp/my-world examples/ash-estuary/tide.proposal.json \
  --author editor --reason '調査と配分の選択を採用' --review .tmp/tide-review.json
pnpm narrative verify .tmp/my-world
pnpm narrative export .tmp/my-world --out .tmp/my-game
```

Jevを使わず作者判断で採用するときは `--review` を省く。作者と理由は必須。`review` は採用操作を行わず、API失敗・曖昧判定・モデル違いを `needs-review` として返す。`--review` で指定した判定は、現在の世界全体と提案のハッシュが一致する必要がある。

並列で作った二件目は、参照した設定の変更を検査してから明示的に版を合わせる。

```sh
pnpm narrative rebase .tmp/my-world examples/ash-estuary/quarry.proposal.json --out .tmp/quarry-rebased.json
pnpm narrative preview .tmp/my-world .tmp/quarry-rebased.json
pnpm narrative apply .tmp/my-world .tmp/quarry-rebased.json \
  --author editor --reason '北の調査と労働配分を採用'
pnpm narrative inspect .tmp/my-world
```

## 設計と制作資料

- [フレームワーク](docs/framework.md): 複数の起点から世界とゲームを構築する流れ。
- [アーキタイプ](docs/archetypes.md): ダークファンタジー、都市怪異、ハードSF、現代ミステリー。
- [先行研究](docs/research.md): 研究と制作者の一次資料、設計に取り込む部分。
- [実装コントラクト](docs/contracts.md): 世界、差分、ゲーム状態、検査と保存の境界。
- [並列ライターの手順](docs/writer-workflow.md): 共有する基礎と担当ごとの提案形式。
- [Jevの初期実験](docs/jev-experiment.md): 32ケースの合成ベンチマーク。MVPの文脈・質問とは別の実験。
- [MVPの統合検証](docs/mvp-verification.md): 到達性、テスト、実Jevの保留結果とキャッシュ。
- [サンプルのブリーフ](examples/ash-estuary/brief.md)、[草稿の統合レビュー](examples/ash-estuary/review.md)、[ゲーム化の調整](examples/ash-estuary/implementation-notes.md)。
- [シーン・人物画像の制作](examples/ash-estuary/art/README.md): Bのペン画と淡彩を採用。11シーンと5人の三面図・ポーズ画・表情集、描画方針と人物参照。
- [並列実装の契約・進捗](docs/mvp-plan.md): 担当範囲、固定API、再開手順。

## 検証と範囲

```sh
pnpm exec playwright install chromium
just ci
just benchmark-dry
```

strictなJSON Schemaと参照・型・正史の矛盾を検査し、有限の状態探索で行動とエピソード完了への到達を調べる。探索上限への到達は成功扱いしない。Jevの数値の閾値は暫定で、整合性や面白さの保証ではない。

現在は制作CLIと静的テキスト探索。作者用の正史・出典はゲーム出力から除くが、将来表示する条件付きの本文はゲームJSONに含まれる。未知の歴史の推測、汎用の条件付き正史、自動の文章からの事実抽出、大規模な探索、編集UIは今後の対象。
