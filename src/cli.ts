import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { parseWorld, parseProposal, jsonSchemas } from "./world/schema.ts";
import { validateWorld } from "./world/validate.ts";
import { previewProposal, commitProposal } from "./world/proposal.ts";
import { createProject, loadProject, saveProject } from "./world/store.ts";
import { reviewSemantics, semanticInputHash } from "./world/semantic.ts";
import { toGameArtifact, exportGame } from "./player/export.ts";
import { initialState, availableActions, travel, act, visibleFragments, finish, checkReachability } from "./player/runtime.ts";
import type { GameArtifact, GameState, Project, Proposal, World } from "./world/types.ts";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const knownFlags = new Set(["--world", "--out", "--author", "--reason", "--review", "--model", "--project", "--steps", "--interactive"]);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!;
  if (arg.startsWith("--")) {
    if (!knownFlags.has(arg)) throw new Error(`unknown option ${arg}`);
    if (arg === "--interactive") { flags.set(arg, "true"); continue; }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value ${arg}`);
    flags.set(arg, value);
  } else positional.push(arg);
}
const required = (value: string | undefined, label: string) => { if (!value) throw new Error(`${label} is required`); return value; };
const json = async (file: string | URL): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
async function output(value: unknown) {
  if (flags.has("--out")) await writeFile(flags.get("--out")!, JSON.stringify(value, null, 2));
  print(value);
}

function verify(world: World) {
  const validation = validateWorld(world);
  const reachability = checkReachability(toGameArtifact(world));
  const okay = validation.status === "valid" && reachability.status === "complete" && !reachability.unreachableActions.length && !reachability.unreachableEpisodes.length && !reachability.findings.length;
  return { validation, reachability, okay };
}
function requireValid(world: World): void {
  const report = verify(world);
  if (!report.okay) throw new Error(`world validation failed: ${JSON.stringify(report)}`);
}

/** Explicit rebase only after the proposal's read dependencies were not replaced. */
function rebase(project: Project, proposal: Proposal): Proposal {
  if (proposal.basedOnRevision === project.world.revision) return proposal;
  const index = project.history.findIndex(record => record.parent === proposal.basedOnRevision);
  if (index < 0) throw new Error("proposal base revision is not in this project's history");
  const changed = new Set<string>();
  const changedAssertion = (assertionId: string) => {
    const assertion = project.world.assertions.find(a => a.id === assertionId);
    if (!assertion) return;
    changed.add(assertion.claimId);
    if (assertion.layer.kind === "authorTruth") {
      const claim = project.world.claims.find(c => c.id === assertion.claimId);
      if (claim) changed.add(claim.subjectId);
    } else if (assertion.layer.kind === "belief") changed.add(assertion.layer.holderId);
    else if (assertion.layer.kind === "record") changed.add(assertion.layer.documentId);
    else changed.add(assertion.layer.proposedById);
  };
  for (const record of project.history.slice(index)) for (const op of record.proposal.operations) {
    if (op.kind === "supersedeAssertion") {
      changed.add(op.assertionId);
      changedAssertion(op.assertionId);
    } else if (op.kind === "addEntity") changed.add(op.entity.id);
    else if (op.kind === "addClaim") changed.add(op.claim.id);
    else if (op.kind === "addAssertion") {
      changed.add(op.assertion.id);
      changedAssertion(op.assertion.id);
    } else if (op.kind === "addEpisode") changed.add(op.episode.id);
  }
  const conflicts = proposal.readSet.filter(id => changed.has(id));
  if (conflicts.length) throw new Error(`rebase requires revised read dependencies: ${conflicts.join(", ")}`);
  const rebased = { ...proposal, basedOnRevision: project.world.revision };
  const preview = previewProposal(project.world, rebased);
  if (preview.report.status !== "valid") throw new Error(`rebase validation failed: ${JSON.stringify(preview.report)}`);
  return rebased;
}

async function apply(directory: string, proposal: Proposal, author: string, reason: string): Promise<Project> {
  const project = await loadProject(directory);
  const preview = previewProposal(project.world, proposal);
  if (preview.report.status !== "valid") throw new Error(`proposal validation failed: ${JSON.stringify(preview.report)}`);
  requireValid(preview.world);
  if (flags.has("--review")) {
    const review = await json(flags.get("--review")!) as { formatVersion?: unknown; status?: unknown; inputHash?: unknown; worldRevision?: unknown; rubric?: unknown };
    if (review.formatVersion !== "jev-review/v1" || review.status !== "clear" || review.rubric !== "world-diff/v1" || review.inputHash !== semanticInputHash(project.world, proposal) || review.worldRevision !== project.world.revision) throw new Error("semantic review is unresolved or does not match the current world and proposal");
  }
  const updated = commitProposal(project, proposal, { author, reason });
  await saveProject(directory, updated, project.world.revision);
  return updated;
}

function view(game: GameArtifact, state: GameState) {
  return {
    title: game.title, location: game.game.locations.find(l => l.entityId === state.locationId)?.description,
    remainingHours: game.game.deadlineHours - state.elapsedHours,
    fragments: visibleFragments(game, state).map(f => ({ id: f.id, text: f.text })),
    actions: availableActions(game, state).map(a => ({ id: a.id, label: a.label, costHours: a.costHours })),
    routes: state.ended ? [] : game.game.routes.filter(r => r.from === state.locationId && state.elapsedHours + r.hours <= game.game.deadlineHours),
  };
}
function step(game: GameArtifact, state: GameState, input: string): GameState {
  if (input === "finish") return finish(game, state);
  if (input.startsWith("travel:")) return travel(game, state, input.slice(7));
  if (input.startsWith("act:")) return act(game, state, input.slice(4));
  throw new Error(`unknown exploration step ${input}`);
}
async function interactive(game: GameArtifact, start: GameState): Promise<GameState> {
  const readline = createInterface({ input: stdin, output: stdout });
  let state = start;
  try {
    while (!state.ended) {
      const current = view(game, state);
      console.log(`\n${current.location}\n灰潮まで ${current.remainingHours} 時間`);
      for (const fragment of current.fragments) console.log(fragment.text);
      current.actions.forEach((a, i) => console.log(`${i + 1}: ${a.label}（${a.costHours}時間）`));
      current.routes.forEach((r, i) => console.log(`m${i + 1}: ${game.game.locations.find(l => l.entityId === r.to)?.description}へ（${r.hours}時間）`));
      const choice = (await readline.question("行動番号 / m移動番号 / end 灰潮を迎える / q 終了 > ")).trim();
      if (choice === "q") break;
      try {
        if (choice === "end") state = finish(game, state);
        else if (/^m\d+$/.test(choice)) state = travel(game, state, required(current.routes[Number(choice.slice(1)) - 1]?.to, "route"));
        else if (/^\d+$/.test(choice)) state = act(game, state, required(current.actions[Number(choice) - 1]?.id, "action"));
        else console.log("表示された番号を入力してください。");
      } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }
    }
    if (state.ended) for (const line of state.log) console.log(line);
    return state;
  } finally { readline.close(); }
}

async function main() {
  if (command === "help") {
    console.log(`world-narrative 制作CLI
init <project> --world <world.json>
inspect <project>
check <world.json>
preview <project> <proposal.json>
rebase <project> <proposal.json> --out <rebased.json>
review <project> <proposal.json> [--model jev-1.13.0] [--out <review.json>]
apply <project> <proposal.json> --author <name> --reason <reason> [--review <review.json>]
verify <project>
export <project> --out <directory>
play <project> [--interactive] [--steps travel:place.quarry,act:action.id,finish]
schema --out <directory>
demo [--project .tmp/demo-project] [--out .tmp/demo-game]`);
    return;
  }
  if (command === "schema") {
    const directory = required(flags.get("--out"), "--out");
    await mkdir(directory, { recursive: true });
    for (const [name, schema] of Object.entries(jsonSchemas())) await writeFile(join(directory, `${name}.schema.json`), JSON.stringify(schema, null, 2));
    print({ directory }); return;
  }
  if (command === "check") {
    const report = validateWorld(parseWorld(await json(required(positional[0], "world file"))));
    print(report); if (report.status !== "valid") process.exitCode = 2; return;
  }
  if (command === "demo") {
    const directory = flags.get("--project") ?? ".tmp/demo-project";
    const out = flags.get("--out") ?? ".tmp/demo-game";
    const seed = parseWorld(await json(new URL("../examples/ash-estuary/world.json", import.meta.url)));
    let project: Project;
    try { project = await loadProject(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      project = await createProject(directory, seed);
    }
    if (project.world.id !== seed.id) throw new Error("demo project directory contains a different world");
    for (const name of ["tide", "quarry"]) {
      let proposal = parseProposal(await json(new URL(`../examples/ash-estuary/${name}.proposal.json`, import.meta.url)));
      if (project.history.some(r => r.proposalId === proposal.id)) continue;
      proposal = rebase(project, proposal);
      project = await apply(directory, proposal, "demo-build", "採用済みMVPサンプルの再現");
    }
    const report = verify(project.world);
    if (!report.okay) throw new Error(`demo validation failed: ${JSON.stringify(report)}`);
    await exportGame(project.world, out);
    print({ project: directory, out, revision: project.world.revision, ...report }); return;
  }
  const directory = required(positional[0], "project directory");
  if (command === "init") {
    const world = parseWorld(await json(required(flags.get("--world"), "--world")));
    requireValid(world);
    const project = await createProject(directory, world);
    print({ project: directory, revision: project.world.revision }); return;
  }
  const project = await loadProject(directory);
  if (command === "inspect") {
    print({ id: project.world.id, title: project.world.title, revision: project.world.revision, entities: project.world.entities.length, claims: project.world.claims.length, episodes: project.world.episodes.length, history: project.history.map(({ proposalId, parent, id, decision }) => ({ proposalId, parent, id, decision })) }); return;
  }
  if (command === "verify") { const report = verify(project.world); print(report); if (!report.okay) process.exitCode = 2; return; }
  if (command === "export") {
    requireValid(project.world);
    const out = required(flags.get("--out"), "--out");
    await exportGame(project.world, out); print({ out, revision: project.world.revision }); return;
  }
  if (command === "play") {
    requireValid(project.world);
    const game = toGameArtifact(project.world);
    let state = initialState(game);
    for (const input of (flags.get("--steps") ?? "").split(",").filter(Boolean)) state = step(game, state, input);
    if (flags.has("--interactive") || (!flags.has("--steps") && stdin.isTTY)) { await interactive(game, state); return; }
    print({ state, view: view(game, state) }); return;
  }
  const proposal = parseProposal(await json(required(positional[1], "proposal file")));
  if (command === "preview") { const preview = previewProposal(project.world, proposal); print(preview.report); if (preview.report.status !== "valid") process.exitCode = 2; return; }
  if (command === "rebase") { await output(rebase(project, proposal)); return; }
  if (command === "review") {
    const preview = previewProposal(project.world, proposal);
    if (preview.report.status !== "valid") { print(preview.report); process.exitCode = 2; return; }
    const model = flags.get("--model");
    const report = await reviewSemantics(project.world, proposal, { cacheDirectory: join(directory, ".semantic-cache"), ...(model ? { model } : {}) });
    await output(report); if (report.status !== "clear") process.exitCode = 2; return;
  }
  if (command === "apply") {
    const author = required(flags.get("--author"), "--author"), reason = required(flags.get("--reason"), "--reason");
    const updated = await apply(directory, proposal, author, reason);
    print({ revision: updated.world.revision, proposalId: proposal.id, semanticReview: flags.has("--review") ? "clear-bound-report" : "editorial-decision" }); return;
  }
  throw new Error(`unknown command ${command}`);
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : "CLI failed"); process.exitCode = 1; }
