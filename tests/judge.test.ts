import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtures } from "../src/fixtures.ts";
import { buildPayload, summarize, compareAnswers } from "../src/judge.ts";
import { ask, parseResponse } from "../src/jev.ts";
import type { JevResponse, Questions } from "../src/contracts.ts";

const questions: Questions = {
  c: { type: "choice", instructions: "classify", criteria: { compatible: "yes", contradiction: "no", underdetermined: "unknown" } },
  h: { type: "noul", instructions: "hook?", criteria: { true: "action", false: "background" } },
};
const valid: JevResponse = {
  model: "jev-test",
  answers: {
    c: { type: "choice", choice: "compatible", confidence: 0.9, probabilities: { compatible: 0.95, contradiction: 0.03, underdetermined: 0.02 } },
    h: { type: "noul", noul: 0.8 },
  },
  usage: { input_tokens: 100, output_tokens: 10 },
};

test("fixtures cover each genre and distinguish conflicting truth from false beliefs", () => {
  assert.equal(fixtures.worlds.length, 4);
  assert.equal(fixtures.cases.length, 32);
  assert.equal(new Set(fixtures.cases.map(c => c.candidate.id)).size, 32);
  for (const world of fixtures.worlds) {
    const cases = fixtures.cases.filter(c => c.candidate.worldId === world.id);
    assert.equal(cases.length, 8);
    assert.ok(cases.some(c => ["belief", "record"].includes(c.candidate.layer) && c.expected.consistency === "compatible"));
    assert.ok(cases.some(c => c.expected.consistency === "contradiction"));
    assert.ok(cases.some(c => c.expected.consistency === "underdetermined"));
    assert.ok(cases.some(c => c.expected.leak));
    assert.ok(cases.some(c => !c.expected.hook));
  }
});

test("API payload contains no reference labels or label rationale", () => {
  const payload = buildPayload(fixtures, fixtures.cases.map(c => c.candidate));
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes('"expected"'));
  assert.ok(!serialized.includes('"rationale"'));
  assert.equal(Object.keys(payload.questions).length, 96);
  assert.equal(payload.state.candidates.length, 32);
  assert.ok(Object.values(payload.questions).every(q => typeof q.instructions === "object"));
});

test("local payload contains only selected candidates and their world", () => {
  const candidate = fixtures.cases[0]!.candidate;
  const payload = buildPayload(fixtures, [candidate]);
  assert.deepEqual(payload.state.worlds.map(w => w.id), [candidate.worldId]);
  assert.equal(payload.state.candidates.length, 1);
  assert.equal(Object.keys(payload.questions).length, 3);
  assert.throws(() => buildPayload(fixtures, [{ ...candidate, worldId: "missing" }]), /world/);
  assert.throws(() => buildPayload(fixtures, [candidate, candidate]), /duplicate/);
});

test("untrusted API response rejects missing, mismatched and out-of-domain answers", () => {
  assert.deepEqual(parseResponse(valid, questions), valid);
  assert.throws(() => parseResponse({ ...valid, answers: { h: valid.answers.h } }, questions), /c/);
  assert.throws(() => parseResponse({ ...valid, answers: { ...valid.answers, c: { type: "noul", noul: 0.9 } } }, questions), /c/);
  assert.throws(() => parseResponse({ ...valid, answers: { ...valid.answers, h: { type: "noul", noul: 1.2 } } }, questions), /h/);
  assert.throws(() => parseResponse({ ...valid, answers: { ...valid.answers, c: { ...valid.answers.c, choice: "invented" } } }, questions), /c/);
  assert.throws(() => parseResponse({ ...valid, answers: { ...valid.answers, c: { ...valid.answers.c, probabilities: { compatible: 0.95 } } } }, questions), /c/);
  assert.throws(() => parseResponse({ ...valid, usage: { input_tokens: -1, output_tokens: 0 } }, questions), /usage/);
});

test("HTTP error does not expose echoed credentials", async () => {
  await assert.rejects(ask({ state: {}, questions }, {
    apiKey: "secret-marker",
    fetchImpl: async () => new Response("echo secret-marker", { status: 401 }),
  }), err => err instanceof Error && err.message.includes("401") && !err.message.includes("secret-marker"));
});

test("client sends nested criteria and validates the response", async () => {
  let sent: unknown;
  const response = await ask({ state: { story: "hello" }, questions }, {
    apiKey: "test-only",
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json(valid);
    },
  });
  assert.deepEqual(sent, { model: "jev-latest", state: { story: "hello" }, questions });
  assert.deepEqual(response.response, valid);
  assert.ok(response.ms >= 0);
});

test("report keeps contradiction precision and recall separate from hook quality", () => {
  const cases = fixtures.cases.slice(0, 2);
  const answers: JevResponse["answers"] = {};
  for (const c of cases) {
    const id = c.candidate.id;
    answers[`${id}.consistency`] = { type: "choice", choice: "compatible", confidence: 1, probabilities: { compatible: 1, contradiction: 0, underdetermined: 0 } };
    answers[`${id}.hook`] = { type: "noul", noul: Number(c.expected.hook) };
    answers[`${id}.leak`] = { type: "noul", noul: Number(c.expected.leak) };
  }
  const report = summarize(cases, answers);
  assert.equal(report.consistency.correct, 1);
  assert.equal(report.consistency.total, 2);
  assert.equal(report.contradiction.recall, 0);
  assert.equal(report.contradiction.precision, null);
  assert.equal(report.falseBeliefRejected, 0);
  assert.equal(report.hook.correct, 2);
  assert.equal(report.errors[0]!.id, cases[0]!.candidate.id);
  const differences = compareAnswers(answers, answers);
  assert.equal(differences.changedDecisions, 0);
});

test("missing answers cannot be counted as passes in reporting or comparisons", () => {
  assert.throws(() => summarize(fixtures.cases, {}), /missing/);
  assert.throws(() => compareAnswers(valid.answers, {}), /missing/);
});
