import { spawnSync } from "node:child_process";
import { VerificationReport } from "../core/types.js";
import { nowIso } from "../core/utils.js";

export class VerificationRunner {
  run(taskId: string, commands: string[]): VerificationReport {
    const commandResults: VerificationReport["commandResults"] = [];
    let passed = true;

    for (const command of commands) {
      const result = spawnSync(command, {
        shell: true,
        encoding: "utf8",
        stdio: "pipe"
      });

      const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
      const exitCode = result.status ?? 1;

      commandResults.push({
        command,
        exitCode,
        output
      });

      if (exitCode !== 0) {
        passed = false;
        break;
      }
    }

    return {
      taskId,
      passed,
      commandResults,
      evaluatedAt: nowIso()
    };
  }
}