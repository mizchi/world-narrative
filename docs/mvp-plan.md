# MVP 実装の共有契約と進捗

更新日: 2026-10-03。ユーザー承認済み: 一地域・二エピソード、世界設定の追加、差分検証、探索出力の制作 CLI。並列作業はユーザーから明示的に依頼された。

## 共有する契約

`src/world/types.ts` の v1 を凍結する。型の変更は root へ要求し、各担当は直接編集しない。Node 24 / pnpm / just。実装は TDD（探索 → Red → Green → Refactoring）。通常の JSON 入力は strict schema で未知キーも拒否する。

時間は開始からの整数時間。灰潮の締切は72時間、港から南／北への移動は各12時間。初期草稿の「前日／二日前」は、訪問時の残り時間に合わせる。作者の秘密と、プレイヤーに許可された表示を分離する。

### API の固定シグネチャ

```ts
// src/world/schema.ts
parseWorld(input: unknown): World;
parseProposal(input: unknown): Proposal;
parseProject(input: unknown): Project;
jsonSchemas(): { world: unknown; proposal: unknown; project: unknown };

// src/world/validate.ts
validateWorld(world: World): ValidationReport;

// src/world/proposal.ts
previewProposal(world: World, proposal: Proposal): { world: World; report: ValidationReport };
commitProposal(project: Project, proposal: Proposal, decision: { author: string; reason: string }, now?: string): Project;

// src/world/store.ts
createProject(directory: string, world: World): Promise<Project>;
loadProject(directory: string): Promise<Project>;
saveProject(directory: string, project: Project, expectedRevision: string): Promise<void>;

// src/player/runtime.ts: Node とブラウザに共有する純粋ロジック
initialState(game: GameArtifact): GameState;
evaluate(condition: Condition, state: GameState): boolean;
availableActions(game: GameArtifact, state: GameState): Action[];
travel(game: GameArtifact, state: GameState, to: string): GameState;
act(game: GameArtifact, state: GameState, actionId: string): GameState;
visibleFragments(game: GameArtifact, state: GameState): Fragment[];
finish(game: GameArtifact, state: GameState): GameState;
checkReachability(game: GameArtifact, limit?: number): ReachabilityReport;

// src/player/export.ts
toGameArtifact(world: World): GameArtifact;
exportGame(world: World, directory: string): Promise<void>;
```

一度実行した行動は繰り返せない。移動は現在地に接続した経路のみ、締切を超える行動は不可。費用と効果は原子的に適用し、資源の上下限を越える効果は状態を書き換えず拒否。秘密の learn と開示断片は reveal ルールの条件を満たす必要がある。`observed` や `believed` を `known` に昇格させない。

到達性は有限の初期状態から旅行と行動を探索。上限に達した場合は合格扱いせず `limit-reached`。export は作者の文章、正史、出典、信念の内部データを含めず、許可されたゲーム定義のみ出力する。ブラウザ出力に API キーは含めない。

### サンプルの共有 ID と変数

場所: `place.harbor`、`place.tide`、`place.quarry`。秘密の命題: `truth.exception`（記憶の重要さで効力は増えない）。開示条件は `tide.tested == true OR quarry.trialRead == true`。

変数:

| ID | 型・初期値 |
| --- | --- |
| world.powder | 整数0..6、初期6。南門への配分に使える共有在庫。北の既存割当とは別。 |
| tide.inspected / tide.recordsRead / tide.tested / tide.repaired | boolean、false |
| tide.decision | enum pending / cistern / racks / split / leave、pending |
| quarry.ledger / quarry.channelSeen / quarry.trialRead | boolean、false |
| quarry.choice | enum pending / kiln / channel / leave、pending |

北の作業二択は各24時間で同時に実行できない。窯修理は world.powder を2減らす。溝修理は北の既存割当の損失を減らし、在庫を増殖しない。南の道修理は12時間、片側の保護は在庫4、修理後の両側保護は在庫6を使う。決定は相互排他。未選択でも終了でき、結果は条件付きの断片で示す。全ての重要な操作とエピソードが少なくとも一つの経路で到達することを検証する。

## 担当と書込範囲

- core: `src/world/schema.ts`, `validate.ts`, `proposal.ts`, `store.ts` と `tests/world.test.ts`。参照、値、単一値の衝突、時間・分岐、偽証、未確定、正史版、並列保存を検証する。
- player: `src/player/**`、`tests/player.test.ts`、`e2e/**`、`playwright.config.ts`。探索ロジック、静的HTML出力、ローカル配信、E2E。package / justfile は変更せず必要コマンドを root に報告する。
- demo: `examples/ash-estuary/world.json`, `tide.proposal.json`, `quarry.proposal.json`, `implementation-notes.md`。二つのライター草稿を、型に沿う JSON とゲームの操作に落とす。世界の初期正史にはエピソードを入れず、それぞれの提案で追加する。
- root: 制作 CLI (`src/cli.ts`)、Jev の文脈とキャッシュ (`src/world/semantic.ts`)、CLI／統合テスト、package / justfile / README、最終統合。

## 必須の完了条件

1. ローカルの新規プロジェクトを作成できる。
2. 世界設定と提案を schema と意味の構造検査で診断できる。
3. 二つの提案を正史版を合わせて採用し、履歴を残せる。
4. 競合、矛盾、不明参照、早期開示、資源不足を成功扱いしない。
5. Jev は明示的に実行し、API失敗・曖昧判定を保留し、結果をキャッシュする。
6. JSON / HTML を出力し、二つのエピソードをブラウザとテキストCLIで探索できる。
7. 到達性検査、ユニット／統合テスト、型検査、Playwright E2E が通る。

## 現在の進捗（統合完了）

- 完了: 設計研究、32ケースの Jev 検証、二ライターの Markdown 草稿。
- 完了: MVP 型と担当範囲を凍結。
- 完了: core_mvp / player_mvp / demo_mvp。担当のファイルを統合し、全員から終了報告を受領。
- root: CLIの4テスト、Jev文脈・キャッシュの4テストがGreen。採用・明示rebase・探索検証・テキスト実行・schema・HTML出力を提供。packageとjustにdemo/serve/e2e/ciを追加。
- player: 12単体テスト、6 Playwright E2EがGreen。Episode.completionの到達性確認、静的出力、配信を実装。
- core: 13テストGreen。strict schema、正史・参照・開示の検証、差分・採用・保存の競合と宣言外変更の拒否を実装。
- demo: 初期worldと二つの提案がvalid。全14行動、両Episodeの完了条件へ到達。1,153状態・840終端、診断ゼロ。
- 最終検証: `just ci` 成功。ユニット・CLI統合41件（初期実験8件を含む）、型検査、Playwright6件。E2Eは新規projectを毎回生成し、ポート4174で検証。
- Jev実API: 南319ms / 北355ms。両方needs-reviewを記録し、南の同一入力でcache取得を確認。疑義は自動承認へ読み替えず、デモは作者判断で採用。[検証記録](mvp-verification.md)とresults/mvp-*に入力・結果・ソースハッシュを保存。
- 文書: README、contracts、writer-workflow、mvp-verificationを更新・追加。
- 実行済み: `.tmp/demo-project` と `.tmp/demo-game`。ローカル配信は `just serve`、http://127.0.0.1:4173 。
- 必須の未完了作業なし。次の検討対象は未見ケースでの意味判定の校正と、初見のプレイレビュー。静的ゲームの未来の本文はJSONを読むと参照できる。

## 再開するときの手順

1. このファイルと `src/world/types.ts` を読む。現在のファイルは共有され、担当者の変更は即時見える。
2. READMEの手順で `just demo` と `just serve` を使う。既存の採用履歴を維持し、demo再実行は冪等。
3. 三担当の実装は完了している。次の並列制作にはwriter-workflowと今回の固定型を配布する。新規作業では書込範囲を改めて決める。
4. 必要な変更をした場合に `just ci` を実行する。現在の成功結果だけを理由に繰り返し実APIを呼ぶ必要はない。
5. Jevを改善するときはmvp-verificationと原本結果を読み、別ルーブリックとして比較する。needs-reviewは保留のまま扱い、既存結果を上書きしない。

## シーン画像の制作

ユーザーが画風候補の2案目B（ペン画と淡彩）を明示的に選定した。`examples/ash-estuary/art/art-direction.json` に共通方針と採用参照画像のSHA-256を固定し、以後もBを毎回参照する。内蔵image_genを使用し、指定モデルgpt-image-2.5の固定を確認できない点は説明済み。

全11シーンを生成済み（港1、南4、北6）。南の到着は採用Bを再利用、新規10場面と旧溝の封鎖を明確にする修正版を作成。画像はart/scenes、一覧はart/gallery.html、シーン条件はart/scene-plan.json、生成履歴と完全なプロンプトはart/scene-generation-*.jsonとscene-prompts-*.json。元画像と未採用草稿は上書きせず保持する。

到着・調査画は未修理の条件に限定し、北の窯／溝修理を相互排他的な専用画像に分けた。画像と条件の参照、PNG寸法、SHA-256、開示条件を確認した。現時点では制作確認用の画集であり、ゲームプレイヤーへの画像組込みは未実施。

## 人物画像の制作

イラ・スイ・アサ・ネネ・アドの最初の全身像5枚を、Bをそれぞれ参照して制作した。初稿はart/character-gallery-v1.html、外見案はcharacter-art-direction.json、完全なプロンプトはcharacter-prompts-v1.json、生成履歴はcharacter-generation-manifest.json。画像はart/characters/*-v1.png。

ユーザーから全員同じ画角では場面に使いにくいため、三面図とポーズ・表情を分けるよう指示を受けた。現在のart/character-gallery.htmlは5人×三面図・ポーズ画・4表情集の15枚。三面図は1536×1024、表情集は1254×1254。ポーズ画は人物ごとに動作・画角・寄り・縦横比を変えた。各生成でBを画風、最初の全身像を外見の参照にした。

用途と参照方針はcharacter-production-plan-v2.json、生成履歴はcharacter-production-generation-v2.json、完全なプロンプトはcharacter-prompts-turnaround/pose/expressions-v2.json。画像はart/characters/*-turnaround/pose/expressions-v2.png。元画像・初稿5枚を保持する。表情集は2×2の一枚で、四分割の領域データも保存する。

職業と本文を参照し、外見は制作デザイン案として分離する。世界の正史には自動で追加せず、既存シーンの匿名人物に名前を割り当てない。以後はBで画風、三面図で体格・衣服、表情集で顔、ポーズ画で演技の候補を参照し、場面ごとに動作を指定する。art-direction.jsonもこの方針へ更新した。画像は制作資料で、ゲームへの組込みは未実施。

人物画集のプレビューは http://127.0.0.1:4175/character-gallery.html 。

確認済み: 15画像と参照元・プロンプトのハッシュ、人物への対応、旧5枚と元画像の保持、20表情の領域データ。Playwrightで1280px／390pxの全15画像と区分への移動・全リンク、横はみ出し・ページエラーなしを確認した。
