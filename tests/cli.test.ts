import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { semanticInputHash } from "../src/world/semantic.ts";
import { parseWorld, parseProposal } from "../src/world/schema.ts";
import type { Proposal } from "../src/world/types.ts";
const exec = promisify(execFile);
const cli = resolve("src/cli.ts");
async function run(...args: string[]) { return JSON.parse((await exec(process.execPath, [cli, ...args])).stdout); }

test("demo creates a revisioned project, exports only player data, and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narrative-cli-"));
  const project = join(dir, "project"), out = join(dir, "game");
  try {
    const result = await run("demo", "--project", project, "--out", out);
    assert.equal(result.validation.status, "valid");
    assert.equal(result.reachability.status, "complete");
    assert.deepEqual(result.reachability.unreachableActions, []);
    const inspected = await run("inspect", project);
    assert.equal(inspected.episodes, 2);
    assert.equal(inspected.history.length, 2);
    const again = await run("demo", "--project", project, "--out", out);
    assert.equal(again.revision, result.revision);
    const game = JSON.parse(await readFile(join(out, "game.json"), "utf8"));
    assert.equal(game.claims, undefined);
    assert.equal(game.assertions, undefined);
    assert.equal(game.openQuestions, undefined);
    assert.equal(game.episodes.length, 2);
    const play = await run("play", project, "--steps", "travel:place.quarry");
    assert.equal(play.state.elapsedHours, 12);
    assert.equal(play.state.locationId, "place.quarry");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("stale proposals need explicit rebase; apply requires an editorial decision", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narrative-apply-"));
  try {
    const project = join(dir, "project");
    await run("init", project, "--world", "examples/ash-estuary/world.json");
    await assert.rejects(run("apply", project, "examples/ash-estuary/tide.proposal.json"));
    const wrongReview = join(dir, "wrong-review.json");
    await writeFile(wrongReview, JSON.stringify({ formatVersion: "jev-review/v1", status: "clear", rubric: "world-diff/v1", worldRevision: "ash-v0.1", inputHash: "invented" }));
    await assert.rejects(run("apply", project, "examples/ash-estuary/tide.proposal.json", "--author", "test", "--reason", "test", "--review", wrongReview), /does not match/);
    const world = parseWorld(JSON.parse(await readFile("examples/ash-estuary/world.json", "utf8")));
    const proposal = parseProposal(JSON.parse(await readFile("examples/ash-estuary/tide.proposal.json", "utf8")));
    const boundReview = join(dir, "bound-review.json");
    await writeFile(boundReview, JSON.stringify({ formatVersion: "jev-review/v1", status: "clear", rubric: "world-diff/v1", worldRevision: world.revision, inputHash: semanticInputHash(world, proposal) }));
    const adopted = await run("apply", project, "examples/ash-estuary/tide.proposal.json", "--author", "test", "--reason", "test local episode", "--review", boundReview);
    assert.equal(adopted.semanticReview, "clear-bound-report");
    await assert.rejects(run("apply", project, "examples/ash-estuary/quarry.proposal.json", "--author", "test", "--reason", "unrebased"));
    const rebased = join(dir, "rebased.json");
    await run("rebase", project, "examples/ash-estuary/quarry.proposal.json", "--out", rebased);
    await run("apply", project, rebased, "--author", "test", "--reason", "reviewed second episode");
    assert.equal((await run("inspect", project)).episodes, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("unavailable semantic API produces needs-review and a non-success exit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narrative-offline-"));
  try {
    const project = join(dir, "project");
    await run("init", project, "--world", "examples/ash-estuary/world.json");
    const env = { ...process.env, TYPESAFE_API_KEY: "", TYPESAFEAI_API_KEY: "" };
    try {
      await exec(process.execPath, [cli, "review", project, "examples/ash-estuary/tide.proposal.json"], { env });
      assert.fail("must not approve without a functioning API");
    } catch (error) {
      const result = JSON.parse((error as { stdout: string }).stdout);
      assert.equal(result.status, "needs-review");
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rebase refuses a subject whose author truth changed even when the subject entity was retained", async () => {
  const dir = await mkdtemp(join(tmpdir(), "narrative-dependency-"));
  try {
    const project = join(dir, "project");
    await run("init", project, "--world", "examples/ash-estuary/world.json");
    const first: Proposal = {
      formatVersion: "world-narrative/v1", id: "change.proposal", namespace: "change", basedOnRevision: "ash-v0.1",
      readSet: ["place.harbor", "fact.description"], writeSet: ["change.claim", "change.assertion"], notes: "New harbor fact",
      operations: [
        { kind: "addClaim", claim: { id: "change.claim", subjectId: "place.harbor", predicateId: "fact.description", value: { kind: "text", value: "The harbor has a newly staffed archive." }, text: "The harbor has a newly staffed archive.", scope: { branchId: "main", conditionId: "always", time: "atemporal" } } },
        { kind: "addAssertion", assertion: { id: "change.assertion", claimId: "change.claim", layer: { kind: "authorTruth", polarity: "assert" }, status: "proposed", source: { artifactId: "external:editor", authorId: "external:editor", locator: "1" } } },
      ],
    };
    const dependent: Proposal = {
      formatVersion: "world-narrative/v1", id: "writer.proposal", namespace: "writer", basedOnRevision: "ash-v0.1",
      readSet: ["place.harbor"], writeSet: ["writer.person"], notes: "Written using the harbor facts before the archive was added",
      operations: [{ kind: "addEntity", entity: { id: "writer.person", kind: "person", name: "Visitor", description: "A harbor visitor", gameRole: "background" } }],
    };
    const firstFile = join(dir, "first.json"), secondFile = join(dir, "second.json");
    await writeFile(firstFile, JSON.stringify(first));
    await writeFile(secondFile, JSON.stringify(dependent));
    await run("apply", project, firstFile, "--author", "test", "--reason", "adopt new harbor fact");
    await assert.rejects(run("rebase", project, secondFile), /read dependencies/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
