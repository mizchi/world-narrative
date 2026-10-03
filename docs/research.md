# 先行研究と制作事例

確認日: 2026-10-03。論文の公開ページ・要旨、著者による記事、公式資料を参照した。網羅的な文献レビューではない。下表の「採用する設計」は本プロジェクト側の解釈・提案であり、元資料がこのフレームワーク全体を実証したという意味ではない。

## 物語をどう構築するか

| 一次資料 | 資料が扱うこと | 本プロジェクトで採用する設計 |
| --- | --- | --- |
| [Riedl & Young, Narrative Planning: Balancing Plot and Character, JAIR, 2010](https://jair.org/index.php/jair/article/view/10669) | IPOCL により、因果的に成立する筋と、人物の行動を説明する目的・意図を扱う。 | 出来事の因果だけでなく「この人物はなぜこれをしたか」を保持する。正しい年表だけでは人物の納得感を保証できない。 |
| [Jenkins, Game Design as Narrative Architecture, 2004](https://electronicbookreview.com/publications/game-design-as-narrative-architecture/) | 空間に埋め込まれた情報、探索、体験を通した物語の理解を論じる。 | 実際の出来事と、手掛かりを見つけて再構成する順序を別のグラフにする。ロアを空間・痕跡・行動へ接続する。 |
| [Hunicke, LeBlanc & Zubek, MDA, 2004](https://users.cs.northwestern.edu/~hunicke/MDA.pdf) | Mechanics、Dynamics、Aesthetics の関係を使ってゲーム設計と体験を捉える。 | 先に期待する体験と行動を仮置きし、世界の原理が実際の遊びで機能するか確認する。設定の文章品質だけで評価しない。 |
| [Emily Short, Storylets: You Want Them, 2019](https://emshort.blog/2019/11/29/storylets-you-want-them/) | 内容、実行前提、実行後の状態変化を持つ小さな物語単位を説明する。 | エピソードを条件と効果で接続可能にする。巨大な分岐木を先に固定せず、追加できる状況の単位を作る。 |
| [Justin Alexander, Three Clue Rule, 2008](https://thealexandrian.net/wordpress/1101/roleplaying-games/three-clue-rule-part-3-the-three-clue-rule) | TRPG の重要な結論に複数の手掛かりを用意する制作上の経験則。 | 必須の推理が一つの取り逃しで止まらないよう、取得経路と結論への接続を検査する。手掛かり数を品質の証明にしない。 |

IPOCL は人物から考える方法と事件から考える方法を、人物の目的と因果の両面から接続する参考になる。Storylets はそれをゲームの進行状態へ落とす制作単位として有用と考える。この組合せは本プロジェクトの提案である。[IPOCL](https://jair.org/index.php/jair/article/view/10669)、[Storylets](https://emshort.blog/2019/11/29/storylets-you-want-them/)

## AI をどこに使うか

| 一次資料 | 資料が扱うこと | 本プロジェクトで採用する設計 |
| --- | --- | --- |
| [Mirowski ほか, Dramatron, 2022](https://arxiv.org/abs/2209.14958) | 登場人物、展開、場所、台詞などを階層的に生成する共同執筆システム。業界の専門家15人による利用研究を報告する。 | ブリーフ → 世界の制約 → エピソード → 提示断片という階層を使い、局所の文章を生成する前に共有する構造を固定する。脚本での成果をゲームの面白さへ直接外挿しない。 |
| [Yang ほか, Re3, EMNLP, 2022](https://aclanthology.org/2022.emnlp-main.296/) | 全体計画と現在の物語状態を再投入し、継続生成と修正を行う長文生成の枠組み。 | ライターへ毎回、現在の正史版と関係する事実を渡す。長い会話履歴の記憶に依存せず、差分と制約を再確認する。 |
| [Park ほか, Generative Agents, 2023](https://arxiv.org/abs/2304.03442) | 経験の記憶、振り返り、検索、計画を使う行動シミュレーション。 | 人物がどの経験から情報を持つかを管理する。常時動くシミュレーションは初期 MVP の必須機能にせず、制作支援と実行時 AI を分ける。 |
| [Zheng ほか, Judging LLM-as-a-Judge, 2023](https://arxiv.org/abs/2306.05685) | 評価モデルの位置、長さ、自己評価などの偏りと限界。 | 判定器を唯一の編集者にせず、提示順や長さの対照、人間の評価、保留経路を持つ。研究対象のモデルと Jev を同一視しない。 |
| [TypeSafe Introduction](https://docs.typesafe.ai/introduction)、[API](https://docs.typesafe.ai/api)、[Confidence](https://docs.typesafe.ai/confidence) | state と型付き質問による確率的な判断。原子的な質問を並列に評価し、コードで合成する設計。 | 制約の違反、早期開示、行動の記述などを別の問いとしてバッチ評価する。生成、数理的な証明、最終的な採用判断は別に担う。 |

## 制作事例と出力先

- [宮崎英高インタビュー、Xbox Wire / Bandai Namco、2019](https://news.xbox.com/en-us/2019/06/09/hidetaka-miyazaki-and-george-rr-martin-present-elden-ring/)：ゲームの構想についての対話を基に Martin 氏が神話を作り、それから世界を構築した事例。世界の過去を独立した制作成果物として持つ参考になる。
- [SCP Canon Hub](https://scp-wiki.wikidot.com/canon-hub)：複数の共有カノンを持つ共同創作の例。整合性を判定する正史の範囲と版を明示する設計へ反映する。
- [ink 公式](https://www.inklestudios.com/ink/)：インタラクティブな物語を書くためのスクリプト言語と制作環境。世界設定の保存層とは分け、会話や選択の出力先として検討する。

## jev-playground から参照した箇所

調査時にローカルの `../jev-playground` を読み、以下を参考にした。

- [docs/practice.md](https://github.com/mizchi/jev-playground/blob/main/docs/practice.md)：問いの形、原子的なルーブリック、バッチ、指標別の校正。
- [docs/00-api-notes.md](https://github.com/mizchi/jev-playground/blob/main/docs/00-api-notes.md)：`criteria` の wire 形式、入力サイズ、分類の逃げ道などの実測。
- [packages/jev-core/src/client.ts](https://github.com/mizchi/jev-playground/blob/main/packages/jev-core/src/client.ts)：API キーの二つの環境変数名、リクエストと応答の型、タイムアウトなど。
- [docs/57-confidence-fallback.md](https://github.com/mizchi/jev-playground/blob/main/docs/57-confidence-fallback.md)：情報不足による失敗を confidence だけでは拾えない実験。

本リポジトリの実験用クライアントは必要最小限を独立に実装した。既存クライアントの全機能を移植したものではない。API の現在の wire 形式は TypeSafe の公式資料でも確認した。
