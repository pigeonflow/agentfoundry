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

describe("scheduler", () => {
  it("promotes only dependency-ready tasks", async () => {
    const repo = new Repository(":memory:");
    const planner = new Planner(repo);
    const scheduler = new Scheduler(repo);

    const planned = await planner.createRunFromPrompt("First task. Second task.", mockSampleFn(["First task", "Second task"]));
    const firstReady = scheduler.promoteReady(planned.run.id);
    expect(firstReady.length).toBe(1);

    repo.updateTaskStatus(firstReady[0].id, "completed");
    const secondReady = scheduler.promoteReady(planned.run.id);
    expect(secondReady.length).toBe(1);
    expect(secondReady[0].id).toBe(planned.tasks[1].id);

    repo.close();
  });
});