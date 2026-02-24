import { spawnSync } from "node:child_process";
import { DispatchRequest, DispatchResult } from "../../core/types.js";
import { Dispatcher } from "../dispatcher.js";
import { writeTaskPromptArtifact } from "../taskPrompt.js";

export class McpDispatcher implements Dispatcher {
  name = "mcp-adapter";

  canHandle(): boolean {
    return Boolean(process.env.AGENTFOUNDRY_MCP_DISPATCH_CMD);
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const command = process.env.AGENTFOUNDRY_MCP_DISPATCH_CMD;
    if (!command) {
      return {
        taskId: request.task.id,
        passedToAgent: false,
        agentName: "mcp-subagent",
        summary: "AGENTFOUNDRY_MCP_DISPATCH_CMD is not configured."
      };
    }

    const taskPromptFile = writeTaskPromptArtifact(request.task);
    const result = spawnSync(command, {
      shell: true,
      encoding: "utf8",
      env: {
        ...process.env,
        AF_TASK_ID: request.task.id,
        AF_RUN_ID: request.task.runId,
        AF_TASK_PROMPT_FILE: taskPromptFile,
        AF_TASK_CONTEXT_JSON: JSON.stringify(request.task.contextCapsule),
        AF_CONTEXT_WINDOW_TOKENS: String(request.contextWindowTokens)
      },
      stdio: "pipe"
    });

    const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
    const exitCode = result.status ?? 1;

    return {
      taskId: request.task.id,
      passedToAgent: exitCode === 0,
      agentName: "mcp-subagent",
      summary:
        exitCode === 0
          ? `MCP dispatch command completed. Prompt file: ${taskPromptFile}`
          : `MCP dispatch command failed (${exitCode}): ${output.slice(0, 2400)}`
    };
  }
}