import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentFoundryApp } from "../app.js";
import { TaskDependency, TaskRecord } from "../core/types.js";
import { newId, nowIso } from "../core/utils.js";
import { buildTaskPrompt } from "../dispatch/taskPrompt.js";
import { mustRunVerification } from "../verify/policies.js";
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
    "agentfoundry_submit_plan",
    {
      title: "Submit Plan",
      description: "Submit an AI-authored plan and create a queued run. This is the required first step before adding tasks.",
      inputSchema: {
        prompt: z.string().min(1),
        planSummary: z.string().min(1),
        risks: z.array(z.string()).optional(),
        discrepancies: z.array(z.string()).optional()
      }
    },
    async ({ prompt, planSummary, risks, discrepancies }) => {
      const planId = newId("plan");
      const runId = newId("run");
      const createdAt = nowIso();

      app.repo.savePlan({
        id: planId,
        inputPrompt: `${prompt}\n\nPlan Summary:\n${planSummary}`,
        risks: risks ?? [],
        discrepancies: discrepancies ?? [],
        createdAt
      });

      app.repo.saveRun({
        id: runId,
        planId,
        status: "queued",
        startedAt: createdAt
      });

      app.repo.appendQueueEvent(runId, "plan_submitted", {
        risksCount: (risks ?? []).length,
        discrepanciesCount: (discrepancies ?? []).length
      });

      const payload = {
        runId,
        planId,
        status: "queued",
        message:
          "Plan accepted. Next call agentfoundry_add_tasks_and_start with this runId and atomic tasks. Hint: stay in plan mode until the task list is complete and ordered."
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  const addTasksInputSchema = {
    runId: z.string().min(1),
    tasks: z
      .array(
        z.object({
          title: z.string().min(1),
          description: z.string().min(1),
          acceptanceCriteria: z.array(z.string().min(1)).min(1).optional(),
          estimatedEffort: z.enum(["tiny", "small", "medium", "large"]).optional(),
          relevantFiles: z.array(z.string().min(1)).optional(),
          verificationCommands: z.array(z.string().min(1)).min(1)
        })
      )
      .min(1)
      .max(30)
  };

  async function addTasksAndStartRun(input: {
    runId: string;
    tasks: Array<{
      title: string;
      description: string;
      acceptanceCriteria?: string[];
      estimatedEffort?: "tiny" | "small" | "medium" | "large";
      relevantFiles?: string[];
      verificationCommands: string[];
    }>;
  }): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }> {
    const { runId, tasks } = input;

    const run = app.repo.getRun(runId);
    if (!run) {
      const payload = { ok: false, error: `Run not found: ${runId}` };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    }

    if (run.status !== "queued") {
      const payload = {
        ok: false,
        error: `Run ${runId} is already ${run.status}. Tasks can only be added before start.`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    }

    const existingTasks = app.repo.listTasks(runId);
    if (existingTasks.length > 0) {
      const payload = {
        ok: false,
        error: `Run ${runId} already has tasks. Create a new plan/run for a fresh task set.`
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload
      };
    }

    const createdAt = nowIso();
    const createdTasks: TaskRecord[] = tasks.map((task, index) => {
      const acceptanceCriteria = task.acceptanceCriteria?.length
        ? task.acceptanceCriteria
        : ["Task objective is implemented.", "Verification commands pass."];

      return {
        id: newId("task"),
        runId,
        title: task.title,
        description: task.description,
        contextCapsule: {
          summary: task.description,
          scope: acceptanceCriteria,
          constraints: [
            "Keep changes minimal and focused.",
            "Preserve existing APIs unless explicitly required."
          ],
          relevantFiles: task.relevantFiles ?? [],
          maxContextTokens: 2400
        },
        acceptanceCriteria,
        verification: {
          commands: task.verificationCommands
        },
        estimatedEffort: task.estimatedEffort ?? "medium",
        status: "pending",
        sequenceOrder: index,
        createdAt,
        updatedAt: createdAt
      };
    });

    const dependencies: TaskDependency[] = [];
    for (let index = 1; index < createdTasks.length; index += 1) {
      dependencies.push({
        taskId: createdTasks[index].id,
        dependsOnTaskId: createdTasks[index - 1].id
      });
    }

    app.repo.saveTasks(createdTasks);
    app.repo.saveDependencies(dependencies);
    app.repo.appendQueueEvent(runId, "tasks_added", {
      taskCount: createdTasks.length,
      mode: "submitted"
    });

    app.repo.updateRunStatus(runId, "running");
    app.repo.appendQueueEvent(runId, "run_started");
    app.scheduler.promoteReady(runId);

    const payload = {
      ok: true,
      runId,
      taskCount: createdTasks.length,
      snapshot: app.repo.queueSnapshot(runId),
      message:
        "Run is active. Call agentfoundry_claim_next_task to claim and execute tasks one by one using your own tools, then submit each with agentfoundry_submit_task_result."
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload
    };
  }

  server.registerTool(
    "agentfoundry_add_tasks_and_start",
    {
      title: "Add Tasks and Start",
      description: "Add ordered atomic tasks to a submitted queued plan and start execution. Requires a prior agentfoundry_submit_plan call.",
      inputSchema: addTasksInputSchema
    },
    addTasksAndStartRun
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

      if (!mustRunVerification(task)) {
        app.repo.updateTaskStatus(task.id, "failed");
        app.repo.appendQueueEvent(
          runId,
          "task_failed",
          {
            reason: "verification_missing",
            failingCommand: "none"
          },
          task.id
        );
        app.repo.updateRunStatus(runId, "failed", true);
        const payload = {
          ok: false,
          taskId: task.id,
          error: "Task has no verification commands configured.",
          runStatus: getRunStatusResource(app.repo, runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

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

      if (!mustRunVerification(task)) {
        app.repo.updateTaskStatus(task.id, "failed");
        app.repo.appendQueueEvent(
          task.runId,
          "task_failed",
          {
            reason: "verification_missing",
            failingCommand: "none"
          },
          task.id
        );
        app.repo.updateRunStatus(task.runId, "failed", true);
        const payload = {
          ok: false,
          taskId,
          error: "Task has no verification commands configured.",
          snapshot: app.repo.queueSnapshot(task.runId)
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload
        };
      }

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

      // Always restore run to "running" when retrying a task — a failed run
      // with pending tasks should be claimable without a separate resume call.
      const run = app.repo.getRun(task.runId);
      if (run && run.status === "failed") {
        app.repo.updateRunStatus(task.runId, "running");
        app.repo.appendQueueEvent(task.runId, "run_resumed_via_retry", { taskId });
      }

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