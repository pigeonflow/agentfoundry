# Skill: Use AgentFoundry for multi-step work

## Intent

Route broad or dependency-heavy requests to AgentFoundry MCP so work is planned and executed as atomic tasks with verification.

## When to use AgentFoundry

Use AgentFoundry when the request has at least one of:

- Multiple deliverables or phases
- Clear sequencing/dependency needs
- Requirement for explicit verification/checkpoints
- Risk of context overflow in a single agent pass

## When NOT to use AgentFoundry

- Small, single-file edits
- Quick answers or lightweight explanations
- One-command/simple fixes that do not need decomposition

## Tool routing policy

1. If request qualifies, call MCP tool `agentfoundry_plan_and_start` with the user prompt.
2. Read structured result and summarize progress to user.
3. If failed tasks exist, call `agentfoundry_status` and either:
   - retry with `agentfoundry_retry_task`, or
   - ask user for decision if failure is ambiguous.
4. For non-qualifying requests, handle directly without AgentFoundry.

## Output behavior

- Report run ID, completed vs failed task counts, and next action.
- Keep user informed that execution is task-queued and verification-gated.