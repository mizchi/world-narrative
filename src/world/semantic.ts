import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { ask, parseResponse } from "../jev.ts";
import type { JevResponse, Questions } from "../contracts.ts";
import type { Proposal, World } from "./types.ts";

const RUBRIC = "world-diff/v1";
const MODEL = "jev-1.13.0";
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}
function references(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(references);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key === "id" || key.endsWith("Id") || key === "variable" || key === "participants" || key === "disclosedClaimIds") return strings(child);
    return references(child);
  });
}

export function semanticInputHash(world: World, proposal: Proposal): string { return hash({ world, proposal }); }

/** Reference closure plus global rules. This is a selection policy, not a completeness proof. */
export function collectContext(world: World, proposal: Proposal) {
  const ids = new Set([...proposal.readSet, ...proposal.writeSet, ...strings(proposal.operations), ...strings(world.rules), ...strings(world.openQuestions)]);
  const episodes = new Set<string>();
  let count = -1;
  while (ids.size !== count) {
    count = ids.size;
    for (const claim of world.claims) {
      if (ids.has(claim.id) || ids.has(claim.subjectId)) strings(claim).forEach(id => ids.add(id));
    }
    for (const assertion of world.assertions) {
      if (ids.has(assertion.id) || ids.has(assertion.claimId)) strings(assertion).forEach(id => ids.add(id));
    }
    for (const episode of world.episodes) {
      const dependencies = references(episode);
      if (dependencies.some(id => ids.has(id))) {
        episodes.add(episode.id);
        dependencies.forEach(id => ids.add(id));
      }
    }
  }
  return {
    contextPolicy: "reference-closure-global-rules/v1", revision: world.revision, contract: world.contract,
    entities: world.entities.filter(e => ids.has(e.id)), predicates: world.predicates.filter(p => ids.has(p.id)),
    claims: world.claims.filter(c => ids.has(c.id)), assertions: world.assertions.filter(a => ids.has(a.id)),
    rules: world.rules, openQuestions: world.openQuestions,
    game: world.game, episodes: world.episodes.filter(e => episodes.has(e.id)), proposal,
  };
}

function questions(): Questions {
  const question = (instructions: string, yes: string, no: string) => ({ type: "noul" as const, instructions, criteria: { true: yes, false: no } });
  return {
    contradiction: question("提案は、同じ分岐・時間・条件の作者の正史または不変条件に明確に反する真実を追加しているか。誤信・偽証・資料内容は作者の真実に昇格させない。", "正史の真実や不変条件を覆す。", "明確な衝突は見つからない。"),
    unsupported: question("提案の採用に必要な未定義の能力・数量・回復条件、既存文脈にない遠い因果の確認、またはopenQuestionsに留保された作者判断があるか。普通の新しい背景や人物を追加するだけなら該当しない。", "採用前に追加の文脈・定量検査・作者判断が必要。", "そのような追加確認の必要は見つからない。"),
    earlyDisclosure: question("提案のゲーム内断片・開始場面・行動結果に、revealルールの条件を満たす前に秘密を明言する内容があるか。作者用Claim.text、notes、正史への追加それ自体はプレイヤーへの露出として数えない。", "開示条件以前にゲームの提示文章から秘密が露出する。", "許可された提示条件の範囲を守る。"),
    playable: question("提案にエピソードがある場合、具体的な調査や介入と、それに対応する発見や異なる結果が記述されているか。エピソードを含まない設定追加は評価対象外としてyes。実際に面白いかを証明する問いではない。", "行動と結果が記述されている、または背景追加。", "エピソードが抽象的な背景説明だけに留まる。"),
  };
}

export interface SemanticReport {
  formatVersion: "jev-review/v1";
  status: "clear" | "needs-review";
  source: "api" | "cache";
  inputHash: string;
  worldRevision: string;
  rubric: string;
  model: string;
  cacheKey: string;
  checks: Record<string, number>;
  reasons: string[];
  ms: number;
  response?: JevResponse;
}
export interface SemanticOptions { cacheDirectory?: string; model?: string; request?: typeof ask }

export async function reviewSemantics(world: World, proposal: Proposal, options: SemanticOptions = {}): Promise<SemanticReport> {
  const model = options.model ?? MODEL;
  const payload = { state: collectContext(world, proposal), questions: questions() };
  const cacheKey = hash({ inputHash: semanticInputHash(world, proposal), payload, model, rubric: RUBRIC });
  const report: SemanticReport = { formatVersion: "jev-review/v1", status: "needs-review", source: "api", inputHash: semanticInputHash(world, proposal), worldRevision: world.revision, rubric: RUBRIC, model, cacheKey, checks: {}, reasons: [], ms: 0 };
  if (Buffer.byteLength(JSON.stringify(payload.state)) > 60_000) return { ...report, reasons: ["context-too-large"] };
  let response: JevResponse | undefined;
  const cacheFile = options.cacheDirectory ? join(options.cacheDirectory, `${cacheKey}.json`) : undefined;
  if (cacheFile) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, "utf8")) as { key?: unknown; response?: unknown };
      if (cached.key === cacheKey) { response = parseResponse(cached.response, payload.questions); report.source = "cache"; }
    } catch { /* Invalid or absent cache is a miss, never an approval. */ }
  }
  try {
    if (!response) {
      const result = await (options.request ?? ask)(payload, { model });
      response = parseResponse(result.response, payload.questions);
      report.ms = result.ms;
    }
    if (response.model !== model) return { ...report, reasons: ["resolved-model-mismatch"] };
    report.response = response;
    for (const [name, answer] of Object.entries(response.answers)) {
      if (answer.type !== "noul") return { ...report, reasons: ["wrong-answer-type"] };
      report.checks[name] = answer.noul;
      const acceptable = name === "playable" ? answer.noul >= 0.85 : answer.noul <= 0.15;
      if (!acceptable) report.reasons.push(name);
    }
    report.status = report.reasons.length ? "needs-review" : "clear";
    if (cacheFile && report.source === "api") {
      await mkdir(options.cacheDirectory!, { recursive: true });
      const temporary = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ key: cacheKey, response }, null, 2), { flag: "wx" });
      await rename(temporary, cacheFile);
    }
    return report;
  } catch {
    return { ...report, status: "needs-review", reasons: ["api-or-response-unavailable"] };
  }
}
