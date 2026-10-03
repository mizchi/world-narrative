import { ZodError } from "zod";
import { parseWorld } from "./schema.ts";
import type { Assertion, Claim, Condition, Effect, Finding, Fragment, Predicate, Scalar, Value, Variable, World, ValidationReport } from "./types.ts";

function valueKey(value: Value): string {
  switch (value.kind) {
    case "entity": return JSON.stringify([value.kind, value.entityId]);
    case "quantity": return JSON.stringify([value.kind, value.value, value.unit]);
    default: return JSON.stringify([value.kind, value.value]);
  }
}
function timeOverlaps(a: Claim, b: Claim): boolean {
  if (a.scope.time === "atemporal" || b.scope.time === "atemporal") return true;
  return a.scope.time.start < b.scope.time.endExclusive && b.scope.time.start < a.scope.time.endExclusive;
}
function scalarFits(variable: Variable, value: Scalar): boolean {
  switch (variable.kind) {
    case "boolean": return typeof value === "boolean";
    case "enum": return typeof value === "string" && variable.values.includes(value);
    case "number": return typeof value === "number" && Number.isSafeInteger(value) && value >= variable.minimum && value <= variable.maximum;
  }
}
type SymbolicState = { values: Record<string, Scalar>; known: Set<string> };
function evaluate(condition: Condition, state: SymbolicState): boolean {
  switch (condition.op) {
    case "true": return true;
    case "all": return condition.conditions.every(c => evaluate(c, state));
    case "any": return condition.conditions.some(c => evaluate(c, state));
    case "not": return !evaluate(condition.condition, state);
    case "knows": return state.known.has(condition.claimId);
    case "eq": return state.values[condition.variable] === condition.value;
    case "gte": { const value = state.values[condition.variable]; return typeof value === "number" && value >= condition.value; }
    case "lte": { const value = state.values[condition.variable]; return typeof value === "number" && value <= condition.value; }
  }
}
function conditionAtoms(condition: Condition, variables: Map<string, number[]>, knowledge: Set<string>): void {
  switch (condition.op) {
    case "all": case "any": condition.conditions.forEach(c => conditionAtoms(c, variables, knowledge)); break;
    case "not": conditionAtoms(condition.condition, variables, knowledge); break;
    case "knows": knowledge.add(condition.claimId); break;
    case "eq": case "gte": case "lte": {
      const thresholds = variables.get(condition.variable) ?? [];
      if (typeof condition.value === "number") thresholds.push(condition.value);
      variables.set(condition.variable, thresholds);
      break;
    }
    case "true": break;
  }
}

/** Finite boolean/enum domains and numeric comparison boundaries make this exact for the MVP DSL. */
function implies(condition: Condition, requirement: Condition, variables: Map<string, Variable>, prefix: Effect[]): boolean | "unknown" {
  const atoms = new Map<string, number[]>();
  const knowledge = new Set<string>();
  conditionAtoms(condition, atoms, knowledge);
  conditionAtoms(requirement, atoms, knowledge);
  const offsets = new Map<string, number[]>();
  for (const effect of prefix) {
    if (effect.kind === "add") {
      const steps = offsets.get(effect.variable) ?? [];
      const offset = (steps.at(-1) ?? 0) + effect.amount;
      steps.push(offset);
      offsets.set(effect.variable, steps);
      if (!atoms.has(effect.variable)) atoms.set(effect.variable, []);
    } else if (effect.kind === "set" && !atoms.has(effect.variable)) atoms.set(effect.variable, []);
  }
  const dimensions: { id: string; values: Scalar[]; knowledge: boolean }[] = [];
  let combinations = 1;
  for (const [id, thresholds] of atoms) {
    const variable = variables.get(id);
    if (!variable) return "unknown";
    let values: Scalar[];
    if (variable.kind === "boolean") values = [false, true];
    else if (variable.kind === "enum") values = variable.values;
    else {
      const samples = new Set([variable.minimum, variable.maximum, variable.initial]);
      for (const threshold of [...thresholds, variable.minimum, variable.maximum]) {
        for (const shift of [0, ...(offsets.get(id) ?? [])]) {
          const boundary = threshold - shift;
          for (const point of [Math.floor(boundary) - 1, Math.floor(boundary), Math.ceil(boundary), Math.ceil(boundary) + 1]) {
            if (point >= variable.minimum && point <= variable.maximum) samples.add(point);
          }
        }
      }
      values = [...samples];
    }
    combinations *= values.length;
    dimensions.push({ id, values, knowledge: false });
  }
  for (const id of knowledge) {
    combinations *= 2;
    dimensions.push({ id, values: [false, true], knowledge: true });
  }
  if (combinations > 8192) return "unknown";
  const state: SymbolicState = { values: {}, known: new Set() };
  function search(index: number): boolean {
    const dimension = dimensions[index];
    if (dimension) {
      for (const value of dimension.values) {
        if (dimension.knowledge) {
          if (value) state.known.add(dimension.id); else state.known.delete(dimension.id);
        } else state.values[dimension.id] = value;
        if (!search(index + 1)) return false;
      }
      return true;
    }
    if (!evaluate(condition, state)) return true;
    const after: SymbolicState = { values: { ...state.values }, known: new Set(state.known) };
    for (const effect of prefix) {
      if (effect.kind === "learn") { if (effect.mode === "known") after.known.add(effect.claimId); }
      else {
        const variable = variables.get(effect.variable);
        const previous = after.values[effect.variable];
        const value = effect.kind === "set" ? effect.value : typeof previous === "number" ? previous + effect.amount : undefined;
        if (!variable || value === undefined || !scalarFits(variable, value)) return true;
        after.values[effect.variable] = value;
      }
    }
    return evaluate(requirement, after);
  }
  return search(0);
}

export function validateWorld(input: World): ValidationReport {
  let world: World;
  try { world = parseWorld(input); }
  catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return { status: "invalid", findings: error.issues.map(issue => ({ code: "schema", severity: "error", path: issue.path.join("."), message: issue.message, relatedIds: [] })) };
  }
  const findings: Finding[] = [];
  const add = (code: string, path: string, message: string, relatedIds: string[] = [], severity: Finding["severity"] = "error") => { findings.push({ code, severity, path, message, relatedIds }); };
  const identifiers = new Map<string, string>();
  const unique = (id: string, path: string) => {
    const previous = identifiers.get(id);
    if (previous) add("duplicate-id", path, `ID ${id} duplicates ${previous}`, [id]);
    else identifiers.set(id, path);
  };
  for (const key of ["entities", "predicates", "claims", "assertions", "rules", "openQuestions", "episodes"] as const) world[key].forEach((item, i) => unique(item.id, `${key}.${i}.id`));
  world.game.variables.forEach((v, i) => unique(v.id, `game.variables.${i}.id`));
  for (const [i, episode] of world.episodes.entries()) {
    episode.actions.forEach((item, j) => unique(item.id, `episodes.${i}.actions.${j}.id`));
    for (const key of ["intro", "fragments"] as const) episode[key].forEach((item, j) => unique(item.id, `episodes.${i}.${key}.${j}.id`));
  }
  world.game.endings.forEach((item, i) => unique(item.id, `game.endings.${i}.id`));
  const entities = new Map(world.entities.map(item => [item.id, item]));
  const predicates = new Map(world.predicates.map(item => [item.id, item]));
  const claims = new Map(world.claims.map(item => [item.id, item]));
  const variables = new Map(world.game.variables.map(item => [item.id, item]));
  const ref = (collection: Map<string, unknown> | Set<string>, id: string, path: string) => {
    if (!collection.has(id)) add("unknown-reference", path, `Unknown reference ${id}`, [id]);
  };
  const checkPair = (subjectId: string, predicateId: string, path: string): Predicate | undefined => {
    ref(entities, subjectId, `${path}.subjectId`); ref(predicates, predicateId, `${path}.predicateId`);
    const subject = entities.get(subjectId); const predicate = predicates.get(predicateId);
    if (subject && predicate && !predicate.subjectKinds.includes(subject.kind)) add("subject-kind", path, `${predicateId} cannot describe ${subject.kind}`, [subjectId, predicateId]);
    return predicate;
  };
  const checkValue = (value: Value, predicate: Predicate | undefined, path: string) => {
    if (value.kind === "entity") ref(entities, value.entityId, `${path}.entityId`);
    if (predicate && predicate.valueKind !== value.kind) add("value-kind", path, `Expected ${predicate.valueKind}, got ${value.kind}`, [predicate.id]);
    if (value.kind === "quantity" && predicate && value.unit !== predicate.unit) add("quantity-unit", path, `Expected unit ${predicate.unit ?? "(undefined)"}, got ${value.unit}`, [predicate.id]);
  };
  for (const [i, predicate] of world.predicates.entries()) {
    if (predicate.subjectKinds.length === 0 || new Set(predicate.subjectKinds).size !== predicate.subjectKinds.length) add("predicate-subject-kinds", `predicates.${i}`, "Subject kinds must be nonempty and unique", [predicate.id]);
    if ((predicate.valueKind === "quantity") !== (predicate.unit !== undefined)) add("predicate-unit", `predicates.${i}`, "A unit is required only for quantity predicates", [predicate.id]);
  }
  if (world.contract.branches.length === 0 || new Set(world.contract.branches).size !== world.contract.branches.length) add("branch-list", "contract.branches", "Branches must be nonempty and unique");
  for (const [i, claim] of world.claims.entries()) {
    const path = `claims.${i}`;
    checkValue(claim.value, checkPair(claim.subjectId, claim.predicateId, path), `${path}.value`);
    if (!world.contract.branches.includes(claim.scope.branchId)) add("unknown-branch", `${path}.scope.branchId`, `Unknown branch ${claim.scope.branchId}`, [claim.id]);
    if (claim.scope.time !== "atemporal" && claim.scope.time.start >= claim.scope.time.endExclusive) add("invalid-time-range", `${path}.scope.time`, "Time range must have start < endExclusive", [claim.id]);
    if (claim.scope.conditionId !== "always") add("unsupported-scope-condition", `${path}.scope.conditionId`, "MVP supports only the always scope condition", [claim.id], "review");
  }
  for (const [i, assertion] of world.assertions.entries()) {
    ref(claims, assertion.claimId, `assertions.${i}.claimId`);
    // Provenance defaults to local Entity IDs. Explicit external: IDs name
    // artifacts or authors outside this world and cannot be graph-validated.
    for (const key of ["artifactId", "authorId"] as const) {
      const id = assertion.source[key];
      if (id.startsWith("external:")) {
        if (!id.slice("external:".length).trim()) add("invalid-external-reference", `assertions.${i}.source.${key}`, "External provenance must contain an identifier", [assertion.id]);
      } else ref(entities, id, `assertions.${i}.source.${key}`);
    }
    if (assertion.layer.kind === "belief") ref(entities, assertion.layer.holderId, `assertions.${i}.layer.holderId`);
    if (assertion.layer.kind === "record") ref(entities, assertion.layer.documentId, `assertions.${i}.layer.documentId`);
    if (assertion.layer.kind === "hypothesis") ref(entities, assertion.layer.proposedById, `assertions.${i}.layer.proposedById`);
  }
  const truth = world.assertions.filter((a): a is Assertion & { layer: Extract<Assertion["layer"], { kind: "authorTruth" }> } => a.status !== "superseded" && a.layer.kind === "authorTruth");
  for (let i = 0; i < truth.length; i++) {
    const a = truth[i]!; const first = claims.get(a.claimId);
    if (!first) continue;
    for (let j = i + 1; j < truth.length; j++) {
      const b = truth[j]!; const second = claims.get(b.claimId);
      if (!second || first.subjectId !== second.subjectId || first.predicateId !== second.predicateId || first.scope.branchId !== second.scope.branchId || !timeOverlaps(first, second)) continue;
      const same = valueKey(first.value) === valueKey(second.value);
      const polarityConflict = same && a.layer.polarity !== b.layer.polarity;
      const valueConflict = !same && a.layer.polarity === "assert" && b.layer.polarity === "assert" && predicates.get(first.predicateId)?.cardinality === "one";
      if (!polarityConflict && !valueConflict) continue;
      if (first.scope.conditionId !== "always" || second.scope.conditionId !== "always") add("scope-overlap-unknown", "assertions", "Cannot prove scope overlap for unsupported conditions", [a.id, b.id], "review");
      else add(polarityConflict ? "truth-polarity-conflict" : "truth-value-conflict", "assertions", "Overlapping author truths conflict", [a.id, b.id, first.id, second.id]);
    }
  }
  for (const [i, variable] of world.game.variables.entries()) {
    if (variable.kind === "number" && (variable.minimum > variable.maximum || !scalarFits(variable, variable.initial))) add("variable-domain", `game.variables.${i}`, "Initial numeric value must lie within ordered bounds", [variable.id]);
    if (variable.kind === "enum" && (variable.values.length === 0 || new Set(variable.values).size !== variable.values.length || !variable.values.includes(variable.initial))) add("variable-domain", `game.variables.${i}`, "Enum domain must be unique, nonempty and contain its initial value", [variable.id]);
  }
  const checkCondition = (condition: Condition, path: string): void => {
    switch (condition.op) {
      case "true": break;
      case "all": case "any": condition.conditions.forEach((c, i) => checkCondition(c, `${path}.conditions.${i}`)); break;
      case "not": checkCondition(condition.condition, `${path}.condition`); break;
      case "knows": ref(claims, condition.claimId, `${path}.claimId`); break;
      case "eq": case "gte": case "lte": {
        ref(variables, condition.variable, `${path}.variable`);
        const variable = variables.get(condition.variable);
        if (variable && ((condition.op !== "eq" && variable.kind !== "number") || (condition.op === "eq" && !scalarFits(variable, condition.value)))) add("condition-type", path, "Comparison is incompatible with the variable domain", [condition.variable]);
        break;
      }
    }
  };
  for (const [i, rule] of world.rules.entries()) {
    if (rule.kind === "reveal") { ref(claims, rule.claimId, `rules.${i}.claimId`); checkCondition(rule.condition, `rules.${i}.condition`); }
    else {
      checkValue(rule.value, checkPair(rule.subjectId, rule.predicateId, `rules.${i}`), `rules.${i}.value`);
      for (const assertion of truth) {
        const claim = claims.get(assertion.claimId);
        if (claim && assertion.layer.polarity === "assert" && claim.subjectId === rule.subjectId && claim.predicateId === rule.predicateId && valueKey(claim.value) === valueKey(rule.value)) add("forbidden-truth", `rules.${i}`, "Author truth violates a forbidTruth rule", [rule.id, assertion.id]);
      }
    }
  }
  for (const [i, question] of world.openQuestions.entries()) {
    checkPair(question.subjectId, question.predicateId, `openQuestions.${i}`);
    for (const assertion of truth) {
      const claim = claims.get(assertion.claimId);
      if (assertion.status === "proposed" && claim?.subjectId === question.subjectId && claim.predicateId === question.predicateId) add("open-question", `openQuestions.${i}`, "A new author assertion resolves an open question and requires a decision", [question.id, assertion.id], "review");
    }
  }
  const checkDisclosure = (claimId: string, condition: Condition, path: string, prefix: Effect[] = []) => {
    ref(claims, claimId, path);
    for (const rule of world.rules) {
      if (rule.kind !== "reveal" || rule.claimId !== claimId) continue;
      const implication = implies(condition, rule.condition, variables, prefix);
      if (implication === false) add("early-disclosure", path, "Disclosure condition does not enforce the reveal rule", [claimId, rule.id]);
      if (implication === "unknown") add("disclosure-undetermined", path, "Reveal implication exceeds the supported finite proof", [claimId, rule.id], "review");
    }
  };
  const checkFragment = (fragment: Fragment, path: string) => {
    checkCondition(fragment.condition, `${path}.condition`);
    if (new Set(fragment.disclosedClaimIds).size !== fragment.disclosedClaimIds.length) add("duplicate-reference", `${path}.disclosedClaimIds`, "Disclosed claim IDs must be unique", [fragment.id]);
    fragment.disclosedClaimIds.forEach((id, i) => checkDisclosure(id, fragment.condition, `${path}.disclosedClaimIds.${i}`));
  };
  const locations = new Set<string>();
  world.game.locations.forEach((location, i) => {
    ref(entities, location.entityId, `game.locations.${i}.entityId`);
    if (entities.get(location.entityId)?.kind !== "place" && entities.has(location.entityId)) add("location-kind", `game.locations.${i}`, "A game location must be a place", [location.entityId]);
    if (locations.has(location.entityId)) add("duplicate-location", `game.locations.${i}`, "Duplicate game location", [location.entityId]);
    locations.add(location.entityId);
  });
  ref(locations, world.game.startLocationId, "game.startLocationId");
  const routes = new Set<string>();
  world.game.routes.forEach((route, i) => {
    ref(locations, route.from, `game.routes.${i}.from`); ref(locations, route.to, `game.routes.${i}.to`);
    const key = JSON.stringify([route.from, route.to]);
    if (routes.has(key)) add("duplicate-route", `game.routes.${i}`, "Duplicate directed route", [route.from, route.to]);
    if (route.from === route.to) add("route-self", `game.routes.${i}`, "A route must connect distinct locations", [route.from]);
    routes.add(key);
  });
  for (const [i, episode] of world.episodes.entries()) {
    const path = `episodes.${i}`;
    ref(locations, episode.locationId, `${path}.locationId`);
    episode.participants.forEach((id, j) => ref(entities, id, `${path}.participants.${j}`));
    if (new Set(episode.participants).size !== episode.participants.length) add("duplicate-reference", `${path}.participants`, "Participants must be unique", [episode.id]);
    checkCondition(episode.completion, `${path}.completion`);
    for (const key of ["intro", "fragments"] as const) episode[key].forEach((fragment, j) => checkFragment(fragment, `${path}.${key}.${j}`));
    episode.actions.forEach((action, j) => {
      const actionPath = `${path}.actions.${j}`;
      checkCondition(action.condition, `${actionPath}.condition`);
      if (action.costHours > world.game.deadlineHours) add("action-time", actionPath, "Action cost exceeds the whole game deadline", [action.id]);
      action.effects.forEach((effect, k) => {
        const effectPath = `${actionPath}.effects.${k}`;
        if (effect.kind === "learn") {
          // Runtime applies every variable effect before checking any learn;
          // knowledge acquired in this action cannot authorize another learn.
          checkDisclosure(effect.claimId, action.condition, effectPath, action.effects.filter(e => e.kind !== "learn"));
          if (effect.mode === "known" && !truth.some(a => a.claimId === effect.claimId && a.layer.polarity === "assert")) add("knowledge-not-truth", effectPath, "Known learning requires affirmative author truth", [effect.claimId]);
        } else {
          ref(variables, effect.variable, `${effectPath}.variable`);
          const variable = variables.get(effect.variable);
          if (effect.kind === "add" && variable && variable.kind !== "number") add("effect-type", effectPath, "Only numeric variables support add", [effect.variable]);
          if (effect.kind === "set" && variable && !scalarFits(variable, effect.value)) add("effect-value", effectPath, "Set value is outside the variable domain", [effect.variable]);
          if (effect.kind === "add" && variable?.kind === "number" && Math.abs(effect.amount) > variable.maximum - variable.minimum) add("effect-value", effectPath, "Add amount cannot fit within the variable domain", [effect.variable]);
        }
      });
    });
  }
  world.game.endings.forEach((fragment, i) => checkFragment(fragment, `game.endings.${i}`));
  return { status: findings.some(f => f.severity === "error") ? "invalid" : findings.length ? "needs-review" : "valid", findings };
}
