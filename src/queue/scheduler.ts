import { TaskRecord } from "../core/types.js";
import { Repository } from "../db/repository.js";
import { prioritizeReadyTasks } from "./prioritizer.js";

export class Scheduler {
  constructor(private readonly repo: Repository) {}

  promoteReady(runId: string): TaskRecord[] {
    const ready = this.repo.getReadyTasks(runId);
    for (const task of ready) {
      if (task.status !== "ready") {
        this.repo.updateTaskStatus(task.id, "ready");
        this.repo.appendQueueEvent(runId, "task_ready", { taskId: task.id }, task.id);
      }
    }
    return prioritizeReadyTasks(
      ready.map((task) => ({
        ...task,
        status: "ready"
      }))
    );
  }

  next(runId: string): TaskRecord | undefined {
    const ready = this.promoteReady(runId);
    return ready[0];
  }
}