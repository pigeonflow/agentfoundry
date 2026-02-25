import { describe, expect, it } from "vitest";
import { decomposePrompt } from "../src/planner/taskDecomposer.js";
import { evaluatePlanQuality } from "../src/planner/qualityGate.js";

/** Mock sampleFn: returns a minimal valid LLM response given the number of tasks to produce. */
function mockSampleFn(tasks: Array<{ title: string; description: string }>): (prompt: string) => Promise<string> {
  return async (_prompt: string) => JSON.stringify(
    tasks.map((t) => ({
      title: t.title,
      description: t.description,
      acceptanceCriteria: ["Objective is implemented."],
      estimatedEffort: "small",
      relevantFiles: [],
      verificationCommands: ["npm run build"]
    }))
  );
}

describe("planner", () => {
  it("decomposes prompt into sequential tasks", async () => {
    const sampleFn = mockSampleFn([
      { title: "Create CLI command", description: "Add the CLI entry point." },
      { title: "Add tests", description: "Write unit tests." },
      { title: "Update docs", description: "Update README." }
    ]);

    const result = await decomposePrompt("run_1", "Create CLI command. Add tests. Update docs.", sampleFn);

    expect(result.tasks.length).toBe(3);
    expect(result.dependencies.length).toBe(2);
    expect(result.dependencies[0].taskId).toBe(result.tasks[1].id);
    expect(result.dependencies[0].dependsOnTaskId).toBe(result.tasks[0].id);
  });

  it("quality gate flags missing verification commands", async () => {
    const sampleFn = mockSampleFn([
      { title: "Do one thing", description: "Implement the feature." }
    ]);

    const result = await decomposePrompt("run_1", "Do one thing.", sampleFn);
    result.tasks[0].verification.commands = [];
    const quality = evaluatePlanQuality(result.tasks);

    expect(quality.isAcceptable).toBe(false);
    expect(quality.discrepancies.some((item) => item.includes("missing verification commands"))).toBe(true);
  });
});