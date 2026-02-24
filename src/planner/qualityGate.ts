import { TaskRecord } from "../core/types.js";

export interface QualityGateResult {
  risks: string[];
  discrepancies: string[];
  isAcceptable: boolean;
}

export function evaluatePlanQuality(tasks: TaskRecord[]): QualityGateResult {
  const risks: string[] = [];
  const discrepancies: string[] = [];

  if (tasks.length === 0) {
    discrepancies.push("Planner produced zero tasks.");
  }

  if (!tasks.some((task) => task.verification.requireTestPass)) {
    risks.push("No task requires test verification.");
  }

  for (const task of tasks) {
    if (task.contextCapsule.maxContextTokens > 3000) {
      risks.push(`Task ${task.id} may overflow subagent context.`);
    }
    if (task.acceptanceCriteria.length === 0) {
      discrepancies.push(`Task ${task.id} is missing acceptance criteria.`);
    }
    if (task.verification.commands.length === 0) {
      discrepancies.push(`Task ${task.id} is missing verification commands.`);
    }
  }

  return {
    risks,
    discrepancies,
    isAcceptable: discrepancies.length === 0
  };
}