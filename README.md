# AgentFoundry

AgentFoundry is a CLI-first AI task manager that turns broad prompts into atomic tasks, persists them in SQLite, dispatches sub-work to agents, and verifies completion through required build/test checks.

## MVP Status

This initial implementation includes:

- Prompt decomposition into sequential atomic tasks.
- Plan quality checks (missing verification, missing criteria, oversized context risk).
- SQLite-backed queue, task state, dependencies, and verification reports.
- Runtime dispatcher abstraction with local worker and MCP adapter paths.
- Real subprocess dispatch hooks for local and MCP execution backends.
- Strict verification gate (`build`/`test` commands) before task completion.
- Official MCP SDK stdio server with resources, tools, and prompts.
- CLI commands for planning, execution, status, watch mode, retry, and MCP server mode.

## Stack

- TypeScript / Node.js
- SQLite (`better-sqlite3`)

## Commands

```bash
npm install
npm run build
npm run test

# Create a run/plan
npm run dev -- plan "Implement feature X. Add tests."

# Plan + execute immediately
npm run dev -- run "Implement feature X. Add tests."

# Plan + execute via MCP client/server loop (dogfood path)
npm run dev -- mcp-run "Implement feature X. Add tests."

# View run status
npm run dev -- status <runId>
npm run dev -- watch <runId>

# Retry a failed task
npm run dev -- retry <taskId>

# Start MCP server on stdio
npm run dev -- mcp-server

# Use a real subprocess as subagent dispatcher
AGENTFOUNDRY_SUBAGENT_CMD='node -e "process.exit(0)"' npm run dev -- run "Implement feature X. Add tests."
```

For `mcp-run`, the CLI auto-spawns `mcp-server`. Override server start command with:

```bash
AGENTFOUNDRY_MCP_SERVER_CMD='node dist/cli/index.js mcp-server' npm run dev -- mcp-run "..."
```

## Notes on dispatch and MCP

Dispatch is adapter-based to support different host environments:

- `local-worker` is always available and can execute `AGENTFOUNDRY_SUBAGENT_CMD`.
- `mcp-adapter` is selected when `AGENTFOUNDRY_MCP_DISPATCH_CMD` is set.

This keeps the queue/state model stable while allowing host-specific subagent handoff behavior for OpenClaw, Claude/Codex wrappers, or future MCP-native routing.

Subagent processes receive:

- `AF_TASK_ID`, `AF_RUN_ID`
- `AF_TASK_TITLE`, `AF_TASK_DESCRIPTION`
- `AF_TASK_CONTEXT_JSON`
- `AF_TASK_PROMPT_FILE` (artifact file generated under `.agentfoundry/runs/<runId>/`)
- `AF_CONTEXT_WINDOW_TOKENS`

## MCP Surface

Resources:

- `agentfoundry://overview`
- `agentfoundry://run/{runId}`

Tools:

- `agentfoundry_plan`
- `agentfoundry_run`
- `agentfoundry_status`
- `agentfoundry_retry_task`

Prompt:

- `agentfoundry_task_execution`

## Next Iteration

- Add richer planner heuristics for independent-but-ordered task graphs.
- Add token accounting from actual model telemetry.
- Add reconciliation loop for partial failures and discrepancy repair tasks.