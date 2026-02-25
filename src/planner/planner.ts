import { PlanRecord, RunRecord, TaskDependency, TaskRecord } from "../core/types.js";
import { newId, nowIso } from "../core/utils.js";
import { Repository } from "../db/repository.js";
import { evaluatePlanQuality } from "./qualityGate.js";
import { decomposePrompt, SampleFn } from "./taskDecomposer.js";

export interface PlannedRun {
  plan: PlanRecord;
  run: RunRecord;
  tasks: TaskRecord[];
  dependencies: TaskDependency[];
}

export class Planner {
  constructor(private readonly repo: Repository) {}

  async createRunFromPrompt(prompt: string, sampleFn: SampleFn): Promise<PlannedRun> {
    const runId = newId("run");
    const { tasks, dependencies } = await decomposePrompt(runId, prompt, sampleFn);
    const quality = evaluatePlanQuality(tasks);

    const plan: PlanRecord = {
      id: newId("plan"),
      inputPrompt: prompt,
      risks: quality.risks,
      discrepancies: quality.discrepancies,
      createdAt: nowIso()
    };

    const run: RunRecord = {
      id: runId,
      planId: plan.id,
      status: "queued",
      startedAt: nowIso()
    };

    this.repo.savePlan(plan);
    this.repo.saveRun(run);
    this.repo.saveTasks(tasks);
    this.repo.saveDependencies(dependencies);
    this.repo.appendQueueEvent(run.id, "plan_created", {
      taskCount: tasks.length,
      discrepancies: plan.discrepancies,
      risks: plan.risks
    });

    return { plan, run, tasks, dependencies };
  }
}