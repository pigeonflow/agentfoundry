import { DispatchRouter } from "../dispatch/dispatcher.js";
import { Repository } from "../db/repository.js";
import { Scheduler } from "../queue/scheduler.js";
import { mustRunVerification } from "../verify/policies.js";
import { VerificationRunner } from "../verify/verificationRunner.js";

export class Engine {
  constructor(
    private readonly repo: Repository,
    private readonly scheduler: Scheduler,
    private readonly dispatchRouter: DispatchRouter,
    private readonly verificationRunner: VerificationRunner
  ) {}

  async run(runId: string): Promise<void> {
    this.repo.updateRunStatus(runId, "running");
    this.repo.appendQueueEvent(runId, "run_started");

    let task = this.scheduler.next(runId);
    while (task) {
      this.repo.updateTaskStatus(task.id, "running");
      this.repo.appendQueueEvent(runId, "task_running", undefined, task.id);

      const dispatcher = this.dispatchRouter.choose();
      const dispatchResult = await dispatcher.dispatch({
        task,
        contextWindowTokens: task.contextCapsule.maxContextTokens
      });

      if (!dispatchResult.passedToAgent) {
        this.repo.updateTaskStatus(task.id, "failed");
        this.repo.appendQueueEvent(
          runId,
          "task_failed",
          {
            reason: "dispatch_failed",
            summary: dispatchResult.summary,
            dispatcher: dispatcher.name
          },
          task.id
        );
        this.repo.updateRunStatus(runId, "failed", true);
        return;
      }

      this.repo.appendQueueEvent(
        runId,
        "task_dispatched",
        {
          dispatcher: dispatcher.name,
          summary: dispatchResult.summary
        },
        task.id
      );

      this.repo.updateTaskStatus(task.id, "verifying");

      if (!mustRunVerification(task)) {
        this.repo.updateTaskStatus(task.id, "failed");
        this.repo.appendQueueEvent(
          runId,
          "task_failed",
          {
            reason: "verification_missing",
            summary: "Task has no verification commands configured."
          },
          task.id
        );
        this.repo.updateRunStatus(runId, "failed", true);
        return;
      }

      const report = this.verificationRunner.run(task.id, task.verification.commands);
      this.repo.saveVerificationReport(report);

      if (report.passed) {
        this.repo.updateTaskStatus(task.id, "completed");
        this.repo.appendQueueEvent(runId, "task_completed", undefined, task.id);
      } else {
        this.repo.updateTaskStatus(task.id, "failed");
        this.repo.appendQueueEvent(
          runId,
          "task_failed",
          {
            failingCommand: report.commandResults.at(-1)?.command ?? "unknown"
          },
          task.id
        );
        this.repo.updateRunStatus(runId, "failed", true);
        return;
      }

      task = this.scheduler.next(runId);
    }

    this.repo.updateRunStatus(runId, "completed", true);
    this.repo.appendQueueEvent(runId, "run_completed");
  }
}