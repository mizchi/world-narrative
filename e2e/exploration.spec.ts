import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, id: string) => page.locator(`[data-action-id="${id}"]`);
const route = (page: Page, id: string) => page.locator(`[data-to="${id}"]`);
const discovery = (page: Page, id: string) => page.getByTestId("discoveries").locator(`[data-fragment-id="${id}"]`);

async function inspectSouth(page: Page): Promise<void> {
  await route(page, "place.tide").click();
  await action(page, "tide.inspect").click();
  await action(page, "tide.read-records").click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("remaining-hours")).toHaveText("72");
  await expect(page.getByTestId("resources")).toContainText("6");
  await expect(page.getByTestId("current-location")).toHaveText("入り江の港");
});

test("南の観察と照合を経て核心を開示し、修理と両側の保護を終える", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await route(page, "place.tide").click();
  await expect(page.getByTestId("current-location")).toHaveText("南の古い水門");
  await expect(page.getByTestId("remaining-hours")).toHaveText("60");
  await expect(discovery(page, "tide.fragment.test")).toHaveCount(0);
  await expect(discovery(page, "tide.intro.memory")).toBeVisible();
  await action(page, "tide.inspect").click();
  await action(page, "tide.read-records").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("58");
  await expect(discovery(page, "tide.fragment.record")).toBeVisible();
  await expect(discovery(page, "tide.fragment.test")).toHaveCount(0);
  await action(page, "tide.test").click();
  await expect(discovery(page, "tide.fragment.test")).toContainText("記憶の大切さより");
  await expect(discovery(page, "tide.intro.memory")).toHaveCount(0);
  await expect(discovery(page, "tide.intro.familiar")).toBeVisible();
  await expect(action(page, "tide.test")).toHaveCount(0);
  await action(page, "tide.repair").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("45");
  await action(page, "tide.protect-both").click();
  await expect(page.getByTestId("resources")).toContainText("0");
  await expect(page.getByTestId("remaining-hours")).toHaveText("44");
  await expect(action(page, "tide.protect-cistern")).toHaveCount(0);
  await page.getByRole("button", { name: "灰潮を待って探索を終える" }).click();
  await expect(page.getByTestId("end-status")).toContainText("終了");
  await expect(page.getByTestId("remaining-hours")).toHaveText("0");
  await expect(discovery(page, "ending.tide.split")).toContainText("ともに一潮を越えた");
  await expect(page.getByTestId("log")).toContainText("灰潮が到来した");
  await expect(route(page, "place.harbor")).toBeDisabled();
  expect(errors).toEqual([]);
});

for (const choice of [
  { id: "tide.protect-cistern", ending: "ending.tide.cistern", other: "ending.tide.racks", text: "雨水槽の縁が残った" },
  { id: "tide.protect-racks", ending: "ending.tide.racks", other: "ending.tide.cistern", text: "仕上がった網" },
]) {
  test(`${choice.id}の選択に対応する負担と終了結果だけを表示する`, async ({ page }) => {
    await inspectSouth(page);
    await action(page, choice.id).click();
    await expect(page.getByTestId("resources")).toContainText("2");
    await expect(discovery(page, "tide.fragment.test")).toHaveCount(0);
    await page.getByRole("button", { name: "灰潮を待って探索を終える" }).click();
    await expect(discovery(page, choice.ending)).toContainText(choice.text);
    await expect(discovery(page, choice.other)).toHaveCount(0);
    await expect(discovery(page, "ending.tide.split")).toHaveCount(0);
  });
}

test("北の窯修理は24時間と在庫2を使い、溝修理と両立しない", async ({ page }) => {
  await route(page, "place.quarry").click();
  await expect(page.getByTestId("current-location")).toHaveText("北の採石場");
  await expect(discovery(page, "quarry.fragment.trial")).toHaveCount(0);
  await action(page, "quarry.read-ledger").click();
  await action(page, "quarry.inspect-channel").click();
  await action(page, "quarry.repair-kiln").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("34");
  await expect(page.getByTestId("resources")).toContainText("4");
  await expect(action(page, "quarry.repair-channel")).toHaveCount(0);
  await expect(discovery(page, "quarry.fragment.trial")).toHaveCount(0);
  await action(page, "quarry.read-trial").click();
  await expect(discovery(page, "quarry.fragment.trial")).toContainText("記憶の重さで粉は強くならない");
  await expect(discovery(page, "quarry.fragment.nene")).toContainText("取り下げる");
  await page.getByRole("button", { name: "灰潮を待って探索を終える" }).click();
  await expect(discovery(page, "ending.quarry.kiln")).toContainText("夜勤が減った");
  await expect(discovery(page, "ending.quarry.channel")).toHaveCount(0);
});

test("溝修理は在庫を増やさず、往復と締切で南の修理が選べなくなる", async ({ page }) => {
  await route(page, "place.quarry").click();
  await action(page, "quarry.inspect-channel").click();
  await action(page, "quarry.repair-channel").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("35");
  await expect(page.getByTestId("resources")).toContainText("6");
  await expect(action(page, "quarry.repair-kiln")).toHaveCount(0);
  await route(page, "place.harbor").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("23");
  await route(page, "place.tide").click();
  await action(page, "tide.inspect").click();
  await action(page, "tide.read-records").click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("9");
  await expect(action(page, "tide.repair")).toHaveCount(0);
  await expect(route(page, "place.harbor")).toBeDisabled();
  await page.getByRole("button", { name: "灰潮を待って探索を終える" }).click();
  await expect(discovery(page, "ending.quarry.channel")).toContainText("途中で失う粉が減った");
  await expect(discovery(page, "ending.quarry.kiln")).toHaveCount(0);
  await page.getByRole("button", { name: "最初から探索する" }).click();
  await expect(page.getByTestId("remaining-hours")).toHaveText("72");
  await expect(page.getByTestId("elapsed-hours")).toHaveText("0");
  await expect(page.getByTestId("resources")).toContainText("6");
  await expect(page.getByTestId("end-status")).toHaveText("");
  await expect(discovery(page, "quarry.fragment.trial")).toHaveCount(0);
  await expect(route(page, "place.quarry")).toBeEnabled();
});

test("出力したゲームデータに作者用の正史や説明を同梱しない", async ({ request }) => {
  const response = await request.get("/game.json");
  expect(response.ok()).toBe(true);
  const game = await response.json();
  expect(Object.keys(game).sort()).toEqual(["episodes", "formatVersion", "game", "promise", "revealRules", "revision", "title", "worldId"].sort());
  expect(game).not.toHaveProperty("claims");
  expect(game).not.toHaveProperty("assertions");
  expect(game).not.toHaveProperty("apiKey");
  expect(game.revealRules.every((rule: { text: string }) => rule.text === "")).toBe(true);
});
