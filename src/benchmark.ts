import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fixtures } from "./fixtures.ts";
import { buildPayload, compareAnswers, RUBRIC_VERSION, summarize } from "./judge.ts";
import { ask } from "./jev.ts";
import type { Answer, Candidate, JevResponse } from "./contracts.ts";

const candidates = fixtures.cases.map(c => c.candidate);
const payload = buildPayload(fixtures, candidates);
if (process.argv.includes("--dry")) {
  console.log(JSON.stringify({ rubricVersion: RUBRIC_VERSION, worlds: fixtures.worlds.length, cases: candidates.length, questions: Object.keys(payload.questions).length, stateBytes: Buffer.byteLength(JSON.stringify(payload.state)), requestBytes: Buffer.byteLength(JSON.stringify(payload)), apiCalls: 0 }, null, 2));
} else {
  const output = new URL("../results/", import.meta.url);
  await mkdir(output, { recursive: true });
  const calls: Array<{ mode: string; iteration: number; caseIds: string[]; ms: number; response: JevResponse }> = [];
  const groups = fixtures.worlds.map(w => candidates.filter(c => c.worldId === w.id));
  async function run(mode: string, iteration: number, selected: Candidate[], reverse = false) {
    const { response, ms } = await ask(buildPayload(fixtures, selected, reverse));
    calls.push({ mode, iteration, caseIds: selected.map(c => c.id), ms, response });
    await writeFile(new URL("raw.json", output), JSON.stringify({ observedAt: new Date().toISOString(), rubricVersion: RUBRIC_VERSION, calls }, null, 2));
    console.log(`${mode} #${iteration}: ${selected.length} cases, ${Math.round(ms)} ms, model ${response.model}`);
    return response.answers;
  }
  const all = await run("all", 0, candidates);
  const repeated = await run("all", 1, candidates);
  const reversed = await run("all-reversed", 0, candidates, true);
  const local: Record<string, Answer> = {};
  const groupStarted = performance.now();
  for (const group of groups) Object.assign(local, await run("world-batch", 0, group));
  const groupWallMs = performance.now() - groupStarted;
  const individual: Record<string, Answer> = {};
  const individualStarted = performance.now();
  for (const candidate of candidates) Object.assign(individual, await run("individual", 0, [candidate]));
  const individualWallMs = performance.now() - individualStarted;
  const modes = ["all", "all-reversed", "world-batch", "individual"];
  const timing = Object.fromEntries(modes.map(mode => {
    const matching = calls.filter(c => c.mode === mode);
    const sorted = matching.map(c => c.ms).sort((a, b) => a - b);
    const quantile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
    return [mode, { calls: matching.length, requestMs: matching.reduce((s, c) => s + c.ms, 0), p50Ms: quantile(0.5), p95Ms: quantile(0.95), inputTokens: matching.reduce((s, c) => s + c.response.usage.input_tokens, 0) }];
  }));
  const report = {
    observedAt: new Date().toISOString(), rubricVersion: RUBRIC_VERSION,
    modelNames: [...new Set(calls.map(c => c.response.model))],
    limitations: ["Synthetic authored labels, no independent human annotation", "No calibration/held-out split; thresholds fixed at 0.5 for noul", "Hook means action/result is described, not fun or executable", "Short sample: latency includes network and provider load", "Reversed arm changes both candidate order and choice order", "All candidates share state in batched arms; context pollution is possible"],
    metrics: { all: summarize(fixtures.cases, all), repeated: summarize(fixtures.cases, repeated), reversed: summarize(fixtures.cases, reversed), local: summarize(fixtures.cases, local), individual: summarize(fixtures.cases, individual) },
    comparisons: { repeated: compareAnswers(all, repeated), reversed: compareAnswers(all, reversed), local: compareAnswers(all, local), individual: compareAnswers(local, individual) },
    timing, serialWall: { worldBatchMs: groupWallMs, individualMs: individualWallMs, ratio: individualWallMs / groupWallMs },
    tokens: { input: calls.reduce((s, c) => s + c.response.usage.input_tokens, 0), output: calls.reduce((s, c) => s + c.response.usage.output_tokens, 0) },
  };
  await writeFile(new URL("summary.json", output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ metrics: report.metrics.all, comparisons: report.comparisons, timing: report.timing, serialWall: report.serialWall }, null, 2));
}
