import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameArtifact, World } from "../src/world/types.ts";
import { initialState, evaluate, availableActions, travel, act, visibleFragments, finish, checkReachability } from "../src/player/runtime.ts";
import { toGameArtifact, exportGame } from "../src/player/export.ts";
import { serveGame } from "../src/player/server.ts";

function fixture(): GameArtifact {
  return {
    formatVersion: "world-narrative/v1", worldId: "test", revision: "r1", title: "灰潮の港", promise: "時間と在庫を分け合う探索",
    game: {
      startLocationId: "harbor", deadlineHours: 12,
      variables: [
        { id: "powder", kind: "number", initial: 2, minimum: 0, maximum: 2 },
        { id: "tested", kind: "boolean", initial: false },
        { id: "decision", kind: "enum", initial: "pending", values: ["pending", "save", "leave"] },
      ],
      locations: [{ entityId: "harbor", description: "港。灰潮を待っている。" }, { entityId: "south", description: "南門。二つの水槽がある。" }, { entityId: "isolated", description: "離れ島。" }],
      routes: [{ from: "harbor", to: "south", hours: 2 }, { from: "south", to: "harbor", hours: 2 }],
      endings: [
        { id: "end.save", condition: { op: "eq", variable: "decision", value: "save" }, text: "水槽を救った。", disclosedClaimIds: [] },
        { id: "end.leave", condition: { op: "not", condition: { op: "eq", variable: "decision", value: "save" } }, text: "水槽を灰潮に委ねた。", disclosedClaimIds: [] },
      ],
    },
    revealRules: [{ id: "reveal.secret", kind: "reveal", claimId: "secret", condition: { op: "eq", variable: "tested", value: true }, text: "AUTHOR RULE TEXT" }],
    episodes: [{
      id: "south.story", title: "南門", locationId: "south", participants: [],
      intro: [{ id: "intro", condition: { op: "true" }, text: "南門に着いた。", disclosedClaimIds: [] }],
      actions: [
        { id: "rumor", label: "噂を聞く", text: "記憶が重要だと信じる人がいる。", condition: { op: "true" }, costHours: 1, effects: [{ kind: "learn", claimId: "rumor", mode: "believed" }] },
        { id: "observe", label: "観察する", text: "粒が光った。", condition: { op: "true" }, costHours: 1, effects: [{ kind: "learn", claimId: "light", mode: "observed" }] },
        { id: "test", label: "実験する", text: "効力を比べた。", condition: { op: "true" }, costHours: 2, effects: [{ kind: "set", variable: "tested", value: true }, { kind: "learn", claimId: "secret", mode: "known" }] },
        { id: "save", label: "水槽を守る", text: "水槽に粉を配った。", condition: { op: "eq", variable: "decision", value: "pending" }, costHours: 4, effects: [{ kind: "add", variable: "powder", amount: -2 }, { kind: "set", variable: "decision", value: "save" }] },
        { id: "leave", label: "ここを離れる", text: "粉を使わずに立ち去った。", condition: { op: "eq", variable: "decision", value: "pending" }, costHours: 0, effects: [{ kind: "set", variable: "decision", value: "leave" }] },
      ],
      fragments: [{ id: "secret.fragment", condition: { op: "true" }, text: "記憶の重要さで効力は増えない。", disclosedClaimIds: ["secret"] }],
      completion: { op: "not", condition: { op: "eq", variable: "decision", value: "pending" } },
    }],
  };
}

function worldFixture(): World {
  const artifact = fixture();
  return {
    formatVersion: artifact.formatVersion, id: artifact.worldId, revision: artifact.revision, title: artifact.title,
    contract: { genre: "dark-fantasy", promise: artifact.promise, verbs: ["explore"], branches: ["main"] },
    entities: [{ id: "secret.entity", kind: "anomaly", name: "Secret", description: "AUTHOR DESCRIPTION", gameRole: "background" }], predicates: [],
    claims: [{ id: "secret", subjectId: "secret.entity", predicateId: "test", value: { kind: "text", value: "AUTHOR CANON SECRET" }, scope: { branchId: "main", time: "atemporal", conditionId: "always" }, text: "AUTHOR CANON SECRET" }],
    assertions: [], rules: artifact.revealRules, openQuestions: [{ id: "question", text: "AUTHOR QUESTION", subjectId: "secret.entity", predicateId: "test" }],
    episodes: artifact.episodes, game: artifact.game,
  };
}

test("travel advances time through connected routes without mutating initial state", () => {
  const game = fixture();
  const state = initialState(game);
  const before = structuredClone(state);
  const moved = travel(game, state, "south");
  assert.equal(moved.elapsedHours, 2);
  assert.equal(moved.locationId, "south");
  assert.deepEqual(state, before);
  assert.throws(() => travel(game, state, "isolated"), /経路/);
  assert.throws(() => act(game, state, "test"), /行動/);
  assert.throws(() => travel(game, { ...state, elapsedHours: 11 }, "south"), /締切/);
});

test("actions enforce time, one-shot behavior and exclusive choices", () => {
  const game = fixture();
  const arrived = travel(game, initialState(game), "south");
  const saved = act(game, arrived, "save");
  assert.equal(saved.elapsedHours, 6);
  assert.equal(saved.variables.powder, 0);
  assert.ok(!availableActions(game, saved).some(a => ["save", "leave"].includes(a.id)));
  assert.throws(() => act(game, saved, "save"), /実行済み/);
  assert.throws(() => act(game, saved, "leave"), /条件/);
  assert.throws(() => act(game, { ...arrived, elapsedHours: 10 }, "save"), /締切/);
  assert.deepEqual(arrived.variables, { powder: 2, tested: false, decision: "pending" });
});

test("all effects are atomic when resources or variable domains fail", () => {
  const game = fixture();
  game.episodes[0]!.actions.push({ id: "invalid", label: "失敗", text: "", condition: { op: "true" }, costHours: 1, effects: [{ kind: "set", variable: "tested", value: true }, { kind: "add", variable: "powder", amount: -3 }] });
  const state = travel(game, initialState(game), "south");
  const before = structuredClone(state);
  assert.throws(() => act(game, state, "invalid"), /範囲/);
  assert.deepEqual(state, before);
  game.episodes[0]!.actions[game.episodes[0]!.actions.length - 1]!.effects = [{ kind: "add", variable: "powder", amount: 1 }];
  assert.throws(() => act(game, state, "invalid"), /範囲/);
  game.episodes[0]!.actions[game.episodes[0]!.actions.length - 1]!.effects = [{ kind: "set", variable: "decision", value: "unexpected" }];
  assert.throws(() => act(game, state, "invalid"), /値/);
  assert.deepEqual(state, before);
});

test("knowledge preserves observed and believed distinctions and gates disclosures", () => {
  const game = fixture();
  let state = travel(game, initialState(game), "south");
  assert.ok(!visibleFragments(game, state).some(f => f.id === "secret.fragment"));
  state = act(game, state, "rumor");
  state = act(game, state, "observe");
  assert.equal(state.knowledge.rumor, "believed");
  assert.equal(state.knowledge.light, "observed");
  assert.equal(evaluate({ op: "knows", claimId: "rumor" }, state), false);
  assert.equal(evaluate({ op: "knows", claimId: "light" }, state), false);
  state = act(game, state, "test");
  assert.equal(evaluate({ op: "knows", claimId: "secret" }, state), true);
  assert.ok(visibleFragments(game, state).some(f => f.id === "secret.fragment"));
});

test("secret learning requires reveal rules after atomic action effects", () => {
  const game = fixture();
  game.episodes[0]!.actions.push({ id: "leak", label: "早期開示", text: "", condition: { op: "true" }, costHours: 0, effects: [{ kind: "learn", claimId: "secret", mode: "observed" }] });
  const state = travel(game, initialState(game), "south");
  assert.throws(() => act(game, state, "leak"), /開示/);
  assert.equal(state.knowledge.secret, undefined);
  assert.ok(!availableActions(game, state).some(a => a.id === "leak"));
  const report = checkReachability(game);
  assert.ok(report.findings.some(f => f.code === "secret.early-learn"));
});

test("finish emits tide and ending logs, is idempotent and closes interaction", () => {
  const game = fixture();
  const state = act(game, travel(game, initialState(game), "south"), "save");
  const ended = finish(game, state);
  assert.equal(ended.ended, true);
  assert.equal(ended.elapsedHours, game.game.deadlineHours);
  assert.ok(ended.log.some(line => line.includes("灰潮")));
  assert.ok(ended.log.some(line => line.includes("水槽を救った")));
  assert.deepEqual(finish(game, ended), ended);
  assert.equal(availableActions(game, ended).length, 0);
  assert.throws(() => act(game, ended, "test"), /終了/);
  assert.throws(() => travel(game, ended, "harbor"), /終了/);
  assert.equal(state.ended, false);
});

test("finite reachability distinguishes unreachable content from a truncated search", () => {
  const game = fixture();
  game.episodes.push({ id: "island.story", title: "孤島", locationId: "isolated", participants: [], intro: [], fragments: [], actions: [{ id: "island.action", label: "読む", text: "", condition: { op: "true" }, costHours: 0, effects: [] }], completion: { op: "true" } });
  const report = checkReachability(game, 10000);
  assert.equal(report.status, "complete");
  assert.deepEqual(report.unreachableEpisodes, ["island.story"]);
  assert.deepEqual(report.unreachableActions, ["island.action"]);
  assert.ok(report.terminalStates > 0);
  assert.ok(report.findings.some(f => f.code === "secret.early-fragment"));
  const limited = checkReachability(game, 1);
  assert.equal(limited.status, "limit-reached");
  assert.equal(limited.visitedStates, 1);
  assert.ok(limited.findings.some(f => f.code === "reachability.limit"));
});

test("conditions compose boolean logic and reject undefined numeric variables", () => {
  const state = initialState(fixture());
  assert.equal(evaluate({ op: "all", conditions: [{ op: "gte", variable: "powder", value: 2 }, { op: "not", condition: { op: "eq", variable: "tested", value: true } }] }, state), true);
  assert.equal(evaluate({ op: "any", conditions: [{ op: "lte", variable: "powder", value: 0 }, { op: "knows", claimId: "unknown" }] }, state), false);
  assert.equal(evaluate({ op: "gte", variable: "unknown", value: 0 }, state), false);
});

test("export projects only explicit game fields and omits author material and extra keys", async () => {
  const world = worldFixture();
  world.entities.push({ id: "harbor", kind: "place", name: "港の入口", description: "AUTHOR PRIVATE PLACE DESCRIPTION", gameRole: "interactive" });
  Object.assign(world, { apiKey: "API KEY MARKER" });
  Object.assign(world.episodes[0]!, { source: "PRIVATE SOURCE" });
  Object.assign(world.game, { authorNotes: "PRIVATE GAME NOTES" });
  Object.assign(world.game.locations[0]!, { privateDescription: "PRIVATE LOCATION" });
  const game = toGameArtifact(world);
  const serialized = JSON.stringify(game);
  for (const secret of ["AUTHOR DESCRIPTION", "AUTHOR CANON SECRET", "AUTHOR QUESTION", "AUTHOR RULE TEXT", "AUTHOR PRIVATE PLACE DESCRIPTION", "API KEY MARKER", "PRIVATE SOURCE", "PRIVATE GAME NOTES", "PRIVATE LOCATION"]) assert.ok(!serialized.includes(secret), secret);
  assert.ok(game.game.locations[0]!.description.startsWith("港の入口\n"));
  assert.ok(serialized.includes("記憶の重要さで効力は増えない"));
  assert.equal(game.revealRules[0]!.text, "");
  game.game.variables[0]!.initial = 0;
  assert.equal(world.game.variables[0]!.initial, 2);
  const directory = await mkdtemp(join(tmpdir(), "world-player-"));
  try {
    await exportGame(world, directory);
    const json = await readFile(join(directory, "game.json"), "utf8");
    const html = await readFile(join(directory, "index.html"), "utf8");
    const runtime = await readFile(join(directory, "runtime.js"), "utf8");
    assert.ok(html.includes('lang="ja"'));
    assert.ok(html.includes("残り時間"));
    assert.ok(runtime.includes("export function initialState"));
    for (const secret of ["AUTHOR CANON SECRET", "AUTHOR RULE TEXT", "API KEY MARKER"]) assert.ok(![json, html, runtime].join("").includes(secret));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reachability requires a reachable episode completion, not only location access", () => {
  const game = fixture();
  game.episodes[0]!.completion = { op: "eq", variable: "decision", value: "impossible" };
  const report = checkReachability(game);
  assert.equal(report.status, "complete");
  assert.deepEqual(report.unreachableActions, []);
  assert.deepEqual(report.unreachableEpisodes, ["south.story"]);
});

test("learning a rumor later does not downgrade established knowledge", () => {
  const game = fixture();
  game.episodes[0]!.actions.push({ id: "late-rumor", label: "あとから噂を聞く", text: "", condition: { op: "true" }, costHours: 0, effects: [{ kind: "learn", claimId: "secret", mode: "believed" }] });
  const known = act(game, travel(game, initialState(game), "south"), "test");
  const later = act(game, known, "late-rumor");
  assert.equal(later.knowledge.secret, "known");
  const restarted = initialState(game);
  assert.deepEqual(restarted.knowledge, {});
  assert.equal(restarted.variables.tested, false);
});

test("local server exposes only player output and refuses author files and traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "world-server-"));
  await exportGame(worldFixture(), directory);
  await writeFile(join(directory, "world.json"), "AUTHOR CANON SECRET");
  const server = await serveGame(directory, { port: 0 });
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok((await page.text()).includes('lang="ja"'));
    const runtime = await fetch(`${base}/runtime.js`);
    assert.equal(runtime.status, 200);
    assert.equal(runtime.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal((await fetch(`${base}/world.json`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/world.json`)).status, 404);
    const head = await fetch(`${base}/game.json`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(`${base}/game.json`, { method: "POST" })).status, 405);
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    await rm(directory, { recursive: true, force: true });
  }
});
