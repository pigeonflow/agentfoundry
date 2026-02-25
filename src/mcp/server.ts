import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentFoundryApp } from "../app.js";
import { buildTaskPrompt } from "../dispatch/taskPrompt.js";
import { VerificationRunner } from "../verify/verificationRunner.js";
import { getOverviewResource, getRunStatusResource } from "./resources.js";

const DEFAULT_COMPAT_OWNER = "mcp-coding-agent";

function finalizeRunIfDone(app: AgentFoundryApp, runId: string): void {
  const snapshot = app.repo.queueSnapshot(runId);
  const hasActive = snapshot.pending + snapshot.ready + snapshot.running + snapshot.verifying > 0;
  // Don't finalize if there are still tasks in flight — a retry may have
  // moved a previously-failed task back to pending.
  if (hasActive) return;

  if (snapshot.failed > 0) {
    app.repo.updateRunStatus(runId, "failed", true);
    return;
  }

  app.repo.updateRunStatus(runId, "completed", true);
  app.repo.appendQueueEvent(runId, "run_completed");
}

export async function startMcpServer(dbPath?: string): Promise<void> {
  const app = new AgentFoundryApp(dbPath);
  const verificationRunner = new VerificationRunner();

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
      const sampleFn = async (llmPrompt: string): Promise<string> => {
        const result = await server.server.createMessage({
          messages: [{ role: "user", content: { type: "text", text: llmPrompt } }],
          maxTokens: 4096
        });
        if (result.content.type !== "text") {
          throw new Error("LLM sampler returned non-text content.");
        }
        return result.content.text;
      };
      const planned = await app.planner.createRunFromPrompt(prompt, sampleFn);
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
    "agentfoundry_plan_and_start",
    {
      title: "Plan and Start",
      description: "Create a queued run from a high-level prompt and immediately mark it as running, ready for task claiming. Use this as a shortcut for agentfoundry_plan followed by agentfoundry_execute_run. After calling this, loop agentfoundry_claim_next_task to execute each task with your own tools.",
      inputSchema: {
        prompt: z.string().min(1)
      }
    },
    async ({ prompt }) => {
      const sampleFn = async (llmPrompt: string): Promise<string> => {
        const result = await server.server.createMessage({
          messages: [{ role: "user", content: { type: "text", text: llmPrompt } }],
          maxTokens: 4096
        });
        if (result.content.type !== "text") {
          throw new Error("LLM sampler returned non-text content.");
        }
        return result.content.text;
      };
      const planned = await app.planner.createRunFromPrompt(prompt, sampleFn);
      // Mark as running so LLM workers can claim tasks — do NOT dispatch via engine
      app.repo.updateRunStatus(planned.run.id, "running");
      app.repo.appendQueueEvent(planned.run.id, "run_started");
      app.scheduler.promoteReady(planned.run.id);
      const payload = {
        runId: planned.run.id,
        planId: planned.plan.id,
        taskCount: planned.tasks.length,
        snapshot: app.repo.queueSnapshot(planned.run.id),
        message: "Run is active. Call agentfoundry_claim_next_task to claim and execute tasks one by one using your own tools, then submit each with agentfoundry_submit_task_result."
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
      title: "Run Existing Plan",
      description: "Mark a planned run as running so workers can claim tasks.",
      inputSchema: {
        runId: z.string().min(1)
      }
    },
    async ({ runId }) => {
      const run = app.repo.getRun(runId);
      if (!run) {
        const payload = { ok: false, error: `Run not found: ${runId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      if (run.status !== "running") {
        app.repo.updateRunStatus(runId, "running");
        app.repo.appendQueueEvent(runId, "run_started");
      }

      app.scheduler.promoteReady(runId);

      const activeLease = app.repo.getActiveLeaseForRun(runId, DEFAULT_COMPAT_OWNER);
      if (activeLease) {
        const leasedTask = app.repo.getTask(activeLease.taskId);
        const payload = {
          ok: true,
          claimed: true,
          awaitingCompletion: true,
          runId,
          task: leasedTask,
          leaseToken: activeLease.leaseToken,
          leaseExpiresAt: activeLease.leaseExpiresAt,
          runStatus: getRunStatusResource(app.repo, runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

      const claim = app.repo.claimNextTask(runId, DEFAULT_COMPAT_OWNER, 900);
      if (!claim) {
        finalizeRunIfDone(app, runId);
        const payload = {
          ok: true,
          claimed: false,
          runStatus: getRunStatusResource(app.repo, runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

      app.repo.appendQueueEvent(
        runId,
        "task_claimed",
        {
          leaseOwner: DEFAULT_COMPAT_OWNER,
          leaseExpiresAt: claim.leaseExpiresAt,
          source: "agentfoundry_run"
        },
        claim.task.id
      );

      const payload = {
        ok: true,
        claimed: true,
        awaitingCompletion: true,
        runId,
        task: claim.task,
        leaseToken: claim.leaseToken,
        leaseExpiresAt: claim.leaseExpiresAt,
        runStatus: getRunStatusResource(app.repo, runId)
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_execute_run",
    {
      title: "Execute Existing Run (Alias)",
      description: "Backward-compatible alias for agentfoundry_run.",
      inputSchema: {
        runId: z.string().min(1)
      }
    },
    async ({ runId }) => {
      const run = app.repo.getRun(runId);
      if (!run) {
        const payload = { ok: false, error: `Run not found: ${runId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      if (run.status !== "running") {
        app.repo.updateRunStatus(runId, "running");
        app.repo.appendQueueEvent(runId, "run_started");
      }

      const activeLease = app.repo.getActiveLeaseForRun(runId, DEFAULT_COMPAT_OWNER);
      if (!activeLease) {
        app.scheduler.promoteReady(runId);
        const claim = app.repo.claimNextTask(runId, DEFAULT_COMPAT_OWNER, 900);

        if (!claim) {
          finalizeRunIfDone(app, runId);
          const payload = {
            ok: true,
            claimed: false,
            runStatus: getRunStatusResource(app.repo, runId)
          };
          return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload
          };
        }

        app.repo.appendQueueEvent(
          runId,
          "task_claimed",
          {
            leaseOwner: DEFAULT_COMPAT_OWNER,
            leaseExpiresAt: claim.leaseExpiresAt,
            source: "agentfoundry_execute_run"
          },
          claim.task.id
        );

        const payload = {
          ok: true,
          claimed: true,
          awaitingCompletion: true,
          runId,
          task: claim.task,
          leaseToken: claim.leaseToken,
          leaseExpiresAt: claim.leaseExpiresAt,
          runStatus: getRunStatusResource(app.repo, runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

      const task = app.repo.getTask(activeLease.taskId);
      if (!task) {
        const payload = { ok: false, error: `Task not found for active lease: ${activeLease.taskId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      const movedToVerifying = app.repo.markClaimedTaskVerifying(task.id, activeLease.leaseToken);
      if (!movedToVerifying) {
        const payload = { ok: false, error: "Failed to submit active leased task." };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      app.repo.appendQueueEvent(
        runId,
        "task_submitted",
        { summary: "Submitted via agentfoundry_execute_run compatibility flow." },
        task.id
      );

      const report = verificationRunner.run(task.id, task.verification.commands);
      app.repo.saveVerificationReport(report);

      if (report.passed) {
        app.repo.updateTaskStatus(task.id, "completed");
        app.repo.appendQueueEvent(runId, "task_completed", undefined, task.id);
      } else {
        app.repo.updateTaskStatus(task.id, "failed");
        app.repo.appendQueueEvent(
          runId,
          "task_failed",
          {
            reason: "verification_failed",
            failingCommand: report.commandResults.at(-1)?.command ?? "unknown"
          },
          task.id
        );
        app.repo.updateRunStatus(runId, "failed", true);
        const payload = {
          ok: false,
          taskId: task.id,
          verification: report,
          runStatus: getRunStatusResource(app.repo, runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

      app.scheduler.promoteReady(runId);
      const nextClaim = app.repo.claimNextTask(runId, DEFAULT_COMPAT_OWNER, 900);
      finalizeRunIfDone(app, runId);

      const payload = {
        ok: true,
        taskId: task.id,
        verification: report,
        nextTask: nextClaim?.task,
        nextLeaseToken: nextClaim?.leaseToken,
        nextLeaseExpiresAt: nextClaim?.leaseExpiresAt,
        runStatus: getRunStatusResource(app.repo, runId)
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_claim_next_task",
    {
      title: "Claim Next Task",
      description:
        "Claim exactly one ready task and receive its full execution prompt. " +
        "Use your available tools (file reads/writes, terminal, etc.) to complete the work described in `taskPrompt`, " +
        "then call `agentfoundry_submit_task_result` with the returned `taskId` and `leaseToken`. " +
        "Call this in a loop until `claimed` is false (no more tasks remain).",
      inputSchema: {
        runId: z.string().min(1),
        leaseOwner: z.string().min(1).optional(),
        leaseTtlSeconds: z.number().int().min(30).max(3600).optional()
      }
    },
    async ({ runId, leaseOwner, leaseTtlSeconds }) => {
      const run = app.repo.getRun(runId);
      if (!run) {
        const payload = { ok: false, error: `Run not found: ${runId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      if (run.status !== "running") {
        app.repo.updateRunStatus(runId, "running");
        app.repo.appendQueueEvent(runId, "run_started");
      }

      app.scheduler.promoteReady(runId);
      const claim = app.repo.claimNextTask(
        runId,
        leaseOwner ?? "mcp-coding-agent",
        leaseTtlSeconds ?? 300
      );

      if (!claim) {
        finalizeRunIfDone(app, runId);
        const payload = {
          ok: true,
          claimed: false,
          message: "No more tasks to claim. Run may be complete.",
          snapshot: app.repo.queueSnapshot(runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

      app.repo.appendQueueEvent(
        runId,
        "task_claimed",
        {
          leaseOwner: leaseOwner ?? "mcp-coding-agent",
          leaseExpiresAt: claim.leaseExpiresAt
        },
        claim.task.id
      );

      const taskPrompt = buildTaskPrompt(claim.task);
      const payload = {
        ok: true,
        claimed: true,
        runId,
        taskId: claim.task.id,
        leaseToken: claim.leaseToken,
        leaseExpiresAt: claim.leaseExpiresAt,
        taskPrompt,
        task: claim.task,
        snapshot: app.repo.queueSnapshot(runId)
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_heartbeat_lease",
    {
      title: "Heartbeat Lease",
      description: "Extend an active task lease while the coding agent is still working.",
      inputSchema: {
        taskId: z.string().min(1),
        leaseToken: z.string().min(1),
        leaseTtlSeconds: z.number().int().min(30).max(3600).optional()
      }
    },
    async ({ taskId, leaseToken, leaseTtlSeconds }) => {
      const heartbeat = app.repo.heartbeatTaskLease(taskId, leaseToken, leaseTtlSeconds ?? 300);
      const payload = {
        ok: heartbeat.ok,
        taskId,
        leaseExpiresAt: heartbeat.leaseExpiresAt
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_submit_task_result",
    {
      title: "Submit Task Result",
      description: "Submit a claimed task for verification and completion.",
      inputSchema: {
        taskId: z.string().min(1),
        leaseToken: z.string().min(1),
        summary: z.string().optional()
      }
    },
    async ({ taskId, leaseToken, summary }) => {
      const task = app.repo.getTask(taskId);
      if (!task) {
        const payload = { ok: false, error: `Task not found: ${taskId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      const movedToVerifying = app.repo.markClaimedTaskVerifying(taskId, leaseToken);
      if (!movedToVerifying) {
        const payload = { ok: false, error: "Invalid or expired lease token." };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      app.repo.appendQueueEvent(
        task.runId,
        "task_submitted",
        summary ? { summary } : undefined,
        task.id
      );

      const report = verificationRunner.run(task.id, task.verification.commands);
      app.repo.saveVerificationReport(report);

      if (report.passed) {
        app.repo.updateTaskStatus(task.id, "completed");
        app.repo.appendQueueEvent(task.runId, "task_completed", undefined, task.id);
      } else {
        app.repo.updateTaskStatus(task.id, "failed");
        app.repo.appendQueueEvent(
          task.runId,
          "task_failed",
          {
            reason: "verification_failed",
            failingCommand: report.commandResults.at(-1)?.command ?? "unknown"
          },
          task.id
        );
        app.repo.updateRunStatus(task.runId, "failed", true);
      }

      app.scheduler.promoteReady(task.runId);
      finalizeRunIfDone(app, task.runId);

      const payload = {
        ok: report.passed,
        taskId,
        verification: {
          passed: report.passed,
          commandResults: report.commandResults
        },
        snapshot: app.repo.queueSnapshot(task.runId)
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.registerTool(
    "agentfoundry_fail_task",
    {
      title: "Fail Claimed Task",
      description: "Mark a claimed task as failed with a reason.",
      inputSchema: {
        taskId: z.string().min(1),
        leaseToken: z.string().min(1),
        reason: z.string().min(1)
      }
    },
    async ({ taskId, leaseToken, reason }) => {
      const task = app.repo.getTask(taskId);
      if (!task) {
        const payload = { ok: false, error: `Task not found: ${taskId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      const failed = app.repo.failClaimedTask(taskId, leaseToken);
      if (!failed) {
        const payload = { ok: false, error: "Invalid or expired lease token." };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      app.repo.appendQueueEvent(task.runId, "task_failed", { reason }, task.id);
      app.repo.updateRunStatus(task.runId, "failed", true);

      const payload = {
        ok: true,
        taskId,
        reason,
        snapshot: app.repo.queueSnapshot(task.runId)
      };
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
        taskId: z.string().min(1),
        resumeRun: z.boolean().optional()
      }
    },
    async ({ taskId, resumeRun }) => {
      const task = app.repo.getTask(taskId);
      if (!task) {
        const payload = { ok: false, error: `Task not found: ${taskId}` };
        return {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          structuredContent: payload
        };
      }

      app.repo.updateTaskStatus(taskId, "pending");
      app.repo.appendQueueEvent(task.runId, "task_retried", { taskId }, taskId);

      const shouldResumeRun = resumeRun ?? false;
      if (shouldResumeRun) {
        await app.engine.run(task.runId);
      }

      const payload = {
        ok: true,
        taskId,
        status: "pending",
        resumedRun: shouldResumeRun,
        snapshot: app.repo.queueSnapshot(task.runId)
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
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