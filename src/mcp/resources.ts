import { Repository } from "../db/repository.js";

export function getRunStatusResource(repo: Repository, runId: string): Record<string, unknown> {
  const run = repo.getRun(runId);
  const snapshot = repo.queueSnapshot(runId);
  const tokenUsage = repo.tokenUsage(runId);
  const tasks = repo.listTasks(runId).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    sequenceOrder: task.sequenceOrder,
    summary: task.contextCapsule.summary,
    leaseOwner: repo.getActiveLeaseOwnerForTask(task.id)
  }));
  const failedTaskDiagnostics = tasks
    .filter((task) => task.status === "failed")
    .map((task) => ({
      taskId: task.id,
      latestVerification: repo.latestVerificationReport(task.id)
    }));
  const recentEvents = repo.listQueueEvents(runId, 20);

  return {
    runId,
    run,
    snapshot,
    tokenUsage,
    tasks,
    failedTaskDiagnostics,
    recentEvents
  };
}

export function getOverviewResource(repo: Repository): Record<string, unknown> {
  const runs = repo.listRuns(25);
  return {
    runs,
    generatedAt: new Date().toISOString()
  };
}

export function getDashboardResource(repo: Repository, selectedRunId?: string): Record<string, unknown> {
  const runs = repo.listRuns(30);

  const runCards = runs.map((run) => {
    const snapshot = repo.queueSnapshot(run.id);
    const tokenUsage = repo.tokenUsage(run.id);
    const events = repo.listQueueEvents(run.id, 80);
    const spawnedAgents = events.filter((event) => event.eventType === "task_dispatched").length;
    const dispatchers = Array.from(
      new Set(
        events
          .map((event) => event.payload?.dispatcher)
          .filter((value): value is string => typeof value === "string")
      )
    );

    return {
      run,
      snapshot,
      tokenUsage,
      spawnedAgents,
      dispatchers
    };
  });

  const activeRunId = selectedRunId ?? runs[0]?.id;
  const activeRun = activeRunId ? getRunStatusResource(repo, activeRunId) : null;

  let activePlan: Record<string, unknown> | null = null;
  if (activeRun && activeRun.run && typeof activeRun.run === "object") {
    const planId = (activeRun.run as Record<string, unknown>).planId;
    if (typeof planId === "string") {
      const plan = repo.getPlan(planId);
      if (plan) {
        activePlan = {
          id: plan.id,
          inputPrompt: plan.inputPrompt,
          risks: plan.risks,
          discrepancies: plan.discrepancies,
          createdAt: plan.createdAt
        };
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    runCards,
    activeRun,
    activePlan
  };
}