import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const files: Record<string, { filename: string; contentType: string }> = {
  "/": { filename: "index.html", contentType: "text/html; charset=utf-8" },
  "/index.html": { filename: "index.html", contentType: "text/html; charset=utf-8" },
  "/game.json": { filename: "game.json", contentType: "application/json; charset=utf-8" },
  "/player.js": { filename: "player.js", contentType: "text/javascript; charset=utf-8" },
  "/runtime.js": { filename: "runtime.js", contentType: "text/javascript; charset=utf-8" },
};

/** Serve only the four exported player files, even when the directory has author files. */
export async function serveGame(directory: string, options: { host?: string; port?: number } = {}): Promise<Server> {
  const root = resolve(directory);
  await readFile(join(root, "index.html"));
  const server = createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = Object.hasOwn(files, pathname) ? files[pathname] : undefined;
    if (!file) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    try {
      const body = await readFile(join(root, file.filename));
      response.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Length": body.byteLength,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4173, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      accept();
    });
  });
  return server;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const directory = args.shift();
  if (!directory) throw new Error("使用法: node src/player/server.ts <出力ディレクトリ> [--port 4173] [--host 127.0.0.1]");
  let port = 4173;
  let host = "127.0.0.1";
  while (args.length) {
    const flag = args.shift();
    const value = args.shift();
    if (flag === "--port" && value !== undefined) {
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("portには0〜65535を指定してください。");
    } else if (flag === "--host" && value) host = value;
    else throw new Error(`不明なオプション: ${flag ?? ""}`);
  }
  const server = await serveGame(directory, { host, port });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(`探索ゲーム: http://${host.includes(":") ? `[${host}]` : host}:${boundPort}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.close(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
