import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AgentFoundryApp } from "../app.js";
import { getDashboardResource } from "../mcp/resources.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "dashboard-ui", "dist");

const FALLBACK_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentFoundry Dashboard</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 24px; }
      code { background: #f1f3f5; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <h2>Dashboard frontend not built yet</h2>
    <p>Run <code>npm run dashboard:build</code> and restart <code>npm run dashboard</code>.</p>
  </body>
</html>`;

function mimeType(filePath: string): string {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".ico")) {
    return "image/x-icon";
  }
  return "application/octet-stream";
}

export function startDashboardServer(options?: { dbPath?: string; port?: number }): void {
  const app = new AgentFoundryApp(options?.dbPath ?? process.env.AGENTFOUNDRY_DB_PATH);
  const port = options?.port ?? Number(process.env.AGENTFOUNDRY_DASHBOARD_PORT ?? 4317);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/dashboard") {
      const runId = url.searchParams.get("runId") ?? undefined;
      const payload = getDashboardResource(app.repo, runId);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(payload));
      return;
    }

    // POST /api/runs/:runId/stop
    const stopMatch = /^\/api\/runs\/([^\/]+)\/stop$/.exec(url.pathname);
    if (stopMatch && req.method === "POST") {
      const runId = decodeURIComponent(stopMatch[1]);
      const ok = app.repo.stopRun(runId);
      if (!ok) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: `Run not found: ${runId}` }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, runId }));
      return;
    }

    // DELETE /api/runs/:runId
    const deleteMatch = /^\/api\/runs\/([^\/]+)$/.exec(url.pathname);
    if (deleteMatch && req.method === "DELETE") {
      const runId = decodeURIComponent(deleteMatch[1]);
      const ok = app.repo.deleteRun(runId);
      if (!ok) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: `Run not found: ${runId}` }));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, runId }));
      return;
    }

    if (url.pathname === "/" || url.pathname === "/dashboard") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      const indexPath = path.join(PUBLIC_DIR, "index.html");
      if (!existsSync(indexPath)) {
        res.end(FALLBACK_HTML);
        return;
      }
      res.end(readFileSync(indexPath));
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      const relativePath = url.pathname.replace(/^\//, "");
      const assetPath = path.join(PUBLIC_DIR, relativePath);
      if (!existsSync(assetPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", mimeType(assetPath));
      res.end(readFileSync(assetPath));
      return;
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`AgentFoundry dashboard running at http://127.0.0.1:${port}\n`);
  });

  const shutdown = () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}