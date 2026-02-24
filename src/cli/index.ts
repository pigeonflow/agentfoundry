#!/usr/bin/env node
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentFoundryApp } from "../app.js";
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
      "  mcp-run <prompt>",
      "  status <runId> [--json]",
      "  watch <runId> [--interval=1500]",
      "  retry <taskId>",
      "  mcp-server",
      "",
      "Environment:",
      "  AGENTFOUNDRY_DB_PATH=/path/to/agentfoundry.db",
      "  AGENTFOUNDRY_SUBAGENT_CMD='your-agent-command'",
      "  AGENTFOUNDRY_MCP_DISPATCH_CMD='your-mcp-dispatch-command'",
      "  AGENTFOUNDRY_MCP_SERVER_CMD='custom server command'"
    ].join("\n") + "\n"
  );
}

function resolveMcpServerProcess(): { command: string; args: string[] } {
  const customCommand = process.env.AGENTFOUNDRY_MCP_SERVER_CMD?.trim();
  if (customCommand) {
    return {
      command: "sh",
      args: ["-lc", customCommand]
    };
  }

  const currentEntry = process.argv[1] ?? "";
  if (currentEntry.endsWith(".ts")) {
    return {
      command: "npx",
      args: ["tsx", "src/cli/index.ts", "mcp-server"]
    };
  }

  return {
    command: process.execPath,
    args: [currentEntry, "mcp-server"]
  };
}

async function runViaMcp(prompt: string): Promise<Record<string, unknown>> {
  const serverProcess = resolveMcpServerProcess();
  const transport = new StdioClientTransport({
    command: serverProcess.command,
    args: serverProcess.args,
    env: Object.entries(process.env).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {})
  });

  const client = new Client(
    {
      name: "agentfoundry-cli-client",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "agentfoundry_run",
      arguments: { prompt }
    });

    const structured = result.structuredContent;
    if (structured && typeof structured === "object") {
      return structured as Record<string, unknown>;
    }

    return {
      content: result.content
    };
  } finally {
    await client.close();
  }
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

  const app = new AgentFoundryApp(process.env.AGENTFOUNDRY_DB_PATH);
  try {
    if (command === "plan") {
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        throw new Error("Missing prompt for plan command.");
      }
      const planned = app.planner.createRunFromPrompt(prompt);
      process.stdout.write(
        JSON.stringify(
          {
            runId: planned.run.id,
            planId: planned.plan.id,
            tasks: planned.tasks.length,
            discrepancies: planned.plan.discrepancies,
            risks: planned.plan.risks
          },
          null,
          2
        ) + "\n"
      );
      return;
    }

    if (command === "run") {
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        throw new Error("Missing prompt for run command.");
      }
      const planned = app.planner.createRunFromPrompt(prompt);
      await app.engine.run(planned.run.id);
      const status = getRunStatusResource(app.repo, planned.run.id);
      process.stdout.write(JSON.stringify(status, null, 2) + "\n");
      return;
    }

    if (command === "mcp-run") {
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        throw new Error("Missing prompt for mcp-run command.");
      }
      const result = await runViaMcp(prompt);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
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