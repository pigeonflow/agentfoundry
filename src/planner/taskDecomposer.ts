import { TaskDependency, TaskRecord } from "../core/types.js";
import { newId, nowIso } from "../core/utils.js";

/**
 * Callback supplied by the caller (e.g. MCP server) that sends a prompt to
 * the connected LLM via MCP sampling and returns the raw text response.
 */
export type SampleFn = (prompt: string) => Promise<string>;

interface RawTask {
  title?: unknown;
  description?: unknown;
  acceptanceCriteria?: unknown;
  estimatedEffort?: unknown;
  relevantFiles?: unknown;
  verificationCommands?: unknown;
}

const DECOMPOSE_SYSTEM = `You are an expert software engineering planner embedded inside an AI task orchestration system (AgentFoundry).

Your job: decompose a high-level goal into a list of ATOMIC, independently executable coding tasks for a coding agent to carry out one at a time.

Rules:
- Return ONLY a raw JSON array — no markdown fences, no prose, no explanation.
- 3 to 15 tasks maximum. Fewer high-quality tasks beats many vague ones.
- Each task must be a concrete, actionable implementation step with clear done-criteria.
- Title must be an imperative verb phrase: e.g. "Install Tailwind CSS dependencies in package.json".
- Tasks are executed sequentially; each implicitly depends on the previous.
- relevantFiles: list every file that will be CREATED or MODIFIED.
- verificationCommands: shell commands that confirm success (e.g. "npm run build", "npm test").
- estimatedEffort: one of "tiny" | "small" | "medium" | "large".

JSON schema (array of objects):
[
  {
    "title": "string",
    "description": "string — full context a coding agent needs",
    "acceptanceCriteria": ["string"],
    "estimatedEffort": "tiny|small|medium|large",
    "relevantFiles": ["relative/path/to/file"],
    "verificationCommands": ["shell command"]
  }
]`;

function parseTasksFromLlm(raw: string): RawTask[] {
  // Strip optional markdown fences the LLM may wrap around the JSON
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error(`LLM returned non-array JSON: ${cleaned.slice(0, 200)}`);
  }
  return parsed as RawTask[];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toEffort(value: unknown): "tiny" | "small" | "medium" | "large" {
  if (value === "tiny" || value === "small" || value === "medium" || value === "large") return value;
  return "medium";
}

export async function decomposePrompt(
  runId: string,
  prompt: string,
  sampleFn: SampleFn
): Promise<{ tasks: TaskRecord[]; dependencies: TaskDependency[] }> {
  const llmPrompt = `${DECOMPOSE_SYSTEM}\n\nGoal:\n${prompt}`;
  const raw = await sampleFn(llmPrompt);
  const rawTasks = parseTasksFromLlm(raw);

  if (rawTasks.length === 0) {
    throw new Error("LLM returned an empty task list.");
  }

  const createdAt = nowIso();

  const tasks = rawTasks.map((raw, index): TaskRecord => {
    const taskId = newId("task");
    const title = typeof raw.title === "string" ? raw.title : `Task ${index + 1}`;
    const description = typeof raw.description === "string" ? raw.description : title;
    const verificationCommands = toStringArray(raw.verificationCommands);
    if (verificationCommands.length === 0) {
      throw new Error(`Task ${index + 1} is missing verificationCommands.`);
    }

    return {
      id: taskId,
      runId,
      title,
      description,
      contextCapsule: {
        summary: description,
        scope: toStringArray(raw.acceptanceCriteria),
        constraints: ["Keep changes minimal and focused.", "Preserve existing APIs unless explicitly required."],
        relevantFiles: toStringArray(raw.relevantFiles),
        maxContextTokens: 2400
      },
      acceptanceCriteria: toStringArray(raw.acceptanceCriteria).length > 0
        ? toStringArray(raw.acceptanceCriteria)
        : ["Task objective is implemented.", "Verification commands pass."],
      verification: {
        commands: verificationCommands
      },
      estimatedEffort: toEffort(raw.estimatedEffort),
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