import { TaskDependency, TaskRecord } from "../core/types.js";
import { newId, nowIso, splitPromptIntoAtomicUnits } from "../core/utils.js";

function effortFromText(unit: string): "tiny" | "small" | "medium" | "large" {
  if (unit.length < 60) {
    return "tiny";
  }
  if (unit.length < 140) {
    return "small";
  }
  if (unit.length < 260) {
    return "medium";
  }
  return "large";
}

export function decomposePrompt(runId: string, prompt: string): {
  tasks: TaskRecord[];
  dependencies: TaskDependency[];
} {
  const units = splitPromptIntoAtomicUnits(prompt);
  const createdAt = nowIso();

  const tasks = units.map((unit, index): TaskRecord => {
    const taskId = newId("task");
    return {
      id: taskId,
      runId,
      title: `Task ${index + 1}: ${unit.slice(0, 64)}`,
      description: unit,
      contextCapsule: {
        summary: unit,
        scope: ["Implement only the requested scope for this unit."],
        constraints: [
          "Keep changes minimal and focused.",
          "Preserve existing APIs unless required."
        ],
        relevantFiles: [],
        maxContextTokens: 1800
      },
      acceptanceCriteria: [
        "Task objective is implemented.",
        "No obvious regressions introduced.",
        "Verification commands pass."
      ],
      verification: {
        requireBuildPass: true,
        requireTestPass: true,
        commands: ["npm run build", "npm run test"]
      },
      estimatedEffort: effortFromText(unit),
      status: "pending",
      sequenceOrder: index,
      createdAt,
      updatedAt: createdAt
    };
  });

  const dependencies: TaskDependency[] = [];
  for (let index = 1; index < tasks.length; index += 1) {
    dependencies.push({
      taskId: tasks[index].id,
      dependsOnTaskId: tasks[index - 1].id
    });
  }

  return { tasks, dependencies };
}