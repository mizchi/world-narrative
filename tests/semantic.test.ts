import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectContext, reviewSemantics, semanticInputHash } from "../src/world/semantic.ts";
import type { Proposal, World } from "../src/world/types.ts";

const world: World = {
  formatVersion: "world-narrative/v1", id: "test", revision: "r0", title: "test",
  contract: { genre: "dark-fantasy", promise: "explore", verbs: ["explore"], branches: ["main"] },
  entities: [
    { id: "person.a", kind: "person", name: "A", description: "A", gameRole: "interactive" },
    { id: "person.unrelated", kind: "person", name: "U", description: "unrelated", gameRole: "background" },
  ],
  predicates: [{ id: "alive", valueKind: "boolean", subjectKinds: ["person"], cardinality: "one" }],
  claims: [{ id: "claim.alive", subjectId: "person.a", predicateId: "alive", value: { kind: "boolean", value: false }, scope: { branchId: "main", time: "atemporal", conditionId: "always" }, text: "A is dead." }],
  assertions: [{ id: "assert.alive", claimId: "claim.alive", layer: { kind: "authorTruth", polarity: "assert" }, status: "accepted", source: { artifactId: "person.a", locator: "test", authorId: "person.a" } }],
  rules: [], openQuestions: [], episodes: [],
  game: { startLocationId: "person.a", deadlineHours: 1, variables: [], locations: [], routes: [], endings: [] },
};
const proposal: Proposal = {
  formatVersion: "world-narrative/v1", id: "local.p", namespace: "local", basedOnRevision: "r0", readSet: ["person.a"], writeSet: ["local.b"],
  operations: [{ kind: "addEntity", entity: { id: "local.b", kind: "person", name: "B", description: "B mourns A", gameRole: "interactive" } }], notes: "test",
};

test("context follows subject/claim/assertion edges while omitting unrelated entities", () => {
  const context = collectContext(world, proposal);
  assert.deepEqual(context.entities.map(e => e.id), ["person.a"]);
  assert.equal(context.claims[0]!.id, "claim.alive");
  assert.equal(context.assertions[0]!.id, "assert.alive");
  assert.equal(context.predicates[0]!.id, "alive");
  assert.deepEqual(context.proposal, proposal);
});

test("context includes adopted episodes sharing a resource and their narrative dependencies", () => {
  const shared: World = structuredClone(world);
  shared.game.variables = [{ id: "supply", kind: "number", initial: 6, minimum: 0, maximum: 6 }];
  shared.episodes = [{
    id: "earlier.episode", title: "Earlier allocation", locationId: "person.a", participants: ["person.unrelated"],
    intro: [], fragments: [], completion: { op: "true" },
    actions: [{ id: "earlier.spend", label: "Spend", text: "Uses the same supply", condition: { op: "true" }, costHours: 1, effects: [{ kind: "add", variable: "supply", amount: -4 }] }],
  }];
  const context = collectContext(shared, { ...proposal, readSet: ["supply"] });
  assert.deepEqual(context.episodes.map(e => e.id), ["earlier.episode"]);
  assert.ok(context.entities.some(e => e.id === "person.unrelated"));
  assert.deepEqual(context.game, shared.game);
});

test("semantic cache binds world contents, revision, proposal and model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narrative-cache-"));
  let calls = 0;
  const request: typeof import("../src/jev.ts").ask = async payload => {
    calls++;
    return { ms: 1, response: { model: "jev-test", answers: Object.fromEntries(Object.keys(payload.questions).map(k => [k, { type: "noul" as const, noul: k === "playable" ? 0.99 : 0.01 }])), usage: { input_tokens: 20, output_tokens: 4 } } };
  };
  try {
    const options = { cacheDirectory: dir, model: "jev-test", request };
    const first = await reviewSemantics(world, proposal, options);
    const second = await reviewSemantics(world, proposal, options);
    assert.equal(first.status, "clear");
    assert.equal(second.source, "cache");
    assert.equal(calls, 1);
    await reviewSemantics({ ...world, revision: "r1" }, proposal, options);
    assert.equal(calls, 2);
    assert.notEqual(semanticInputHash(world, proposal), semanticInputHash(world, { ...proposal, notes: "changed" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("uncertain, failed, wrong-model or malformed responses are not an approval", async () => {
  const request: typeof import("../src/jev.ts").ask = async payload => ({ ms: 1, response: { model: "jev-test", answers: Object.fromEntries(Object.keys(payload.questions).map(k => [k, { type: "noul" as const, noul: 0.5 }])), usage: { input_tokens: 20, output_tokens: 4 } } });
  assert.equal((await reviewSemantics(world, proposal, { model: "jev-test", request })).status, "needs-review");
  assert.equal((await reviewSemantics(world, proposal, { model: "other", request })).status, "needs-review");
  assert.equal((await reviewSemantics(world, proposal, { request: async () => { throw new Error("network"); } })).status, "needs-review");
  assert.equal((await reviewSemantics(world, proposal, { request: async () => ({ ms: 1, response: { model: "jev-test", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } } }), model: "jev-test" })).status, "needs-review");
});
