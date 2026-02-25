/**
 * Formats the duration between two points in time.
 * @param startedAt  ISO string of start time
 * @param finishedAt ISO string of end time; if omitted, uses `now` (for live runs)
 */
export function formatDuration(startedAt: string, finishedAt?: string | null, now = Date.now()): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}
