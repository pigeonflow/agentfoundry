import { TaskRecord } from "../core/types.js";

export function mustRunVerification(task: TaskRecord): boolean {
  return task.verification.requireBuildPass || task.verification.requireTestPass;
}