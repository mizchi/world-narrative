# 世界モデルの実装コントラクト v1

実装の型は [src/world/types.ts](../src/world/types.ts)、入力検査は [src/world/schema.ts](../src/world/schema.ts) を正とする。`pnpm narrative schema --out .tmp/schemas` で World / Proposal / Project のJSON Schemaを生成できる。未知のキーを拒否し、`formatVersion: "world-narrative/v1"` を要求する。初期Jev実験の `src/contracts.ts` は別の型。

## 保存と実行の境界

| データ | 内容 | 更新方法 |
| --- | --- | --- |
| World | 体験、存在、命題、作者の採用状態、規則、未確定事項、ゲーム定義 | 初期化後は提案の採用 |
| Proposal | 基準版、名前空間、参照集合、書込集合、操作、作者向けnotes | 各担当が独立に作成 |
| Project | 現在のWorldと採用履歴 | 作者・理由を指定したcommitと保存 |
| GameArtifact | 許可されたゲーム定義・本文・開示条件 | Worldから明示的に射影 |
| GameState | 所在地、経過時間、変数、知識、実行済み行動、ログ、終了 | 純粋なruntime関数 |

`GameState` の変化は正史の改訂ではない。ゲーム中の資源消費を、世界設定のClaimの追加として保存しない。作者の説明と、プレイヤー向けの本文も区別する。

## 存在・命題・採用状態

Entityのカテゴリは `era / place / person / animal / anomaly / event / organization / country / item / episode / rule / technology`。述語は値の型、主語の種別、単一値か複数値か、必要なら数量の単位を定義する。

Claimは `subjectId / predicateId / value / scope / text` を保持し、Assertionがその扱いを指定する。

| Assertion.layer.kind | 意味 |
| --- | --- |
| authorTruth | 作者の真実。assertまたはdeny |
| belief | 人物が信じる／信じない。命題自体が真とは限らない |
| record | 資料が述べる内容。資料の正しさは保証しない |
| hypothesis | 提案された仮説 |

採用状態は `proposed / accepted / superseded`。提案の新しいAssertionはproposed、採用後にacceptedとなる。信念・資料・仮説が自動的にauthorTruthへ変わることはない。`source.artifactId / authorId` はEntity参照であり、外部出典には明示的な `external:<識別子>` を使う。

scopeは分岐ID、半開時間区間またはatemporal、条件ID。v1の条件IDは `always` のみを解釈する。それ以外はneeds-reviewとし、推測で重なりを決めない。同じ分岐・重なる時間の単一値正史に異なる値を入れること、同じ命題の肯定と否定、forbidTruthで禁止した値を検出する。未記載は否定とは異なる。openQuestionに触れる作者判断も保留する。

## 差分と並列制作

Proposalの操作は `addEntity / addClaim / addAssertion / addEpisode / supersedeAssertion`。既存の採用済みAssertionを変更するときは、supersedeと置き換える主張を明示する。初期世界の述語・規則・変数・地理の改訂操作はv1では提供しない。

- `basedOnRevision` は現在の正史版と一致する必要がある。
- 新規IDは `namespace + "."` で始める。Episode内のAction / Fragmentにも適用する。
- `writeSet` は実際に追加・更新する全IDと一致する。
- `readSet` は操作から参照する既存IDを含む。本文だけの依存も担当が明記する。

古い版の提案はそのまま採用できない。CLIのrebaseは、基準版以降の採用操作とreadSetを照合し、変更された依存があれば拒否する。Entityそのものを置き換えなくても、その主語のauthorTruthが増減した場合は変更として扱う。信念の持ち主・資料・仮説の提案者も影響範囲に含める。その後も世界全体の構造と到達性を再検査する。異なる名前空間でも、共通資源や開示規則への干渉は残る。

保存は版の比較、プロジェクトの排他ロック、一時ファイルからのatomicな置換を使う。既存履歴を維持して採用記録を一件だけ追加し、記録した提案の再適用と保存Worldの一致も検査する。外部からファイルを直接編集したときの履歴認証や、複数ホストの分散ロックは対象外。異常終了で `.project.lock` が残った場合は、書込プロセスが終了していることを確認して手動で復旧する。

## 操作と開示

Conditionは `true / all / any / not / eq / gte / lte / knows`。変数は有限の整数範囲、boolean、enum。Effectは `set / add / learn`。自由文を実行条件として扱わない。

一つの行動は時間と効果を原子的に適用する。変数効果をすべて順番に計算した後、行動前の知識と更新後の変数で全learnの開示条件を検査し、最後に知識を更新する。途中で資源範囲を越えれば失敗し、元の状態は変えない。同じ行動内のlearnを使って別のlearnを自己許可できない。

`observed / believed / known` を区別し、knows条件はknownだけで成立する。後の噂でknownを降格しない。Fragmentの `disclosedClaimIds` は、その文章が明かす命題の宣言。revealの条件を含意する表示条件を要求する。文章と宣言の一致は構造検査だけでは証明できず、意味判定と作者の確認が必要。

行動は一度のみ。移動は現在地に接続した経路のみ。費用で締切を超える操作は拒否する。終了操作は締切まで時間を進め、該当する結末を表示する。

## 検査の結果

| 検査 | 結果と用途 |
| --- | --- |
| parseWorld / parseProposal / parseProject | strict schema。不適合なら入力を拒否 |
| validateWorld / previewProposal | valid / invalid / needs-reviewとFinding |
| checkReachability | complete / limit-reached、未到達行動・完了条件、開示診断 |
| reviewSemantics | clear / needs-review。採用とは独立 |
| commitProposal | 作者・理由を要求し、新版と採用履歴を返す |

到達性は有限状態の探索で、Episode所在地への到着だけでなくcompletionの成立を確認する。v1のCLIは構造needs-reviewや探索未完了を採用・出力の成功扱いにしない。低水準のcommit APIではneeds-reviewを作者の明示判断で採用できるため、制作時はCLIの検査手順を使う。

Jevには参照の閉包、共通規則、未確定事項、ゲーム定義、共通の資源などで関連する採用済みEpisodeと提案を渡す。文脈選択は完全性の証明ではない。世界・提案の内容、モデル、質問、ルーブリックをキャッシュキーに含める。暫定閾値は否定すべき問題が0.15以下、遊びの足場が0.85以上。API障害・曖昧・モデル違いは保留し、clearでも作者の採用判断を要求する。
