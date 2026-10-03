import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";

const externalDirectory = process.env.E2E_GAME_DIR;
const runId = randomUUID();
const directory = externalDirectory ?? `.tmp/e2e-game-${runId}`;
const project = `.tmp/e2e-project-${runId}`;
const baseURL = "http://127.0.0.1:4174";
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const serverCommand = `node src/player/server.ts ${quote(directory)} --port 4174 --host 127.0.0.1`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: externalDirectory ? serverCommand : `node src/cli.ts demo --project ${quote(project)} --out ${quote(directory)} && ${serverCommand}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
