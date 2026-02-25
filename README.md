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

# Shortcut equivalents
npm run mcp-run -- "Implement feature X. Add tests."
npm run mcp-server

# View run status
npm run dev -- status <runId>
npm run dev -- watch <runId>

# Retry a failed task
npm run dev -- retry <taskId>

# Start MCP server on stdio
npm run dev -- mcp-server

# Use a real subprocess as subagent dispatcher
AGENTFOUNDRY_SUBAGENT_CMD='/absolute/path/to/subagent-runner.sh' npm run dev -- run "Implement feature X. Add tests."
```

## Local Setup (Recommended)

If you want to use AgentFoundry with me in this workspace right now, you do **not** need a separate always-on MCP server process.

1. Install/build once:

```bash
npm install
npm run build
```

2. Run through MCP path directly (auto-spawns MCP server):

```bash
AGENTFOUNDRY_SUBAGENT_CMD='/absolute/path/to/subagent-runner.sh' npm run dev -- mcp-run "Your broad prompt here"
```

This is the easiest path for local Copilot-style collaboration because it validates the full MCP flow without extra editor configuration.

## MCP Client Registration (Optional)

Use this only if you want another MCP-capable client to call `agentfoundry_*` tools directly.

- You usually **do not** run `mcp-server` manually.
- MCP clients spawn the server command themselves over stdio.
- Client config format varies by host; use [mcp.server.example.json](mcp.server.example.json) as a template.
- For OpenClaw-style hosts, see [openclaw.mcp.example.json](openclaw.mcp.example.json).

For `mcp-run`, the CLI auto-spawns `mcp-server`. Override server start command with:

```bash
AGENTFOUNDRY_MCP_SERVER_CMD='node dist/cli/index.js mcp-server' npm run dev -- mcp-run "..."
```

## OpenClaw Integration (Recommended)

For a seamless OSS user flow, prefer this architecture:

1. **MCP is the integration boundary** (stable, explicit tools/resources).
2. **OpenClaw route policy decides when to call AgentFoundry**:
	- Broad/multi-step requests -> call `agentfoundry_plan_and_run`.
	- Small/single-file requests -> handle directly.
3. **SKILL is optional** and best used as a prompt-policy layer (classification and routing hints), not as the primary execution substrate.

Why this split:

- MCP gives interoperability and observability across hosts.
- SKILL can improve routing quality but should not be required for baseline functionality.

### Minimal local setup for OpenClaw host

1. Build once:

```bash
npm install
npm run build
```

2. Register the MCP server command in the host (stdio):

- command: `node`
- args: `dist/cli/index.js mcp-server`
- cwd: repo root

3. Optional: configure subagent command:

```bash
export AGENTFOUNDRY_SUBAGENT_CMD='node -e "process.exit(0)"'
```

4. In OpenClaw routing logic, call MCP tool `agentfoundry_plan_and_run` for broad asks.

### MCP vs SKILL (best practice)

- **MCP** should be the execution contract (tools/resources/prompts, stable API, observability).
- **SKILL** should be the routing policy (when to call AgentFoundry vs when to handle directly).

In other words: use both, but keep MCP as the hard integration boundary and SKILL as decision logic.

## Validate in Another Project (exact local flow)

This mirrors your target setup: different VS Code workspace/chat, but using this local AgentFoundry MCP server.

1. Build AgentFoundry once:

```bash
cd /path/to/do-agi
npm install
npm run build
```

2. In the **other project folder**, register MCP server command to point to this build:

- command: `node`
- args: `/absolute/path/to/do-agi/dist/cli/index.js mcp-server`
- cwd: other project root

3. Optional subagent behavior:

```bash
AGENTFOUNDRY_SUBAGENT_CMD='your real subagent command'
```

4. In your OpenClaw instructions/SKILL, route broad prompts to `agentfoundry_plan_and_run`.

Observed local validation result:

- Running from a separate folder completed a multi-task run and stored queue/run state in that target folder's local DB.

Note: `npm link` may fail on some macOS setups due to global npm permissions. Using absolute `node /.../dist/cli/index.js` is the most reliable local method.

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
- `agentfoundry_plan_and_run`
- `agentfoundry_run`
- `agentfoundry_execute_run`
- `agentfoundry_status`
- `agentfoundry_retry_task`

Prompt:

- `agentfoundry_task_execution`

## Important Runtime Notes

If you call `agentfoundry_plan`, the run is created in `queued` state only. To actually execute tasks:

- Call `agentfoundry_run` with `runId`, or
- Call `agentfoundry_execute_run` with `runId` (backward-compatible alias), or
- Call `agentfoundry_plan_and_run` directly (plan + execute in one call).

If runs fail immediately, check `agentfoundry_status` for `failedTaskDiagnostics` and `recentEvents`.

Common cause: using smoke-test subagent command:

```bash
AGENTFOUNDRY_SUBAGENT_CMD='node -e "process.exit(0)"'
```

This command does not edit code; it only confirms dispatch plumbing. AgentFoundry now treats missing subagent command as a hard failure. For real autonomous implementation, set `AGENTFOUNDRY_SUBAGENT_CMD` to a real coding agent invocation that can read `AF_TASK_PROMPT_FILE` and modify the target project.

Retry behavior:

- `agentfoundry_retry_task` now retries the task and resumes the run by default.
- Pass `resumeRun=false` only if you want manual control.

## Next Iteration

- Add richer planner heuristics for independent-but-ordered task graphs.
- Add token accounting from actual model telemetry.
- Add reconciliation loop for partial failures and discrepancy repair tasks.