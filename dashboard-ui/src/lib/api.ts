import type { DashboardResponse } from "../types";

export async function fetchDashboard(runId?: string): Promise<DashboardResponse> {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  const response = await fetch(`/api/dashboard${query}`);
  if (!response.ok) {
    throw new Error(`Dashboard API failed: ${response.status}`);
  }
  return (await response.json()) as DashboardResponse;
}

export async function stopRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Stop run failed: ${response.status}`);
  }
}

export async function deleteRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete run failed: ${response.status}`);
  }
}
