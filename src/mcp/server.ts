import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentFoundryApp } from "../app.js";
import { getOverviewResource, getRunStatusResource } from "./resources.js";

export async function startMcpServer(dbPath?: string): Promise<void> {
  const app = new AgentFoundryApp(dbPath);

  const server = new McpServer({
    name: "agentfoundry",
    version: "0.1.0"
  });

  server.registerResource(
    "agentfoundry_overview",
    "agentfoundry://overview",
    {
      title: "AgentFoundry Overview",
      description: "Recent runs and global status summary.",
      mimeType: "application/json"
    },
    async (uri) => {
      const payload = getOverviewResource(app.repo);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );

  server.registerResource(
    "agentfoundry_run_status",
    new ResourceTemplate("agentfoundry://run/{runId}", { list: undefined }),
    {
      title: "Run Status",
      description: "Queue snapshot, token estimate, and task list for a run.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const runId = String(variables.runId ?? "");
      const payload = getRunStatusResource(app.repo, runId);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    "agentfoundry_status",
    {
      title: "Get Run Status",
      description: "Return queue/task/token status for an existing run.",
      inputSchema: {
        runId: z.string().min(1)
      }
    },
    async ({ runId }) => {
      const payload = getRunStatusResource(app.repo, runId);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_plan",
    {
      title: "Create Plan",
      description: "Create a queued run from a high-level prompt without executing it.",
      inputSchema: {
        prompt: z.string().min(1)
      }
    },
    async ({ prompt }) => {
      const planned = app.planner.createRunFromPrompt(prompt);
      const payload = {
        runId: planned.run.id,
        planId: planned.plan.id,
        tasks: planned.tasks.length,
        risks: planned.plan.risks,
        discrepancies: planned.plan.discrepancies
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_run",
    {
      title: "Plan and Execute",
      description: "Create a run from prompt and execute tasks through dispatch + verification.",
      inputSchema: {
        prompt: z.string().min(1)
      }
    },
    async ({ prompt }) => {
      const planned = app.planner.createRunFromPrompt(prompt);
      await app.engine.run(planned.run.id);
      const payload = getRunStatusResource(app.repo, planned.run.id);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_retry_task",
    {
      title: "Retry Task",
      description: "Move a task back to pending so it can be rescheduled.",
      inputSchema: {
        taskId: z.string().min(1)
      }
    },
    async ({ taskId }) => {
      app.repo.updateTaskStatus(taskId, "pending");
      const payload = { ok: true, taskId, status: "pending" };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    }
  );

  server.registerPrompt(
    "agentfoundry_task_execution",
    {
      title: "Task Execution Prompt",
      description: "Reusable instruction for running one atomic AgentFoundry task.",
      argsSchema: {
        taskSummary: z.string(),
        constraints: z.string()
      }
    },
    async ({ taskSummary, constraints }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Execute this atomic task: ${taskSummary}\n\nConstraints:\n${constraints}`
            }
          }
        ]
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close();
    app.close();
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  transport.onclose = () => {
    app.close();
  };
  transport.onerror = () => {
    app.close();
  };
}