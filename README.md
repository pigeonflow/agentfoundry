# AgentFoundry

Break a broad prompt into atomic tasks, verify each one actually worked, ship.

LLMs drift on large requests. They lose context, skip steps, and mark things done when they aren't. AgentFoundry forces a structured loop: plan → claim → execute → verify. No task closes unless the build and tests pass.

## Install

```bash
npm install -g agentfoundry
```

Or use directly with npx — no install needed.

## Quick Start: Add to Your MCP Client

### VS Code / Copilot Chat

Add to your `.vscode/mcp.json`:

- With npx:

```json
{
  "servers": {
    "agentfoundry": {
      "command": "npx",
      "args": ["agentfoundry", "mcp-server"]
    }
  }
}
```

- With global install (`npm install -g agentfoundry`):

```json
{
  "servers": {
    "agentfoundry": {
      "command": "agentfoundry",
      "args": ["mcp-server"]
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

- With npx:

```json
{
  "mcpServers": {
    "agentfoundry": {
      "command": "npx",
      "args": ["agentfoundry", "mcp-server"]
    }
  }
}
```

- With global install (`npm install -g agentfoundry`):

```json
{
  "mcpServers": {
    "agentfoundry": {
      "command": "agentfoundry",
      "args": ["mcp-server"]
    }
  }
}
```

That's it. Two lines. The MCP server manages its own SQLite database automatically.

### Optional Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENTFOUNDRY_DB_PATH` | `./agentfoundry.db` | Custom database location |
| `AGENTFOUNDRY_FORWARD_CMD` | — | External agent CLI for task dispatch |

## What You Get

- Plan-gated execution flow — a plan must be submitted before tasks can be added
- SQLite-backed queue with lease tokens — tasks can't be double-claimed
- Verification gate on every task — agent-defined verification commands must pass
- Claim-based execution loop — the calling agent is the worker, not a subprocess
- Local dashboard for run visibility
- Retry, heartbeat, stop, and delete on any run or task

## Usage

The full loop from inside any MCP-capable agent:

```
1. agentfoundry_submit_plan         — submit plan, receive queued runId
2. agentfoundry_add_tasks_and_start — add ordered tasks, start run
3. agentfoundry_claim_next_task     — get next task + full execution prompt
4. (do the work with your own tools)
5. agentfoundry_submit_task_result  — trigger verification, advance queue
6. repeat until claimed: false
```

## Planning for Best Results

For long or complex work, your biggest failure modes are:

- losing context between turns,
- re-explaining intent when switching clients,
- tasks that are too broad to verify reliably.

Use `agentfoundry_submit_plan` to capture durable planning context once, then use `agentfoundry_add_tasks_and_start` to inject explicit, verifiable tasks.

### Example: `agentfoundry_submit_plan`

```json
{
  "prompt": "Refactor auth flow and add session hardening.",
  "planSummary": "Split into migration-safe phases: inspect current auth/session boundaries, implement hardening changes, update integration points, then validate with targeted and full-suite checks. Preserve existing public APIs unless explicitly changed.",
  "risks": [
    "Session invalidation edge cases may break active users.",
    "Middleware order changes may alter route behavior."
  ],
  "discrepancies": [
    "Auth ownership is split across API and web packages.",
    "Test coverage for cookie expiration is currently thin."
  ]
}
```

### Example: `agentfoundry_add_tasks_and_start`

`verificationCommands` are required per task and should match the repository's tooling (`pnpm`, `yarn`, `npm`, `cargo`, `go test`, `make`, etc.).

```json
{
  "runId": "run_abc123",
  "tasks": [
    {
      "title": "Audit auth/session boundaries",
      "description": "Map login, refresh, and logout flows across API and web layers. Produce a concise boundary summary used by all downstream tasks.",
      "acceptanceCriteria": [
        "Boundary summary identifies token issuance and invalidation points.",
        "Relevant files and dependency edges are documented in task output."
      ],
      "relevantFiles": ["src/auth", "src/session", "src/middleware"],
      "verificationCommands": ["pnpm -r test --filter auth"]
    },
    {
      "title": "Implement session hardening updates",
      "description": "Apply cookie/session security updates and adjust middleware sequencing without breaking current route contracts.",
      "acceptanceCriteria": [
        "Secure session settings are enforced.",
        "Existing auth route behavior remains compatible."
      ],
      "relevantFiles": ["src/session/config.ts", "src/middleware/auth.ts"],
      "verificationCommands": ["pnpm build", "pnpm test"]
    },
    {
      "title": "Add regression tests for session invalidation",
      "description": "Cover refresh/logout invalidation paths and expiry behavior to prevent regressions.",
      "acceptanceCriteria": [
        "Invalidation tests fail before fix and pass after fix.",
        "Expiry behavior is asserted for primary edge cases."
      ],
      "relevantFiles": ["tests/auth", "tests/session"],
      "verificationCommands": ["pnpm test -- tests/auth/session-invalidation.spec.ts"]
    }
  ]
}
```

## Cross-Client Handoff Pattern

To switch from one MCP client to another without re-planning:

1. Keep `runId` from `agentfoundry_submit_plan`.
2. Store the same task list used for `agentfoundry_add_tasks_and_start`.
3. In the new client, continue with:
   - `agentfoundry_status` (recover state)
   - `agentfoundry_claim_next_task` (resume work)
   - `agentfoundry_submit_task_result` (advance queue)

This avoids repeating plan context and keeps the queue state authoritative.

## MCP Tools

| Tool | What it does |
|---|---|
| `agentfoundry_submit_plan` | Submit a plan, create queued run (required first step) |
| `agentfoundry_add_tasks_and_start` | Add ordered tasks (with required verification commands) to queued run and start it |
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
npx agentfoundry dashboard --port 4317
agentfoundry dashboard --port 4317
# http://127.0.0.1:4317
```

Live run progress, task status, duration, stop/delete controls.

## CLI

```bash
npx agentfoundry status          # show all runs
npx agentfoundry watch <runId>   # watch run progress
npx agentfoundry dashboard --port 4317

agentfoundry status          # show all runs (global install)
agentfoundry watch <runId>   # watch run progress (global install)
agentfoundry dashboard --port 4317
```

## Generate SKILL.md

Use the CLI to print a ready-to-save `SKILL.md` template for OpenClaw or other skill-driven agents:

```bash
npx agentfoundry --get-skill > SKILL.md
agentfoundry --get-skill > SKILL.md
```

Compatibility alias (common typo) is also supported:

```bash
agentfoundry --get-skil > SKILL.md
```

## Contributing

```bash
git clone https://github.com/pigeonflow/agentfoundry.git
cd agentfoundry
npm install
npm run build
npm test
```

## License

MIT
