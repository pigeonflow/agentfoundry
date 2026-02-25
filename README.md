# AgentFoundry

Break a broad prompt into atomic tasks, verify each one actually worked, ship.

LLMs drift on large requests. They lose context, skip steps, and mark things done when they aren't. AgentFoundry forces a structured loop: plan → claim → execute → verify. No task closes unless the build and tests pass.

## What you get

- LLM-driven task decomposition via MCP sampling (your host LLM does the planning)
- SQLite-backed queue with lease tokens — tasks can't be double-claimed
- Verification gate on every task — configurable `build`/`test` commands must pass
- Claim-based execution loop — the calling agent is the worker, not a subprocess
- Local dashboard for run visibility
- Retry, heartbeat, stop, and delete on any run or task

## Setup

```bash
npm install
npm run build
```

Register as an MCP server (stdio):

```json
{
  "servers": {
    "agentfoundry": {
      "type": "stdio",
      "command": "node",
      "args": ["./dist/cli/index.js", "mcp-server"],
      "cwd": "/path/to/do-agi",
      "env": { "AGENTFOUNDRY_DB_PATH": "./agentfoundry.db" }
    }
  }
}
```

## Usage

The full loop from inside any MCP-capable agent:

```
1. agentfoundry_plan_and_start   — decompose prompt into tasks, mark run ready
2. agentfoundry_claim_next_task  — get next task + full execution prompt
3. (do the work with your own tools)
4. agentfoundry_submit_task_result — trigger verification, advance queue
5. repeat until claimed: false
```

To two-step it:

```
agentfoundry_plan        → creates run in queued state
agentfoundry_execute_run → marks it running, promotes ready tasks
```

## MCP Tools

| Tool | What it does |
|---|---|
| `agentfoundry_plan` | Decompose prompt → queued run |
| `agentfoundry_plan_and_start` | Decompose + mark running immediately |
| `agentfoundry_execute_run` | Start a queued run |
| `agentfoundry_claim_next_task` | Lease next task, receive `taskPrompt` |
| `agentfoundry_submit_task_result` | Submit work, run verification |
| `agentfoundry_fail_task` | Mark task failed with reason |
| `agentfoundry_retry_task` | Retry a failed task |
| `agentfoundry_heartbeat_lease` | Extend lease on long-running task |
| `agentfoundry_status` | Full run status + diagnostics |

Resources: `agentfoundry://overview`, `agentfoundry://run/{runId}`

## Dashboard

```bash
npm run dashboard:build
npm run dashboard -- --port=4317
# http://127.0.0.1:4317
```

Live run progress, task status, duration, stop/delete controls.

## Tests

```bash
npm test
```

## License

MIT
