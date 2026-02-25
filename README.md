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
npm run dashboard
npm run dashboard:build
npm run dashboard:dev

# View run status
npm run dev -- status <runId>
npm run dev -- watch <runId>

# Retry a failed task
npm run dev -- retry <taskId>

# Start MCP server on stdio
npm run dev -- mcp-server

# Start local visibility dashboard
npm run dashboard -- --port=4317

# Build and preview Vue dashboard frontend
npm run dashboard:build
npm run dashboard

# Optional: forward built-in runner to your real coding agent
AGENTFOUNDRY_FORWARD_CMD='your-real-agent-cli --prompt-stdin' npm run dev -- run "Implement feature X. Add tests."
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
npm run dev -- mcp-run "Your broad prompt here"
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
	- Broad/multi-step requests -> call `agentfoundry_plan_and_start`.
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

3. Optional: configure a forward command for real coding-agent execution:

```bash
export AGENTFOUNDRY_FORWARD_CMD='your-real-agent-cli --prompt-stdin'
```

4. In OpenClaw routing logic, call MCP tool `agentfoundry_plan_and_start` for broad asks.

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

3. Optional subagent forwarding behavior:

```bash
AGENTFOUNDRY_FORWARD_CMD='your-real-agent-cli --prompt-stdin'
```

4. In your OpenClaw instructions/SKILL, route broad prompts to `agentfoundry_plan_and_start`.

Observed local validation result:

- Running from a separate folder completed a multi-task run and stored queue/run state in that target folder's local DB.

Note: `npm link` may fail on some macOS setups due to global npm permissions. Using absolute `node /.../dist/cli/index.js` is the most reliable local method.

## Notes on dispatch and MCP

Dispatch is adapter-based to support different host environments:

- `local-worker` is always available and uses the built-in subagent runner by default.
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
- `agentfoundry_plan_and_start`
- `agentfoundry_run`
- `agentfoundry_execute_run`
- `agentfoundry_claim_next_task`
- `agentfoundry_heartbeat_lease`
- `agentfoundry_submit_task_result`
- `agentfoundry_fail_task`
- `agentfoundry_status`
- `agentfoundry_retry_task`

Prompt:

- `agentfoundry_task_execution`

## Local Dashboard

AgentFoundry includes a local dashboard for visibility of plans and execution.

The frontend is now a structured Vue 3 + Vite app under `dashboard-ui/`, served by the existing Node dashboard server.

- Run list with status and estimated token usage
- Selected run details with explicit actionable tasks vs task history
- Completion/failure state
- Recent queue events (including dispatch and verification flow)
- Plan prompt visibility for current run

Start it with:

```bash
npm run dashboard:build
npm run dashboard -- --port=4317
```

Then open:

```text
http://127.0.0.1:4317
```

## Important Runtime Notes

If you call `agentfoundry_plan`, the run is created in `queued` state only. To actually execute tasks:

- Call `agentfoundry_run` with `runId`, or
- Call `agentfoundry_execute_run` with `runId` (backward-compatible alias), or
- Call `agentfoundry_plan_and_start` directly (plan + start in one call, then loop `agentfoundry_claim_next_task`).

For coding-agent pull execution (recommended for MCP hosts):

1. Call `agentfoundry_run` (or `agentfoundry_plan` then `agentfoundry_run`) to start/resume a run.
2. Repeatedly call `agentfoundry_claim_next_task` to lease one task at a time.
3. Execute task work in your coding agent.
4. Call `agentfoundry_submit_task_result` when done (or `agentfoundry_fail_task` on failure).
5. Optionally call `agentfoundry_heartbeat_lease` while long tasks are in progress.

This lease-based flow is what enables the coding agent (including me) to be the active worker over MCP, rather than relying on placeholder subprocess success.

If runs fail immediately, check `agentfoundry_status` for `failedTaskDiagnostics` and `recentEvents`.

Common cause: using smoke-test subagent command:

```bash
AGENTFOUNDRY_SUBAGENT_CMD='node -e "process.exit(0)"'
```

This command does not edit code; it only confirms dispatch plumbing. AgentFoundry now includes a built-in runner, so missing `AGENTFOUNDRY_SUBAGENT_CMD` no longer requires placeholders. For real autonomous code changes, set `AGENTFOUNDRY_FORWARD_CMD` so the built-in runner forwards each task prompt to your coding agent CLI.

Retry behavior:

- `agentfoundry_retry_task` now retries the task and resumes the run by default.
- Pass `resumeRun=false` only if you want manual control.

## Next Iteration

- Add richer planner heuristics for independent-but-ordered task graphs.
- Add token accounting from actual model telemetry.
- Add reconciliation loop for partial failures and discrepancy repair tasks.