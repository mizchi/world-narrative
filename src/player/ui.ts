/** Fixed markup and script: game text enters the DOM only through textContent. */
export const playerHtml = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>世界を探索する</title>
<style>
:root { color-scheme: dark; --ink: #e5e0d6; --muted: #aca79c; --line: #454840; --paper: #202722; --accent: #c5b58b; }
* { box-sizing: border-box; }
body { margin: 0; background: #121916; color: var(--ink); font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; line-height: 1.9; }
main { width: min(880px, 100%); margin: 0 auto; padding: 44px 24px 64px; }
header { border-bottom: 1px solid var(--line); padding-bottom: 20px; margin-bottom: 24px; }
h1 { font-size: clamp(1.8rem, 5vw, 2.4rem); font-weight: 500; letter-spacing: .1em; margin: 0; }
h2 { font-size: 1.15rem; font-weight: 500; margin: 0 0 12px; color: var(--accent); }
p { margin: 8px 0 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
small, .muted { color: var(--muted); }
.status { display: flex; flex-wrap: wrap; gap: 10px 28px; background: var(--paper); padding: 16px 20px; border-left: 2px solid var(--accent); }
section { margin: 28px 0; }
button { font: inherit; font-family: system-ui, sans-serif; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 3px; padding: 10px 16px; text-align: left; cursor: pointer; }
button:hover { border-color: var(--accent); background: #2c352e; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
button:disabled { opacity: .4; cursor: default; }
.choices { display: grid; gap: 10px; }
.discovery { border-left: 1px solid var(--line); padding-left: 16px; }
ul { padding-left: 1.4em; }
footer { margin-top: 32px; border-top: 1px solid var(--line); padding-top: 20px; display: flex; flex-wrap: wrap; gap: 12px; }
#error { color: #edbdb0; }
#end-status { font-size: 1.1rem; color: var(--accent); }
@media (max-width: 540px) { main { padding: 28px 18px; } button { width: 100%; } }
</style>
</head>
<body>
<main>
<header><small>探索記録</small><h1 id="title">世界を探索する</h1><p id="promise" class="muted"></p></header>
<div class="status" role="status"><span>残り時間 <strong data-testid="remaining-hours" id="remaining">—</strong> 時間</span><span>経過 <strong data-testid="elapsed-hours" id="elapsed">0</strong> 時間</span><span data-testid="resources" id="resources"></span></div>
<p id="error" role="alert"></p>
<p id="end-status" data-testid="end-status" aria-live="polite"></p>
<section><h2>現在地</h2><p data-testid="current-location" id="location"></p><p id="description"></p></section>
<section><h2>発見</h2><div data-testid="discoveries" id="discoveries"></div><p id="knowledge" class="muted"></p></section>
<section><h2>ここでできること</h2><div id="actions" class="choices"></div><p id="no-actions" class="muted"></p></section>
<section><h2>移動する</h2><div id="routes" class="choices"></div><p id="route-note" class="muted"></p></section>
<section><h2>これまでの記録</h2><ul data-testid="log" id="log"></ul></section>
<footer><button id="finish" type="button">灰潮を待って探索を終える</button><button id="reset" type="button">最初から探索する</button></footer>
</main>
<script type="module" src="./player.js"></script>
</body>
</html>
`;

export const playerScript = `import { initialState, availableActions, travel, act, visibleFragments, finish } from "./runtime.js";

const $ = id => document.getElementById(id);
let game;
let state;
const text = (id, value) => { $(id).textContent = value; };
const locationLabel = id => {
  const location = game.game.locations.find(location => location.entityId === id);
  return location?.description.split(/[。\\n]/)[0] || id;
};
function choose(operation) {
  try { state = operation(); text("error", ""); render(); }
  catch (error) { text("error", error instanceof Error ? error.message : "操作を完了できませんでした。"); }
}
function makeButton(label, operation) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => choose(operation));
  return button;
}
function render() {
  document.title = game.title;
  text("title", game.title);
  text("promise", game.promise);
  text("remaining", Math.max(0, game.game.deadlineHours - state.elapsedHours));
  text("elapsed", state.elapsedHours);
  const resources = game.game.variables.filter(variable => variable.kind === "number");
  text("resources", resources.map((variable, index) => (resources.length === 1 ? "記憶粉の在庫 " : "在庫 " + (index + 1) + ": ") + state.variables[variable.id]).join(" ／ "));
  text("location", locationLabel(state.locationId));
  const description = game.game.locations.find(location => location.entityId === state.locationId)?.description || "";
  const prefix = locationLabel(state.locationId) + "\\n";
  text("description", description.startsWith(prefix) ? description.slice(prefix.length) : description);
  text("end-status", state.ended ? "灰潮が到来し、探索は終了しました。" : "");
  $("discoveries").replaceChildren(...visibleFragments(game, state).map(fragment => {
    const paragraph = document.createElement("p");
    paragraph.className = "discovery";
    paragraph.dataset.fragmentId = fragment.id;
    paragraph.textContent = fragment.text;
    return paragraph;
  }));
  const modes = Object.values(state.knowledge);
  text("knowledge", modes.length ? "確かめたこと " + modes.filter(mode => mode === "known").length + " ／ 観察 " + modes.filter(mode => mode === "observed").length + " ／ 聞いた話 " + modes.filter(mode => mode === "believed").length : "");
  const actions = availableActions(game, state);
  $("actions").replaceChildren(...actions.map(action => {
    const button = makeButton(action.label + "（" + action.costHours + "時間）", () => act(game, state, action.id));
    button.dataset.actionId = action.id;
    return button;
  }));
  text("no-actions", actions.length ? "" : state.ended ? "探索は終了しました。" : "今ここで選べる行動はありません。");
  const routes = game.game.routes.filter(route => route.from === state.locationId);
  $("routes").replaceChildren(...routes.map(route => {
    const button = makeButton(locationLabel(route.to) + "へ向かう（" + route.hours + "時間）", () => travel(game, state, route.to));
    button.dataset.to = route.to;
    button.disabled = state.ended || state.elapsedHours + route.hours > game.game.deadlineHours;
    return button;
  }));
  text("route-note", state.ended ? "" : routes.some(route => state.elapsedHours + route.hours > game.game.deadlineHours) ? "残り時間で到着できない場所には移動できません。" : "移動にも時間がかかります。");
  $("log").replaceChildren(...state.log.map(line => {
    const item = document.createElement("li");
    item.textContent = line;
    return item;
  }));
  $("finish").disabled = state.ended;
}
$("finish").addEventListener("click", () => choose(() => finish(game, state)));
$("reset").addEventListener("click", () => choose(() => initialState(game)));
try {
  const response = await fetch(new URL("./game.json", import.meta.url));
  if (!response.ok) throw new Error("探索データを読み込めませんでした。");
  game = await response.json();
  state = initialState(game);
  render();
} catch (error) { text("error", error instanceof Error ? error.message : "探索を開始できませんでした。"); }
`;
