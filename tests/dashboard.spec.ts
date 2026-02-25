import { describe, expect, it } from "vitest";
import { Repository } from "../src/db/repository.js";
import { Planner } from "../src/planner/planner.js";
import { getDashboardResource } from "../src/mcp/resources.js";

const mockSampleFn = (tasks: string[]) => async (_prompt: string) =>
  JSON.stringify(tasks.map((title) => ({
    title,
    description: title,
    acceptanceCriteria: ["Done."],
    estimatedEffort: "small",
    relevantFiles: [],
    verificationCommands: ["npm run build"]
  })));

describe("dashboard resource", () => {
  it("returns run cards and active run details", async () => {
    const repo = new Repository(":memory:");
    const planner = new Planner(repo);
    const planned = await planner.createRunFromPrompt("Task one. Task two.", mockSampleFn(["Task one", "Task two"]));

    const payload = getDashboardResource(repo, planned.run.id);
    const runCards = payload.runCards as Array<Record<string, unknown>>;
    const activeRun = payload.activeRun as Record<string, unknown>;

    expect(runCards.length).toBeGreaterThan(0);
    expect(activeRun.runId).toBe(planned.run.id);

    repo.close();
  });
});