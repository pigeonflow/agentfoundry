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
    summary: task.contextCapsule.summary
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