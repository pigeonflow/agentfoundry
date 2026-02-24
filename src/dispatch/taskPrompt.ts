import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TaskRecord } from "../core/types.js";

export function buildTaskPrompt(task: TaskRecord): string {
  return [
    `# ${task.title}`,
    "",
    "## Objective",
    task.description,
    "",
    "## Context Capsule",
    `Summary: ${task.contextCapsule.summary}`,
    "",
    "### Scope",
    ...task.contextCapsule.scope.map((item) => `- ${item}`),
    "",
    "### Constraints",
    ...task.contextCapsule.constraints.map((item) => `- ${item}`),
    "",
    "### Relevant Files",
    ...(task.contextCapsule.relevantFiles.length > 0
      ? task.contextCapsule.relevantFiles.map((item) => `- ${item}`)
      : ["- (none specified)"]),
    "",
    "## Acceptance Criteria",
    ...task.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "## Verification",
    ...task.verification.commands.map((item) => `- ${item}`)
  ].join("\n");
}

export function writeTaskPromptArtifact(task: TaskRecord, rootDir = ".agentfoundry"): string {
  const runDir = path.resolve(process.cwd(), rootDir, "runs", task.runId);
  mkdirSync(runDir, { recursive: true });
  const filePath = path.join(runDir, `${task.id}.md`);
  writeFileSync(filePath, buildTaskPrompt(task), "utf8");
  return filePath;
}