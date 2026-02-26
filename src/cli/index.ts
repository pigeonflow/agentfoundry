#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { AgentFoundryApp } from "../app.js";
import { getSkillTemplate } from "./skillTemplate.js";
import { startDashboardServer } from "../dashboard/server.js";
import { startMcpServer } from "../mcp/server.js";
import { getRunStatusResource } from "../mcp/resources.js";

function usage(): void {
  process.stdout.write(
    [
      "AgentFoundry CLI",
      "",
      "Commands:",
      "  plan <prompt>",
      "  run <prompt>",
      "  mcp-run <prompt> (deprecated)",
      "  --get-skill",
      "  --get-skil (alias)",
      "  get-skill",
      "  dashboard [--port=4317]",
      "  status <runId> [--json]",
      "  watch <runId> [--interval=1500]",
      "  retry <taskId>",
      "  mcp-server",
      "",
      "Environment:",
      "  AGENTFOUNDRY_DB_PATH=/path/to/agentfoundry.db",
      "  AGENTFOUNDRY_FORWARD_CMD='your-real-agent-cli --prompt-stdin'",
      "  AGENTFOUNDRY_SUBAGENT_CMD='override built-in runner command'",
      "  AGENTFOUNDRY_MCP_DISPATCH_CMD='your-mcp-dispatch-command'",
      "  AGENTFOUNDRY_MCP_SERVER_CMD='custom server command'"
    ].join("\n") + "\n"
  );
}

function formatStatus(resource: Record<string, unknown>): string {
  const snapshot = resource.snapshot as Record<string, number>;
  const tokenUsage = resource.tokenUsage as Record<string, number>;
  return [
    `run: ${resource.runId}`,
    `pending=${snapshot.pending} ready=${snapshot.ready} running=${snapshot.running} verifying=${snapshot.verifying}`,
    `completed=${snapshot.completed} failed=${snapshot.failed} blocked=${snapshot.blocked}`,
    `tokens(in/out est): ${tokenUsage.estimatedInputTokens}/${tokenUsage.estimatedOutputTokens}`
  ].join("\n");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }

  if (command === "mcp-server") {
    await startMcpServer(process.env.AGENTFOUNDRY_DB_PATH);
    return;
  }

  if (command === "--get-skill" || command === "--get-skil" || command === "get-skill") {
    process.stdout.write(getSkillTemplate());
    return;
  }

  if (command === "dashboard") {
    const portArg = rest.find((arg) => arg.startsWith("--port="));
    const port = portArg ? Number(portArg.split("=")[1]) : undefined;
    startDashboardServer({ dbPath: process.env.AGENTFOUNDRY_DB_PATH, port });
    return;
  }

  const app = new AgentFoundryApp(process.env.AGENTFOUNDRY_DB_PATH);
  try {
    if (command === "plan") {
      throw new Error(
        "The 'plan' command is not available in CLI mode.\n" +
        "Use MCP tools instead: agentfoundry_submit_plan, then agentfoundry_add_tasks_and_start."
      );
    }

    if (command === "run") {
      throw new Error(
        "The 'run' command is not available in CLI mode.\n" +
        "Use MCP tools instead: agentfoundry_submit_plan, then agentfoundry_add_tasks_and_start."
      );
    }

    if (command === "mcp-run") {
      throw new Error(
        "The 'mcp-run' command is deprecated because planning now requires explicit plan submission and task injection.\n" +
        "Use your MCP client loop: submit_plan -> add_tasks_and_start -> claim_next_task -> submit_task_result."
      );
    }

    if (command === "status") {
      const runId = rest[0];
      const asJson = rest.includes("--json");
      if (!runId) {
        throw new Error("Missing runId for status command.");
      }
      const status = getRunStatusResource(app.repo, runId);
      process.stdout.write(asJson ? `${JSON.stringify(status, null, 2)}\n` : `${formatStatus(status)}\n`);
      return;
    }

    if (command === "watch") {
      const runId = rest[0];
      if (!runId) {
        throw new Error("Missing runId for watch command.");
      }

      const intervalArg = rest.find((arg) => arg.startsWith("--interval="));
      const intervalMs = intervalArg ? Number(intervalArg.split("=")[1]) : 1500;

      for (;;) {
        const status = getRunStatusResource(app.repo, runId);
        process.stdout.write(`\u001Bc${formatStatus(status)}\n`);
        const snapshot = status.snapshot as Record<string, number>;
        if (snapshot.failed > 0 || (snapshot.pending === 0 && snapshot.ready === 0 && snapshot.running === 0 && snapshot.verifying === 0)) {
          break;
        }
        await sleep(intervalMs);
      }
      return;
    }

    if (command === "retry") {
      const taskId = rest[0];
      if (!taskId) {
        throw new Error("Missing taskId for retry command.");
      }
      app.repo.updateTaskStatus(taskId, "pending");
      process.stdout.write(`Task ${taskId} moved to pending.\n`);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});