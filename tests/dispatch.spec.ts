import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TaskRecord } from "../src/core/types.js";
import { writeTaskPromptArtifact } from "../src/dispatch/taskPrompt.js";

function sampleTask(): TaskRecord {
  return {
    id: "task_1",
    runId: "run_1",
    title: "Task 1",
    description: "Implement command wiring.",
    contextCapsule: {
      summary: "Implement command wiring.",
      scope: ["Wire command parser"],
      constraints: ["Do not break existing APIs"],
      relevantFiles: ["src/cli/index.ts"],
      maxContextTokens: 1500
    },
    acceptanceCriteria: ["Command works"],
    verification: {
      commands: ["npm run build"]
    },
    estimatedEffort: "small",
    status: "pending",
    sequenceOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("dispatch prompt artifact", () => {
  it("writes task prompt file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agentfoundry-test-"));
    try {
      const filePath = writeTaskPromptArtifact(sampleTask(), root);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8");
      expect(content.includes("## Objective")).toBe(true);
      expect(content.includes("Implement command wiring.")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});