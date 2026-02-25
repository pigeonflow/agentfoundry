import { describe, expect, it } from "vitest";
import { Repository } from "../src/db/repository.js";
import { Planner } from "../src/planner/planner.js";
import { Scheduler } from "../src/queue/scheduler.js";

const mockSampleFn = (tasks: string[]) => async (_prompt: string) =>
  JSON.stringify(tasks.map((title) => ({
    title,
    description: title,
    acceptanceCriteria: ["Done."],
    estimatedEffort: "small",
    relevantFiles: [],
    verificationCommands: ["npm run build"]
  })));

describe("task claim leases", () => {
  it("claims one ready task at a time using a lease", async () => {
    const repo = new Repository(":memory:");
    const planner = new Planner(repo);
    const scheduler = new Scheduler(repo);

    const planned = await planner.createRunFromPrompt("Task one. Task two.", mockSampleFn(["Task one", "Task two"]));

    scheduler.promoteReady(planned.run.id);
    const firstClaim = repo.claimNextTask(planned.run.id, "test-agent", 120);
    expect(firstClaim).toBeDefined();
    expect(firstClaim?.task.sequenceOrder).toBe(0);

    const secondClaimBeforeCompletion = repo.claimNextTask(planned.run.id, "test-agent", 120);
    expect(secondClaimBeforeCompletion).toBeUndefined();

    const movedToVerifying = repo.markClaimedTaskVerifying(firstClaim!.task.id, firstClaim!.leaseToken);
    expect(movedToVerifying).toBe(true);
    repo.updateTaskStatus(firstClaim!.task.id, "completed");

    scheduler.promoteReady(planned.run.id);
    const secondClaim = repo.claimNextTask(planned.run.id, "test-agent", 120);
    expect(secondClaim).toBeDefined();
    expect(secondClaim?.task.sequenceOrder).toBe(1);

    repo.close();
  });
});
