import { spawnSync } from "node:child_process";
import { DispatchRequest, DispatchResult } from "../../core/types.js";
import { Dispatcher } from "../dispatcher.js";
import { writeTaskPromptArtifact } from "../taskPrompt.js";

export class LocalWorkerDispatcher implements Dispatcher {
  name = "local-worker";

  canHandle(): boolean {
    return true;
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const command = process.env.AGENTFOUNDRY_SUBAGENT_CMD;
    const taskPromptFile = writeTaskPromptArtifact(request.task);

    if (!command) {
      return {
        taskId: request.task.id,
        passedToAgent: false,
        agentName: "local-subagent",
        summary:
          "No AGENTFOUNDRY_SUBAGENT_CMD configured. Real execution requires a subagent command that consumes AF_TASK_PROMPT_FILE."
      };
    }

    const result = spawnSync(command, {
      shell: true,
      encoding: "utf8",
      env: {
        ...process.env,
        AF_TASK_ID: request.task.id,
        AF_RUN_ID: request.task.runId,
        AF_TASK_TITLE: request.task.title,
        AF_TASK_DESCRIPTION: request.task.description,
        AF_TASK_CONTEXT_JSON: JSON.stringify(request.task.contextCapsule),
        AF_TASK_PROMPT_FILE: taskPromptFile,
        AF_CONTEXT_WINDOW_TOKENS: String(request.contextWindowTokens)
      },
      stdio: "pipe"
    });

    const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
    const exitCode = result.status ?? 1;

    return {
      taskId: request.task.id,
      passedToAgent: exitCode === 0,
      agentName: "local-subagent",
      summary:
        exitCode === 0
          ? `Subprocess completed for task. Prompt file: ${taskPromptFile}`
          : `Subprocess failed (${exitCode}): ${output.slice(0, 2400)}`
    };
  }
}