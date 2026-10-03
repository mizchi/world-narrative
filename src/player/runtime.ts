import type { Action, Condition, Effect, Finding, Fragment, GameArtifact, GameState, ReachabilityReport, Scalar, Variable } from "../world/types.ts";

/** Pure runtime: this module has no value imports and is shared with the static player. */
class RuntimeError extends Error {
  readonly code: string;
  readonly relatedIds: string[];
  constructor(code: string, message: string, relatedIds: string[] = []) {
    super(message);
    this.code = code;
    this.relatedIds = relatedIds;
  }
}

function copyState(state: GameState): GameState {
  return { ...state, variables: { ...state.variables }, knowledge: { ...state.knowledge }, completedActions: [...state.completedActions], log: [...state.log] };
}

function validValue(variable: Variable, value: Scalar): boolean {
  switch (variable.kind) {
    case "number": return typeof value === "number" && Number.isInteger(value) && value >= variable.minimum && value <= variable.maximum;
    case "boolean": return typeof value === "boolean";
    case "enum": return typeof value === "string" && variable.values.includes(value);
  }
}

export function initialState(game: GameArtifact): GameState {
  for (const variable of game.game.variables) {
    if (!validValue(variable, variable.initial)) throw new RuntimeError("variable.invalid", `変数 ${variable.id} の初期値が不正です。`, [variable.id]);
  }
  if (!Number.isInteger(game.game.deadlineHours) || game.game.deadlineHours < 0) throw new RuntimeError("time.invalid", "締切は0以上の整数時間で指定してください。");
  return {
    locationId: game.game.startLocationId, elapsedHours: 0,
    variables: Object.fromEntries(game.game.variables.map(variable => [variable.id, variable.initial])),
    knowledge: {}, completedActions: [], log: ["探索を始めた。灰潮の到来までに、できることを選ぶ。"], ended: false,
  };
}

export function evaluate(condition: Condition, state: GameState): boolean {
  switch (condition.op) {
    case "true": return true;
    case "all": return condition.conditions.every(child => evaluate(child, state));
    case "any": return condition.conditions.some(child => evaluate(child, state));
    case "not": return !evaluate(condition.condition, state);
    case "eq": return Object.hasOwn(state.variables, condition.variable) && state.variables[condition.variable] === condition.value;
    case "gte": return typeof state.variables[condition.variable] === "number" && Number(state.variables[condition.variable]) >= condition.value;
    case "lte": return typeof state.variables[condition.variable] === "number" && Number(state.variables[condition.variable]) <= condition.value;
    case "knows": return Object.hasOwn(state.knowledge, condition.claimId) && state.knowledge[condition.claimId] === "known";
  }
}

function isRevealed(game: GameArtifact, state: GameState, claimId: string): boolean {
  return game.revealRules.filter(rule => rule.claimId === claimId).every(rule => evaluate(rule.condition, state));
}

function assertOpen(state: GameState): void {
  if (state.ended) throw new RuntimeError("game.ended", "探索は終了しています。もう一度始めるにはリセットしてください。");
}

function advanceTime(game: GameArtifact, state: GameState, hours: number): void {
  if (!Number.isInteger(hours) || hours < 0) throw new RuntimeError("time.invalid", "所要時間は0以上の整数で指定してください。");
  if (state.elapsedHours + hours > game.game.deadlineHours) throw new RuntimeError("time.deadline", "灰潮の締切までに間に合いません。");
  state.elapsedHours += hours;
}

function applyEffects(game: GameArtifact, state: GameState, effects: Effect[]): void {
  for (const effect of effects) {
    if (effect.kind === "learn") continue;
    const variable = game.game.variables.find(candidate => candidate.id === effect.variable);
    if (!variable) throw new RuntimeError("variable.unknown", `変数 ${effect.variable} が見つかりません。`, [effect.variable]);
    let value: Scalar;
    if (effect.kind === "add") {
      const previous = state.variables[effect.variable];
      if (variable.kind !== "number" || typeof previous !== "number" || !Number.isInteger(effect.amount)) throw new RuntimeError("variable.invalid", `変数 ${effect.variable} の加算値が不正です。`, [effect.variable]);
      value = previous + effect.amount;
    } else value = effect.value;
    if (!validValue(variable, value)) throw new RuntimeError("resource.bounds", `変数 ${effect.variable} の値が許可された範囲を超えます。`, [effect.variable]);
    Object.defineProperty(state.variables, effect.variable, { value, configurable: true, writable: true, enumerable: true });
  }
  // Reveal conditions use the completed, atomic variable update. Knowledge effects
  // are committed together, so their order cannot grant permission to themselves.
  for (const effect of effects) {
    if (effect.kind !== "learn") continue;
    if (!isRevealed(game, state, effect.claimId)) throw new RuntimeError("secret.early-learn", `命題 ${effect.claimId} の開示条件を満たしていません。`, [effect.claimId]);
  }
  for (const effect of effects) {
    if (effect.kind !== "learn") continue;
    const previous = state.knowledge[effect.claimId];
    const value = previous === "known" ? previous : effect.mode;
    Object.defineProperty(state.knowledge, effect.claimId, { value, configurable: true, writable: true, enumerable: true });
  }
}

function execute(game: GameArtifact, state: GameState, action: Action): GameState {
  assertOpen(state);
  if (state.completedActions.includes(action.id)) throw new RuntimeError("action.completed", "この行動は実行済みです。", [action.id]);
  if (!evaluate(action.condition, state)) throw new RuntimeError("action.condition", "この行動の条件を満たしていません。", [action.id]);
  const next = copyState(state);
  advanceTime(game, next, action.costHours);
  applyEffects(game, next, action.effects);
  next.completedActions.push(action.id);
  next.log.push(`${action.label}（${action.costHours}時間）${action.text ? ` — ${action.text}` : ""}`);
  return next;
}

export function availableActions(game: GameArtifact, state: GameState): Action[] {
  if (state.ended) return [];
  return game.episodes.filter(episode => episode.locationId === state.locationId).flatMap(episode => episode.actions).filter(action => {
    try { execute(game, state, action); return true; } catch { return false; }
  });
}

export function travel(game: GameArtifact, state: GameState, to: string): GameState {
  assertOpen(state);
  const routes = game.game.routes.filter(candidate => candidate.from === state.locationId && candidate.to === to);
  if (!routes.length) throw new RuntimeError("route.missing", "現在地からそこへ向かう経路はありません。", [state.locationId, to]);
  const route = routes.reduce((shortest, candidate) => candidate.hours < shortest.hours ? candidate : shortest);
  const next = copyState(state);
  advanceTime(game, next, route.hours);
  next.locationId = to;
  const description = game.game.locations.find(location => location.entityId === to)?.description;
  const label = description?.split(/[。\n]/)[0] || to;
  next.log.push(`${label}へ移動した（${route.hours}時間）。`);
  return next;
}

export function act(game: GameArtifact, state: GameState, actionId: string): GameState {
  assertOpen(state);
  const action = game.episodes.filter(episode => episode.locationId === state.locationId).flatMap(episode => episode.actions).find(candidate => candidate.id === actionId);
  if (!action) throw new RuntimeError("action.missing", "現在地にその行動はありません。", [actionId]);
  return execute(game, state, action);
}

export function visibleFragments(game: GameArtifact, state: GameState): Fragment[] {
  const fragments = game.episodes.filter(episode => episode.locationId === state.locationId).flatMap(episode => [...episode.intro, ...episode.fragments]);
  if (state.ended) fragments.push(...game.game.endings);
  return fragments.filter(fragment => evaluate(fragment.condition, state) && fragment.disclosedClaimIds.every(claimId => isRevealed(game, state, claimId)));
}

export function finish(game: GameArtifact, state: GameState): GameState {
  if (state.ended) return copyState(state);
  const next = copyState(state);
  next.ended = true;
  next.elapsedHours = game.game.deadlineHours;
  next.log.push("灰潮が到来した。探索を終える。");
  next.log.push(...game.game.endings.filter(fragment => evaluate(fragment.condition, next) && fragment.disclosedClaimIds.every(claimId => isRevealed(game, next, claimId))).map(fragment => fragment.text));
  return next;
}

function stateKey(state: GameState): string {
  return JSON.stringify([state.locationId, state.elapsedHours, Object.entries(state.variables).sort(([a], [b]) => a.localeCompare(b)), Object.entries(state.knowledge).sort(([a], [b]) => a.localeCompare(b)), [...state.completedActions].sort(), state.ended]);
}

/** Explore finite action histories and bounded travel times; logs are not state identity. */
export function checkReachability(game: GameArtifact, limit = 100000): ReachabilityReport {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("到達性の上限は1以上の整数で指定してください。");
  const start = initialState(game);
  const queue: GameState[] = [start];
  const discovered = new Set([stateKey(start)]);
  const actions = new Set<string>();
  const episodes = new Set<string>();
  const terminals = new Set<string>();
  const findings = new Map<string, Finding>();
  let visited = 0;
  const addFinding = (finding: Finding): void => { findings.set(JSON.stringify([finding.code, finding.path, finding.relatedIds]), finding); };
  const enqueue = (state: GameState): void => {
    const key = stateKey(state);
    if (discovered.has(key)) return;
    discovered.add(key);
    queue.push(state);
  };
  const inspectFragment = (fragment: Fragment, state: GameState, path: string): void => {
    if (!evaluate(fragment.condition, state)) return;
    const hidden = fragment.disclosedClaimIds.filter(claimId => !isRevealed(game, state, claimId));
    if (hidden.length) addFinding({ code: "secret.early-fragment", severity: "error", path, message: "断片の表示条件が秘密の開示条件より早く成立します。", relatedIds: [fragment.id, ...hidden] });
  };
  while (visited < queue.length && visited < limit) {
    const state = queue[visited++]!;
    const ended = finish(game, state);
    terminals.add(stateKey(ended));
    game.game.endings.forEach((fragment, index) => inspectFragment(fragment, ended, `game.endings[${index}]`));
    game.episodes.forEach((episode, episodeIndex) => {
      if (episode.locationId !== state.locationId) return;
      if (evaluate(episode.completion, state)) episodes.add(episode.id);
      episode.intro.forEach((fragment, index) => inspectFragment(fragment, state, `episodes[${episodeIndex}].intro[${index}]`));
      episode.fragments.forEach((fragment, index) => inspectFragment(fragment, state, `episodes[${episodeIndex}].fragments[${index}]`));
      episode.actions.forEach((action, index) => {
        if (state.completedActions.includes(action.id) || !evaluate(action.condition, state)) return;
        try {
          const next = execute(game, state, action);
          actions.add(action.id);
          enqueue(next);
        } catch (error) {
          if (!(error instanceof RuntimeError) || ["time.deadline", "action.condition", "action.completed", "resource.bounds"].includes(error.code)) return;
          addFinding({ code: error.code, severity: "error", path: `episodes[${episodeIndex}].actions[${index}]`, message: error.message, relatedIds: [action.id, ...error.relatedIds] });
        }
      });
    });
    for (const route of game.game.routes.filter(candidate => candidate.from === state.locationId)) {
      try { enqueue(travel(game, state, route.to)); } catch (error) {
        if (error instanceof RuntimeError && error.code !== "time.deadline") addFinding({ code: error.code, severity: "error", path: "game.routes", message: error.message, relatedIds: [route.from, route.to] });
      }
    }
  }
  const truncated = visited < queue.length;
  if (truncated) addFinding({ code: "reachability.limit", severity: "review", path: "game", message: `状態数の上限 ${limit} に達しました。未到達の内容が到達不能とは確定できません。`, relatedIds: [] });
  return {
    status: truncated ? "limit-reached" : "complete", visitedStates: visited,
    unreachableActions: game.episodes.flatMap(episode => episode.actions).filter(action => !actions.has(action.id)).map(action => action.id),
    unreachableEpisodes: game.episodes.filter(episode => !episodes.has(episode.id)).map(episode => episode.id),
    terminalStates: terminals.size, findings: [...findings.values()],
  };
}
