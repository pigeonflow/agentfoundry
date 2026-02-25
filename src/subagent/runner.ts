import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function main(): void {
  const runId = requiredEnv("AF_RUN_ID");
  const taskId = requiredEnv("AF_TASK_ID");
  const taskTitle = requiredEnv("AF_TASK_TITLE");
  const taskPromptFile = requiredEnv("AF_TASK_PROMPT_FILE");
  const prompt = readFileSync(taskPromptFile, "utf8");

  const outDir = path.resolve(process.cwd(), ".agentfoundry", "subagent", runId);
  mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, `${taskId}.json`);

  const forwardCommand = process.env.AGENTFOUNDRY_FORWARD_CMD?.trim();
  if (forwardCommand) {
    const result = spawnSync(forwardCommand, {
      shell: true,
      encoding: "utf8",
      input: prompt,
      env: {
        ...process.env,
        AF_TASK_PROMPT: prompt
      },
      stdio: "pipe"
    });

    const output = [result.stdout ?? "", result.stderr ?? ""].join("\n").trim();
    const exitCode = result.status ?? 1;

    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          runId,
          taskId,
          taskTitle,
          mode: "forwarded",
          forwardCommand,
          exitCode,
          output,
          at: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    if (exitCode !== 0) {
      process.stderr.write(output);
      process.exit(exitCode);
    }

    process.stdout.write(`Forwarded task ${taskId} using AGENTFOUNDRY_FORWARD_CMD.\n`);
    return;
  }

  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        runId,
        taskId,
        taskTitle,
        mode: "builtin",
        taskPromptFile,
        note: "Built-in runner executed. Set AGENTFOUNDRY_FORWARD_CMD for real coding agent forwarding.",
        at: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  process.stdout.write(`Built-in runner completed task ${taskId}.\n`);
}

main();