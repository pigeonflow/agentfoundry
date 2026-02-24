export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "blocked";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface TaskContextCapsule {
  summary: string;
  scope: string[];
  constraints: string[];
  relevantFiles: string[];
  maxContextTokens: number;
}

export interface VerificationPolicy {
  requireBuildPass: boolean;
  requireTestPass: boolean;
  commands: string[];
}

export interface TaskRecord {
  id: string;
  runId: string;
  title: string;
  description: string;
  contextCapsule: TaskContextCapsule;
  acceptanceCriteria: string[];
  verification: VerificationPolicy;
  estimatedEffort: "tiny" | "small" | "medium" | "large";
  status: TaskStatus;
  sequenceOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  taskId: string;
  dependsOnTaskId: string;
}

export interface PlanRecord {
  id: string;
  inputPrompt: string;
  risks: string[];
  discrepancies: string[];
  createdAt: string;
}

export interface RunRecord {
  id: string;
  planId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
}

export interface VerificationReport {
  taskId: string;
  passed: boolean;
  commandResults: Array<{
    command: string;
    exitCode: number;
    output: string;
  }>;
  evaluatedAt: string;
}

export interface DispatchRequest {
  task: TaskRecord;
  contextWindowTokens: number;
}

export interface DispatchResult {
  taskId: string;
  passedToAgent: boolean;
  agentName: string;
  summary: string;
}

export interface QueueSnapshot {
  pending: number;
  ready: number;
  running: number;
  verifying: number;
  completed: number;
  failed: number;
  blocked: number;
}

export interface TokenUsageSummary {
  runId: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}