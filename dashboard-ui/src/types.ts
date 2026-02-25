export interface RunCard {
  run: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
  };
  snapshot: {
    pending: number;
    ready: number;
    running: number;
    verifying: number;
    completed: number;
    failed: number;
    blocked: number;
  };
  tokenUsage: {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
  };
  spawnedAgents: number;
  dispatchers: string[];
}

export interface DashboardTask {
  id: string;
  title: string;
  status: string;
  sequenceOrder: number;
  leaseOwner?: string;
}

export interface DashboardResponse {
  generatedAt: string;
  runCards: RunCard[];
  activeRun: {
    runId: string;
    run?: { status?: string };
    snapshot: {
      pending: number;
      ready: number;
      running: number;
      verifying: number;
      completed: number;
      failed: number;
      blocked: number;
    };
    tokenUsage: {
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
    };
    tasks: DashboardTask[];
    recentEvents: unknown[];
  } | null;
  activePlan: {
    id: string;
    inputPrompt: string;
  } | null;
}
