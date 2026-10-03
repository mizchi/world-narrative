import type { Answer, Candidate, Consistency, Fixtures, Payload, Questions, ReferenceCase } from "./contracts.ts";

export const RUBRIC_VERSION = "lore-v1";
const consistencyCriteria = {
  compatible: "作者の真実と不変条件に衝突しない。誤った信念や資料、未検証の仮説、許された作用や自動処理も含む。未記載の背景を追加するだけならここ。",
  contradiction: "作者の真実として断定した出来事や規則が、同じ時間・条件の正史または不変条件に明確に反する。誤った証言自体は矛盾にしない。",
  underdetermined: "出来事の成立を保証しているが、その保証に必要な能力値・回復条件・時間・数量などが未定義で、明確な矛盾とも成立とも判定できない。",
};

export function buildPayload(fixtures: Fixtures, candidates: Candidate[], reverse = false): Payload {
  if (candidates.length === 0) throw new Error("need candidates");
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (ids.has(candidate.id)) throw new Error(`duplicate candidate ${candidate.id}`);
    ids.add(candidate.id);
    if (!fixtures.worlds.some(w => w.id === candidate.worldId)) throw new Error(`missing world ${candidate.worldId}`);
  }
  const worldIds = new Set(candidates.map(c => c.worldId));
  const selected = reverse ? [...candidates].reverse() : candidates;
  const questions: Questions = {};
  for (const candidate of selected) {
    const target = { worldId: candidate.worldId, candidateId: candidate.id };
    questions[`${candidate.id}.consistency`] = {
      type: "choice",
      instructions: { ...target, question: "この candidate の内容だけを、対応する world の canon / constraints / unresolved に照らして分類せよ。他候補を正史にしない。信念と資料の内容の真偽を、その存在の可否と混同しない。情報開示と遊びの評価はこの分類と分ける。" },
      criteria: reverse ? Object.fromEntries(Object.entries(consistencyCriteria).reverse()) : consistencyCriteria,
    };
    questions[`${candidate.id}.hook`] = {
      type: "noul",
      instructions: { ...target, question: "この candidate の gameplay に、プレイヤーの具体的な行動と、観察による理解または状態・関係・資源の変化が記述されているか。設定としての成立や面白さとは別に、記述の有無だけを判定せよ。" },
      criteria: { true: "具体的な操作・調査・選択と、その結果がある。", false: "雰囲気や背景説明だけで、行動と結果の接続が記述されていない。" },
    };
    questions[`${candidate.id}.leak`] = {
      type: "noul",
      instructions: { ...target, question: "candidate の presentation は、world の revealPolicy でまだ明かしてはいけない作者の秘密を、プレイヤーに明言しているか。作者用記録だけ、秘密でない誤信、適切な条件の後だけの提示は漏洩ではない。候補に指定された提示条件を確認せよ。" },
      criteria: { true: "指定された開示条件より前に、その秘密をプレイヤーへ明言する。", false: "早期の明言はない。断片的手掛かりや適切な条件の後の開示は許される。" },
    };
  }
  // Select fields explicitly: reference labels and rationales must never reach the API.
  return {
    state: {
      worlds: fixtures.worlds.filter(w => worldIds.has(w.id)),
      candidates: selected.map(c => ({ id: c.id, worldId: c.worldId, layer: c.layer, text: c.text, presentation: c.presentation, gameplay: c.gameplay, ...(c.holder ? { holder: c.holder } : {}) })),
    }, questions,
  };
}

function answerFor(answers: Record<string, Answer>, key: string): Answer {
  const answer = answers[key];
  if (!answer) throw new Error(`missing answer ${key}`);
  return answer;
}
function boolFor(answers: Record<string, Answer>, key: string): boolean {
  const answer = answerFor(answers, key);
  if (answer.type !== "noul") throw new Error(`wrong answer type ${key}`);
  return answer.noul >= 0.5;
}
function classFor(answers: Record<string, Answer>, key: string): Consistency {
  const answer = answerFor(answers, key);
  if (answer.type !== "choice" || !["compatible", "contradiction", "underdetermined"].includes(answer.choice)) throw new Error(`wrong answer type ${key}`);
  return answer.choice as Consistency;
}

export function summarize(cases: ReferenceCase[], answers: Record<string, Answer>) {
  const confusion: Record<string, Record<string, number>> = Object.fromEntries(
    Object.keys(consistencyCriteria).map(key => [key, Object.fromEntries(Object.keys(consistencyCriteria).map(k => [k, 0]))]),
  );
  let correct = 0, hookCorrect = 0, leakCorrect = 0, tp = 0, fp = 0, fn = 0, tn = 0, falseBeliefRejected = 0;
  const errors: Array<{ id: string; expected: ReferenceCase["expected"]; actual: ReferenceCase["expected"] }> = [];
  for (const c of cases) {
    const id = c.candidate.id;
    const actual = { consistency: classFor(answers, `${id}.consistency`), hook: boolFor(answers, `${id}.hook`), leak: boolFor(answers, `${id}.leak`) };
    confusion[c.expected.consistency]![actual.consistency]! += 1;
    if (actual.consistency === c.expected.consistency) correct++;
    if (actual.hook === c.expected.hook) hookCorrect++;
    if (actual.leak === c.expected.leak) leakCorrect++;
    if (actual.consistency === "contradiction") {
      if (c.expected.consistency === "contradiction") tp++; else fp++;
    } else if (c.expected.consistency === "contradiction") fn++; else tn++;
    if (["belief", "record"].includes(c.candidate.layer) && actual.consistency === "contradiction") falseBeliefRejected++;
    if (actual.consistency !== c.expected.consistency || actual.hook !== c.expected.hook || actual.leak !== c.expected.leak) errors.push({ id, expected: c.expected, actual });
  }
  const total = cases.length;
  const accuracy = (n: number) => total ? n / total : null;
  return {
    consistency: { correct, total, accuracy: accuracy(correct), confusion },
    contradiction: { tp, fp, fn, tn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null },
    hook: { correct: hookCorrect, total, accuracy: accuracy(hookCorrect) },
    leak: { correct: leakCorrect, total, accuracy: accuracy(leakCorrect) },
    falseBeliefRejected, errors,
  };
}

export function compareAnswers(a: Record<string, Answer>, b: Record<string, Answer>) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || keys.some(k => !b[k])) throw new Error("missing or extra answers in comparison");
  let changedDecisions = 0, maxProbabilityDifference = 0;
  for (const key of keys) {
    const left = a[key]!, right = b[key]!;
    if (left.type !== right.type) throw new Error(`wrong comparison type ${key}`);
    if (left.type === "noul" && right.type === "noul") {
      if ((left.noul >= 0.5) !== (right.noul >= 0.5)) changedDecisions++;
      maxProbabilityDifference = Math.max(maxProbabilityDifference, Math.abs(left.noul - right.noul));
    } else if (left.type === "choice" && right.type === "choice") {
      if (left.choice !== right.choice) changedDecisions++;
      for (const option of Object.keys(left.probabilities)) {
        const value = right.probabilities[option];
        if (value === undefined) throw new Error(`missing probability ${key}.${option}`);
        maxProbabilityDifference = Math.max(maxProbabilityDifference, Math.abs(left.probabilities[option]! - value));
      }
    }
  }
  return { total: keys.length, changedDecisions, maxProbabilityDifference };
}
