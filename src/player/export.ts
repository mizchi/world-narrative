import { mkdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import type { Action, Condition, Effect, Episode, Fragment, GameArtifact, Variable, World } from "../world/types.ts";
import { playerHtml, playerScript } from "./ui.ts";

function condition(value: Condition): Condition {
  switch (value.op) {
    case "true": return { op: "true" };
    case "all": case "any": return { op: value.op, conditions: value.conditions.map(condition) };
    case "not": return { op: "not", condition: condition(value.condition) };
    case "eq": return { op: "eq", variable: value.variable, value: value.value };
    case "gte": case "lte": return { op: value.op, variable: value.variable, value: value.value };
    case "knows": return { op: "knows", claimId: value.claimId };
  }
}

function effect(value: Effect): Effect {
  switch (value.kind) {
    case "set": return { kind: "set", variable: value.variable, value: value.value };
    case "add": return { kind: "add", variable: value.variable, amount: value.amount };
    case "learn": return { kind: "learn", claimId: value.claimId, mode: value.mode };
  }
}

function fragment(value: Fragment): Fragment {
  return { id: value.id, condition: condition(value.condition), text: value.text, disclosedClaimIds: [...value.disclosedClaimIds] };
}

function action(value: Action): Action {
  return { id: value.id, label: value.label, text: value.text, condition: condition(value.condition), costHours: value.costHours, effects: value.effects.map(effect) };
}

function episode(value: Episode): Episode {
  return { id: value.id, title: value.title, locationId: value.locationId, participants: [...value.participants], intro: value.intro.map(fragment), actions: value.actions.map(action), fragments: value.fragments.map(fragment), completion: condition(value.completion) };
}

function variable(value: Variable): Variable {
  switch (value.kind) {
    case "number": return { id: value.id, kind: "number", initial: value.initial, minimum: value.minimum, maximum: value.maximum };
    case "boolean": return { id: value.id, kind: "boolean", initial: value.initial };
    case "enum": return { id: value.id, kind: "enum", initial: value.initial, values: [...value.values] };
  }
}

/** Explicit projection prevents author fields and unknown properties entering game.json. */
export function toGameArtifact(world: World): GameArtifact {
  return {
    formatVersion: world.formatVersion, worldId: world.id, revision: world.revision, title: world.title, promise: world.contract.promise,
    game: {
      startLocationId: world.game.startLocationId, deadlineHours: world.game.deadlineHours,
      variables: world.game.variables.map(variable),
      locations: world.game.locations.map(location => {
        // The game's explicit location reference permits its public place name,
        // while the author's Entity.description remains excluded.
        const name = world.entities.find(entity => entity.id === location.entityId && entity.kind === "place")?.name;
        return { entityId: location.entityId, description: name ? `${name}\n${location.description}` : location.description };
      }),
      routes: world.game.routes.map(route => ({ from: route.from, to: route.to, hours: route.hours })),
      endings: world.game.endings.map(fragment),
    },
    episodes: world.episodes.map(episode),
    // Rule prose belongs to the author. Only the mechanical disclosure gate is public.
    revealRules: world.rules.filter(rule => rule.kind === "reveal").map(rule => ({ id: rule.id, kind: "reveal", claimId: rule.claimId, condition: condition(rule.condition), text: "" })),
  };
}

export async function exportGame(world: World, directory: string): Promise<void> {
  const game = toGameArtifact(world);
  const runtimeSource = await readFile(new URL("./runtime.ts", import.meta.url), "utf8");
  // TypeScript 7 supplies the native typechecker but no transpileModule API.
  // Node 24 strips the same pure module used by the CLI into browser ESM.
  const runtime = stripTypeScriptTypes(runtimeSource, { mode: "strip", sourceUrl: "runtime.ts" });
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "game.json"), `${JSON.stringify(game, null, 2)}\n`, "utf8"),
    writeFile(join(directory, "index.html"), playerHtml, "utf8"),
    writeFile(join(directory, "player.js"), playerScript, "utf8"),
    writeFile(join(directory, "runtime.js"), runtime, "utf8"),
  ]);
}
