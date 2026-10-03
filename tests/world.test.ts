import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorld, parseProposal, parseProject, jsonSchemas } from "../src/world/schema.ts";
import { validateWorld } from "../src/world/validate.ts";
import { previewProposal, commitProposal } from "../src/world/proposal.ts";
import { createProject, loadProject, saveProject } from "../src/world/store.ts";
import { FORMAT_VERSION, type Claim, type Proposal, type World } from "../src/world/types.ts";

function world(): World {
  return {
    formatVersion: FORMAT_VERSION, id: "world.test", revision: "revision.initial", title: "港",
    contract: { genre: "dark-fantasy", promise: "調査する", verbs: ["調べる"], branches: ["main", "alternate"] },
    entities: [
      { id: "place.port", kind: "place", name: "港", description: "港", gameRole: "interactive" },
      { id: "person.reader", kind: "person", name: "記録係", description: "記録係", gameRole: "background" },
      { id: "item.record", kind: "item", name: "日誌", description: "日誌", gameRole: "background" },
    ],
    predicates: [
      { id: "predicate.color", valueKind: "text", subjectKinds: ["place"], cardinality: "one" },
      { id: "predicate.weight", valueKind: "quantity", subjectKinds: ["item"], cardinality: "one", unit: "kg" },
    ],
    claims: [{ id: "claim.blue", subjectId: "place.port", predicateId: "predicate.color", value: { kind: "text", value: "blue" }, scope: { branchId: "main", time: "atemporal", conditionId: "always" }, text: "港は青い" }],
    assertions: [{ id: "assertion.blue", claimId: "claim.blue", layer: { kind: "authorTruth", polarity: "assert" }, status: "accepted", source: { artifactId: "external:seed", locator: "1", authorId: "external:author" } }],
    rules: [], openQuestions: [], episodes: [],
    game: {
      startLocationId: "place.port", deadlineHours: 72,
      variables: [{ id: "port.tested", kind: "boolean", initial: false }, { id: "world.powder", kind: "number", initial: 6, minimum: 0, maximum: 6 }, { id: "port.choice", kind: "enum", initial: "pending", values: ["pending", "done"] }],
      locations: [{ entityId: "place.port", description: "港" }], routes: [], endings: [],
    },
  };
}
function proposal(w: World, value = "red"): Proposal {
  const claim: Claim = { ...structuredClone(w.claims[0]!), id: "draft.color", value: { kind: "text", value }, text: value };
  return {
    formatVersion: FORMAT_VERSION, id: "proposal.color", basedOnRevision: w.revision, namespace: "draft",
    readSet: ["place.port", "predicate.color"], writeSet: ["draft.color", "draft.assertion"], notes: "提案",
    operations: [{ kind: "addClaim", claim }, { kind: "addAssertion", assertion: { id: "draft.assertion", claimId: claim.id, layer: { kind: "authorTruth", polarity: "assert" }, status: "proposed", source: { artifactId: "external:draft", locator: "1", authorId: "external:writer" } } }],
  };
}
function codes(w: World): string[] { return validateWorld(w).findings.map(f => f.code); }

test("strict parsers reject unknown nested keys and expose JSON Schemas", () => {
  const w = world();
  assert.deepEqual(parseWorld(w), w);
  assert.throws(() => parseWorld({ ...w, unexpected: true }));
  assert.throws(() => parseWorld({ ...w, claims: [{ ...w.claims[0], value: { kind: "text", value: "blue", secret: true } }] }));
  const p = proposal(w);
  assert.deepEqual(parseProposal(p), p);
  assert.throws(() => parseProposal({ ...p, operations: [{ ...p.operations[0], typo: true }] }));
  assert.throws(() => parseProject({ formatVersion: FORMAT_VERSION, world: w, history: [], typo: true }));
  const schemas = jsonSchemas() as Record<string, { type?: string; additionalProperties?: boolean }>;
  for (const schema of Object.values(schemas)) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
  }
});

test("references, duplicate IDs, predicate contracts, scopes and variable domains are validated", () => {
  assert.equal(validateWorld(world()).status, "valid");
  const w = world();
  w.entities.push({ ...w.entities[0]! });
  w.claims[0]!.subjectId = "missing";
  w.claims[0]!.scope.branchId = "missing";
  w.claims[0]!.scope.time = { start: 10, endExclusive: 3 };
  assert.ok(codes(w).includes("duplicate-id"));
  assert.ok(codes(w).includes("unknown-reference"));
  assert.ok(codes(w).includes("unknown-branch"));
  assert.ok(codes(w).includes("invalid-time-range"));
  const wrong = world();
  wrong.claims[0]!.subjectId = "person.reader";
  wrong.claims[0]!.value = { kind: "boolean", value: true };
  wrong.claims.push({ ...wrong.claims[0]!, id: "claim.weight", subjectId: "item.record", predicateId: "predicate.weight", value: { kind: "quantity", value: 4, unit: "lb" } });
  wrong.game.variables[1] = { id: "world.powder", kind: "number", initial: 9, minimum: 0, maximum: 6 };
  wrong.game.variables[2] = { id: "port.choice", kind: "enum", initial: "unknown", values: ["pending"] };
  assert.ok(codes(wrong).includes("subject-kind"));
  assert.ok(codes(wrong).includes("value-kind"));
  assert.ok(codes(wrong).includes("quantity-unit"));
  assert.ok(codes(wrong).includes("variable-domain"));
});

test("provenance references are local entities unless explicitly external and local reads must be declared", () => {
  const w = world();
  w.assertions[0]!.source.artifactId = "missing.artifact";
  w.assertions[0]!.source.authorId = "missing.author";
  assert.ok(validateWorld(w).findings.some(f => f.code === "unknown-reference" && f.path.endsWith("source.artifactId")));
  assert.ok(validateWorld(w).findings.some(f => f.code === "unknown-reference" && f.path.endsWith("source.authorId")));
  const base = world();
  const p = proposal(base, "blue");
  if (p.operations[1]!.kind === "addAssertion") p.operations[1]!.assertion.source = { artifactId: "item.record", authorId: "person.reader", locator: "1" };
  assert.ok(previewProposal(base, p).report.findings.some(f => f.code === "read-set" && f.relatedIds.includes("item.record")));
  assert.ok(previewProposal(base, p).report.findings.some(f => f.code === "read-set" && f.relatedIds.includes("person.reader")));
  p.readSet.push("item.record", "person.reader");
  assert.equal(previewProposal(base, p).report.status, "valid");
  assert.equal(validateWorld(world()).status, "valid");
});

test("single-valued truth conflicts only in overlapping branch and time", () => {
  const w = world();
  assert.equal(previewProposal(w, proposal(w)).report.status, "invalid");
  for (const scope of [
    { branchId: "alternate", time: "atemporal" as const, conditionId: "always" },
    { branchId: "main", time: { start: 10, endExclusive: 20 }, conditionId: "always" },
  ]) {
    const base = world();
    base.claims[0]!.scope.time = { start: 0, endExclusive: 10 };
    const p = proposal(base);
    if (p.operations[0]!.kind === "addClaim") p.operations[0]!.claim.scope = scope;
    assert.equal(previewProposal(base, p).report.status, "valid");
  }
  const unknown = world();
  unknown.claims[0]!.scope.conditionId = "unsupported";
  assert.equal(validateWorld(unknown).status, "needs-review");
});

test("denial, forbidden truth and unresolved author decisions remain distinct from beliefs and records", () => {
  const w = world();
  const p = proposal(w, "blue");
  if (p.operations[1]!.kind === "addAssertion") p.operations[1]!.assertion.layer = { kind: "authorTruth", polarity: "deny" };
  assert.ok(previewProposal(w, p).report.findings.some(f => f.code === "truth-polarity-conflict"));
  for (const layer of [{ kind: "belief" as const, holderId: "person.reader", polarity: "believes" as const }, { kind: "record" as const, documentId: "item.record" }]) {
    const belief = proposal(w);
    if (belief.operations[1]!.kind === "addAssertion") belief.operations[1]!.assertion.layer = layer;
    belief.readSet.push(layer.kind === "belief" ? layer.holderId : layer.documentId);
    const result = commitProposal({ formatVersion: FORMAT_VERSION, world: w, history: [] }, belief, { author: "editor", reason: "誤った記録として採用" });
    assert.equal(result.world.assertions.at(-1)!.layer.kind, layer.kind);
    assert.equal(result.world.assertions.at(-1)!.status, "accepted");
    assert.equal(validateWorld(result.world).status, "valid");
  }
  const forbidden = world();
  forbidden.rules.push({ id: "rule.red", kind: "forbidTruth", subjectId: "place.port", predicateId: "predicate.color", value: { kind: "text", value: "red" }, text: "赤くない" });
  assert.ok(previewProposal(forbidden, proposal(forbidden)).report.findings.some(f => f.code === "forbidden-truth"));
  const unresolved = world();
  unresolved.assertions = [];
  unresolved.openQuestions.push({ id: "question.color", subjectId: "place.port", predicateId: "predicate.color", text: "色は未確定" });
  const review = previewProposal(unresolved, proposal(unresolved));
  assert.equal(review.report.status, "needs-review");
  assert.ok(review.report.findings.some(f => f.code === "open-question"));
});

test("executable conditions, effects, disclosure and truth knowledge have strict references and types", () => {
  const w = world();
  w.rules.push({ id: "rule.reveal", kind: "reveal", claimId: "claim.blue", condition: { op: "eq", variable: "port.tested", value: true }, text: "検査後" });
  w.episodes.push({
    id: "episode.port", title: "調査", locationId: "place.port", participants: ["person.reader"],
    intro: [{ id: "fragment.early", condition: { op: "true" }, text: "青い", disclosedClaimIds: ["claim.blue"] }],
    actions: [{ id: "action.bad", label: "調べる", text: "調べる", condition: { op: "gte", variable: "port.tested", value: 1 }, costHours: 1, effects: [{ kind: "add", variable: "port.tested", amount: 1 }, { kind: "set", variable: "port.choice", value: "missing" }, { kind: "learn", claimId: "missing", mode: "known" }] }],
    fragments: [], completion: { op: "eq", variable: "missing", value: true },
  });
  const found = codes(w);
  assert.ok(found.includes("condition-type"));
  assert.ok(found.includes("effect-type"));
  assert.ok(found.includes("effect-value"));
  assert.ok(found.includes("unknown-reference"));
  assert.ok(found.includes("early-disclosure"));
  w.assertions[0]!.layer = { kind: "record", documentId: "item.record" };
  w.episodes[0]!.actions[0]!.effects = [{ kind: "learn", claimId: "claim.blue", mode: "known" }];
  assert.ok(codes(w).includes("knowledge-not-truth"));
});

test("reveal checks use the atomic variable update regardless of learn array order", () => {
  const w = world();
  w.rules.push({ id: "rule.reveal", kind: "reveal", claimId: "claim.blue", condition: { op: "eq", variable: "port.tested", value: true }, text: "検査後" });
  w.episodes.push({ id: "episode.port", title: "調査", locationId: "place.port", participants: [], intro: [], fragments: [], completion: { op: "true" }, actions: [{ id: "action.test", label: "検査", text: "検査", condition: { op: "true" }, costHours: 1, effects: [{ kind: "set", variable: "port.tested", value: true }, { kind: "learn", claimId: "claim.blue", mode: "known" }] }] });
  assert.equal(validateWorld(w).status, "valid");
  w.episodes[0]!.actions[0]!.effects.reverse();
  assert.equal(validateWorld(w).status, "valid");
  w.episodes[0]!.actions[0]!.effects = [{ kind: "learn", claimId: "claim.blue", mode: "known" }];
  assert.ok(codes(w).includes("early-disclosure"));
});

test("knowledge effects cannot authorize another learn in the same atomic action", () => {
  const w = world();
  w.claims.push({ ...w.claims[0]!, id: "claim.other", scope: { ...w.claims[0]!.scope, branchId: "alternate" } });
  w.assertions.push({ ...w.assertions[0]!, id: "assertion.other", claimId: "claim.other" });
  w.rules.push({ id: "rule.other", kind: "reveal", claimId: "claim.other", condition: { op: "knows", claimId: "claim.blue" }, text: "先に青を知る" });
  w.episodes.push({ id: "episode.port", title: "調査", locationId: "place.port", participants: [], intro: [], fragments: [], completion: { op: "true" }, actions: [{ id: "action.test", label: "検査", text: "検査", condition: { op: "true" }, costHours: 1, effects: [{ kind: "learn", claimId: "claim.blue", mode: "known" }, { kind: "learn", claimId: "claim.other", mode: "known" }] }] });
  assert.ok(codes(w).includes("early-disclosure"));
});

test("reveal proof checks feasible interior states after multiple resource effects", () => {
  const w = world();
  w.game.variables[1] = { id: "world.powder", kind: "number", initial: 0, minimum: 0, maximum: 100 };
  w.rules.push({ id: "rule.reveal", kind: "reveal", claimId: "claim.blue", condition: { op: "eq", variable: "port.tested", value: true }, text: "検査後" });
  w.episodes.push({ id: "episode.port", title: "調査", locationId: "place.port", participants: [], intro: [], fragments: [], completion: { op: "true" }, actions: [{ id: "action.test", label: "検査", text: "検査", condition: { op: "true" }, costHours: 1, effects: [{ kind: "add", variable: "world.powder", amount: 50 }, { kind: "add", variable: "world.powder", amount: -100 }, { kind: "add", variable: "world.powder", amount: 50 }, { kind: "learn", claimId: "claim.blue", mode: "known" }] }] });
  assert.ok(codes(w).includes("early-disclosure"));
});

test("proposal namespace, declared read/write sets, collision, status and revision are checked", () => {
  const w = world();
  const p = proposal(w, "blue");
  p.namespace = "other";
  p.basedOnRevision = "revision.old";
  p.readSet = ["missing"];
  p.writeSet = ["missing"];
  const found = previewProposal(w, p).report.findings.map(f => f.code);
  for (const code of ["proposal-namespace", "stale-revision", "read-set", "write-set"]) assert.ok(found.includes(code), code);
  const accepted = proposal(w, "blue");
  if (accepted.operations[1]!.kind === "addAssertion") accepted.operations[1]!.assertion.status = "accepted";
  assert.ok(previewProposal(w, accepted).report.findings.some(f => f.code === "assertion-status"));
  const collision = proposal(w, "blue");
  if (collision.operations[0]!.kind === "addClaim") collision.operations[0]!.claim.id = "claim.blue";
  assert.ok(previewProposal(w, collision).report.findings.some(f => f.code === "duplicate-id"));
  assert.deepEqual(w, world());
  const incomplete = proposal(w, "blue");
  incomplete.readSet = ["place.port"];
  assert.ok(previewProposal(w, incomplete).report.findings.some(f => f.code === "read-set" && f.relatedIds.includes("predicate.color")));
  incomplete.operations.push({ kind: "addEpisode", episode: { id: "draft.episode", title: "調査", locationId: "place.port", participants: [], intro: [{ id: "outside.fragment", condition: { op: "true" }, text: "港", disclosedClaimIds: [] }], actions: [], fragments: [], completion: { op: "true" } } });
  incomplete.writeSet.push("draft.episode");
  const nested = previewProposal(w, incomplete).report.findings;
  assert.ok(nested.some(f => f.code === "write-set" && f.relatedIds.includes("outside.fragment")));
  assert.ok(nested.some(f => f.code === "proposal-namespace" && f.relatedIds.includes("outside.fragment")));
});

test("commit requires author decision, promotes assertions, records history and supersedes explicitly", () => {
  const w = world();
  const project = { formatVersion: FORMAT_VERSION, world: w, history: [] };
  const p = proposal(w);
  assert.throws(() => commitProposal(project, p, { author: "editor", reason: "理由" }), /invalid|conflict/);
  p.operations.unshift({ kind: "supersedeAssertion", assertionId: "assertion.blue" });
  p.readSet.push("assertion.blue", "claim.blue");
  p.writeSet.push("assertion.blue");
  assert.throws(() => commitProposal(project, p, { author: "", reason: "" }), /decision/);
  const result = commitProposal(project, p, { author: "editor", reason: "調査で訂正" }, "2026-10-03T00:00:00.000Z");
  assert.notEqual(result.world.revision, w.revision);
  assert.equal(result.world.assertions[0]!.status, "superseded");
  assert.equal(result.world.assertions.at(-1)!.status, "accepted");
  assert.equal(result.history[0]!.parent, w.revision);
  assert.deepEqual(result.history[0]!.proposal, p);
  assert.equal(result.history[0]!.decision.author, "editor");
  assert.deepEqual(project.world, world());
  assert.throws(() => commitProposal(result, p, { author: "editor", reason: "古い" }), /stale/);
});

test("project store refuses reinitialization and atomically detects concurrent stale writers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "world-store-"));
  try {
    const initial = await createProject(dir, world());
    await assert.rejects(createProject(dir, world()), /exists|initialized/);
    assert.deepEqual(await loadProject(dir), initial);
    const p = proposal(initial.world, "blue");
    const first = commitProposal(initial, p, { author: "editor", reason: "一案" });
    const second = commitProposal(initial, p, { author: "editor", reason: "別案" });
    const results = await Promise.allSettled([saveProject(dir, first, initial.world.revision), saveProject(dir, second, initial.world.revision)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const failed = results.find(r => r.status === "rejected");
    assert.ok(failed?.status === "rejected" && /conflict|revision/i.test(String(failed.reason)));
    const loaded = await loadProject(dir);
    assert.ok([first.world.revision, second.world.revision].includes(loaded.world.revision));
    assert.deepEqual(parseProject(JSON.parse(await readFile(join(dir, "project.json"), "utf8"))), loaded);
    await assert.rejects(saveProject(dir, initial, initial.world.revision), /conflict|revision/i);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("store rejects edits to accepted canon hidden inside an otherwise valid new revision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "world-store-canon-"));
  try {
    const initial = await createProject(dir, world());
    const next = commitProposal(initial, proposal(initial.world, "blue"), { author: "editor", reason: "同じ色の出典" });
    next.world.claims[0]!.text = "提案に含めず書き換えた正史";
    await assert.rejects(saveProject(dir, next, initial.world.revision), /declared proposal|canon|conflict/i);
    assert.deepEqual(await loadProject(dir), initial);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
