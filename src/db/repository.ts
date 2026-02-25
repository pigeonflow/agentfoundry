import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  PlanRecord,
  QueueSnapshot,
  RunRecord,
  RunStatus,
  TaskDependency,
  TaskRecord,
  TaskStatus,
  TokenUsageSummary,
  VerificationReport
} from "../core/types.js";
import { nowIso } from "../core/utils.js";

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  input_prompt TEXT NOT NULL,
  risks_json TEXT NOT NULL,
  discrepancies_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  context_capsule_json TEXT NOT NULL,
  acceptance_criteria_json TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  estimated_effort TEXT NOT NULL,
  status TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS queue_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  report_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_leases (
  task_id TEXT PRIMARY KEY,
  lease_token TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
`;

type TaskRow = {
  id: string;
  run_id: string;
  title: string;
  description: string;
  context_capsule_json: string;
  acceptance_criteria_json: string;
  verification_json: string;
  estimated_effort: "tiny" | "small" | "medium" | "large";
  status: TaskStatus;
  sequence_order: number;
  created_at: string;
  updated_at: string;
};

export class Repository {
  private db: Database.Database;

  constructor(dbPath = "./agentfoundry.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  savePlan(plan: PlanRecord): void {
    this.db
      .prepare(
        `INSERT INTO plans (id, input_prompt, risks_json, discrepancies_json, created_at)
         VALUES (@id, @input_prompt, @risks_json, @discrepancies_json, @created_at)`
      )
      .run({
        id: plan.id,
        input_prompt: plan.inputPrompt,
        risks_json: JSON.stringify(plan.risks),
        discrepancies_json: JSON.stringify(plan.discrepancies),
        created_at: plan.createdAt
      });
  }

  getPlan(planId: string): PlanRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, input_prompt, risks_json, discrepancies_json, created_at
         FROM plans
         WHERE id = ?`
      )
      .get(planId) as
      | {
          id: string;
          input_prompt: string;
          risks_json: string;
          discrepancies_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      inputPrompt: row.input_prompt,
      risks: JSON.parse(row.risks_json) as string[],
      discrepancies: JSON.parse(row.discrepancies_json) as string[],
      createdAt: row.created_at
    };
  }

  saveRun(run: RunRecord): void {
    this.db
      .prepare(
        `INSERT INTO runs (id, plan_id, status, started_at, finished_at)
         VALUES (@id, @plan_id, @status, @started_at, @finished_at)`
      )
      .run({
        id: run.id,
        plan_id: run.planId,
        status: run.status,
        started_at: run.startedAt,
        finished_at: run.finishedAt ?? null
      });
  }

  getRun(runId: string): RunRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, plan_id, status, started_at, finished_at
         FROM runs
         WHERE id = ?`
      )
      .get(runId) as
      | {
          id: string;
          plan_id: string;
          status: RunStatus;
          started_at: string;
          finished_at: string | null;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      planId: row.plan_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined
    };
  }

  listRuns(limit = 20): RunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, plan_id, status, started_at, finished_at
         FROM runs
         ORDER BY started_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      plan_id: string;
      status: RunStatus;
      started_at: string;
      finished_at: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined
    }));
  }

  saveTasks(tasks: TaskRecord[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO tasks (
          id, run_id, title, description, context_capsule_json, acceptance_criteria_json,
          verification_json, estimated_effort, status, sequence_order, created_at, updated_at
        ) VALUES (
          @id, @run_id, @title, @description, @context_capsule_json, @acceptance_criteria_json,
          @verification_json, @estimated_effort, @status, @sequence_order, @created_at, @updated_at
        )`
    );
    const tx = this.db.transaction((rows: TaskRecord[]) => {
      for (const task of rows) {
        stmt.run({
          id: task.id,
          run_id: task.runId,
          title: task.title,
          description: task.description,
          context_capsule_json: JSON.stringify(task.contextCapsule),
          acceptance_criteria_json: JSON.stringify(task.acceptanceCriteria),
          verification_json: JSON.stringify(task.verification),
          estimated_effort: task.estimatedEffort,
          status: task.status,
          sequence_order: task.sequenceOrder,
          created_at: task.createdAt,
          updated_at: task.updatedAt
        });
      }
    });
    tx(tasks);
  }

  saveDependencies(dependencies: TaskDependency[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id)
       VALUES (@task_id, @depends_on_task_id)`
    );
    const tx = this.db.transaction((rows: TaskDependency[]) => {
      for (const dependency of rows) {
        stmt.run({
          task_id: dependency.taskId,
          depends_on_task_id: dependency.dependsOnTaskId
        });
      }
    });
    tx(dependencies);
  }

  listTasks(runId: string): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE run_id = ?
         ORDER BY sequence_order ASC`
      )
      .all(runId) as TaskRow[];

    return rows.map((row) => this.fromTaskRow(row));
  }

  getTask(taskId: string): TaskRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId) as
      | TaskRow
      | undefined;

    if (!row) {
      return undefined;
    }
    return this.fromTaskRow(row);
  }

  getReadyTasks(runId: string): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT t.*
         FROM tasks t
         WHERE t.run_id = @run_id
           AND t.status IN ('pending', 'ready')
           AND NOT EXISTS (
             SELECT 1
             FROM task_dependencies td
             JOIN tasks dep ON dep.id = td.depends_on_task_id
             WHERE td.task_id = t.id
               AND dep.status != 'completed'
           )
         ORDER BY t.sequence_order ASC`
      )
      .all({ run_id: runId }) as TaskRow[];

    return rows.map((row) => this.fromTaskRow(row));
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.db
      .prepare(
        `UPDATE tasks
         SET status = @status,
             updated_at = @updated_at
         WHERE id = @task_id`
      )
      .run({ status, updated_at: nowIso(), task_id: taskId });
  }

  updateRunStatus(runId: string, status: RunStatus, finished = false): void {
    this.db
      .prepare(
        `UPDATE runs
         SET status = @status,
             finished_at = CASE
               WHEN @finished = 1 THEN @finished_at
               WHEN @status IN ('queued', 'running') THEN NULL
               ELSE finished_at
             END
         WHERE id = @run_id`
      )
      .run({
        status,
        finished: finished ? 1 : 0,
        finished_at: finished ? nowIso() : null,
        run_id: runId
      });
  }

  claimNextTask(
    runId: string,
    leaseOwner: string,
    leaseTtlSeconds = 86400
  ): { task: TaskRecord; leaseToken: string; leaseExpiresAt: string } | undefined {
    const now = nowIso();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + leaseTtlSeconds * 1000).toISOString();

    const tx = this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `SELECT t.id
           FROM tasks t
           WHERE t.run_id = @run_id
             AND t.status IN ('pending', 'ready')
             AND NOT EXISTS (
               SELECT 1
               FROM task_dependencies td
               JOIN tasks dep ON dep.id = td.depends_on_task_id
               WHERE td.task_id = t.id
                 AND dep.status != 'completed'
             )
           ORDER BY t.sequence_order ASC
           LIMIT 1`
        )
        .get({ run_id: runId }) as { id: string } | undefined;

      if (!candidate) {
        return undefined;
      }

      const statusUpdate = this.db
        .prepare(
          `UPDATE tasks
           SET status = 'running',
               updated_at = @updated_at
           WHERE id = @task_id
             AND status IN ('pending', 'ready')`
        )
        .run({ task_id: candidate.id, updated_at: now });

      if (statusUpdate.changes === 0) {
        return undefined;
      }

      this.db.prepare(`DELETE FROM task_leases WHERE task_id = @task_id`).run({ task_id: candidate.id });

      this.db
        .prepare(
          `INSERT INTO task_leases (
             task_id,
             lease_token,
             lease_owner,
             lease_expires_at,
             heartbeat_at,
             created_at
           ) VALUES (
             @task_id,
             @lease_token,
             @lease_owner,
             @lease_expires_at,
             @heartbeat_at,
             @created_at
           )`
        )
        .run({
          task_id: candidate.id,
          lease_token: leaseToken,
          lease_owner: leaseOwner,
          lease_expires_at: leaseExpiresAt,
          heartbeat_at: now,
          created_at: now
        });

      return candidate.id;
    });

    const taskId = tx();
    if (!taskId) {
      return undefined;
    }

    const task = this.getTask(taskId);
    if (!task) {
      return undefined;
    }

    return {
      task,
      leaseToken,
      leaseExpiresAt
    };
  }

  getActiveLeaseForRun(
    runId: string,
    leaseOwner: string
  ): { taskId: string; leaseToken: string; leaseExpiresAt: string } | undefined {
    const now = nowIso();
    const row = this.db
      .prepare(
        `SELECT l.task_id, l.lease_token, l.lease_expires_at
         FROM task_leases l
         JOIN tasks t ON t.id = l.task_id
         WHERE t.run_id = @run_id
           AND t.status = 'running'
           AND l.lease_owner = @lease_owner
           AND l.lease_expires_at > @now
         ORDER BY t.sequence_order ASC
         LIMIT 1`
      )
      .get({ run_id: runId, lease_owner: leaseOwner, now }) as
      | {
          task_id: string;
          lease_token: string;
          lease_expires_at: string;
        }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      taskId: row.task_id,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at
    };
  }

  heartbeatTaskLease(
    taskId: string,
    leaseToken: string,
    leaseTtlSeconds = 86400
  ): { ok: boolean; leaseExpiresAt?: string } {
    const now = nowIso();
    const leaseExpiresAt = new Date(Date.now() + leaseTtlSeconds * 1000).toISOString();

    const updated = this.db
      .prepare(
        `UPDATE task_leases
         SET lease_expires_at = @lease_expires_at,
             heartbeat_at = @heartbeat_at
         WHERE task_id = @task_id
           AND lease_token = @lease_token
           AND lease_expires_at > @now`
      )
      .run({
        task_id: taskId,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        heartbeat_at: now,
        now
      });

    if (updated.changes === 0) {
      return { ok: false };
    }

    return {
      ok: true,
      leaseExpiresAt
    };
  }

  markClaimedTaskVerifying(taskId: string, leaseToken: string): boolean {
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const lease = this.db
        .prepare(
          `SELECT task_id
           FROM task_leases
           WHERE task_id = @task_id
             AND lease_token = @lease_token
             AND lease_expires_at > @now`
        )
        .get({ task_id: taskId, lease_token: leaseToken, now }) as { task_id: string } | undefined;

      if (!lease) {
        return false;
      }

      this.db.prepare(`DELETE FROM task_leases WHERE task_id = @task_id`).run({ task_id: taskId });

      const updated = this.db
        .prepare(
          `UPDATE tasks
           SET status = 'verifying',
               updated_at = @updated_at
           WHERE id = @task_id
             AND status = 'running'`
        )
        .run({ task_id: taskId, updated_at: now });

      return updated.changes > 0;
    });

    return tx();
  }

  failClaimedTask(taskId: string, leaseToken: string): boolean {
    const now = nowIso();
    const tx = this.db.transaction(() => {
      const lease = this.db
        .prepare(
          `SELECT task_id
           FROM task_leases
           WHERE task_id = @task_id
             AND lease_token = @lease_token
             AND lease_expires_at > @now`
        )
        .get({ task_id: taskId, lease_token: leaseToken, now }) as { task_id: string } | undefined;

      if (!lease) {
        return false;
      }

      this.db.prepare(`DELETE FROM task_leases WHERE task_id = @task_id`).run({ task_id: taskId });

      const updated = this.db
        .prepare(
          `UPDATE tasks
           SET status = 'failed',
               updated_at = @updated_at
           WHERE id = @task_id
             AND status = 'running'`
        )
        .run({ task_id: taskId, updated_at: now });

      return updated.changes > 0;
    });

    return tx();
  }

  appendQueueEvent(
    runId: string,
    eventType: string,
    payload?: Record<string, unknown>,
    taskId?: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO queue_events (run_id, task_id, event_type, payload_json, created_at)
         VALUES (@run_id, @task_id, @event_type, @payload_json, @created_at)`
      )
      .run({
        run_id: runId,
        task_id: taskId ?? null,
        event_type: eventType,
        payload_json: payload ? JSON.stringify(payload) : null,
        created_at: nowIso()
      });
  }

  saveVerificationReport(report: VerificationReport): void {
    this.db
      .prepare(
        `INSERT INTO verification_reports (task_id, passed, report_json, evaluated_at)
         VALUES (@task_id, @passed, @report_json, @evaluated_at)`
      )
      .run({
        task_id: report.taskId,
        passed: report.passed ? 1 : 0,
        report_json: JSON.stringify(report),
        evaluated_at: report.evaluatedAt
      });
  }

  latestVerificationReport(taskId: string): VerificationReport | undefined {
    const row = this.db
      .prepare(
        `SELECT report_json
         FROM verification_reports
         WHERE task_id = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(taskId) as { report_json: string } | undefined;

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.report_json) as VerificationReport;
  }

  listQueueEvents(
    runId: string,
    limit = 50
  ): Array<{ eventType: string; taskId?: string; payload?: Record<string, unknown>; createdAt: string }> {
    const rows = this.db
      .prepare(
        `SELECT event_type, task_id, payload_json, created_at
         FROM queue_events
         WHERE run_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(runId, limit) as Array<{
      event_type: string;
      task_id: string | null;
      payload_json: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      eventType: row.event_type,
      taskId: row.task_id ?? undefined,
      payload: row.payload_json ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined,
      createdAt: row.created_at
    }));
  }

  queueSnapshot(runId: string): QueueSnapshot {
    const counts = this.db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM tasks
         WHERE run_id = ?
         GROUP BY status`
      )
      .all(runId) as Array<{ status: TaskStatus; count: number }>;

    const snapshot: QueueSnapshot = {
      pending: 0,
      ready: 0,
      running: 0,
      verifying: 0,
      completed: 0,
      failed: 0,
      blocked: 0
    };

    for (const item of counts) {
      snapshot[item.status] = item.count;
    }
    return snapshot;
  }

  tokenUsage(runId: string): TokenUsageSummary {
    const tasks = this.listTasks(runId);
    const estimatedInputTokens = tasks.reduce((sum, task) => {
      return sum + Math.ceil((task.description.length + task.contextCapsule.summary.length) / 4);
    }, 0);

    return {
      runId,
      estimatedInputTokens,
      estimatedOutputTokens: Math.ceil(estimatedInputTokens * 0.5)
    };
  }

  getActiveLeaseOwnerForTask(taskId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT lease_owner FROM task_leases
         WHERE task_id = ? AND lease_expires_at > ?`
      )
      .get(taskId, nowIso()) as { lease_owner: string } | undefined;
    return row?.lease_owner;
  }

  stopRun(runId: string): boolean {
    const run = this.getRun(runId);
    if (!run) return false;
    this.updateRunStatus(runId, "failed", true);
    this.appendQueueEvent(runId, "run_stopped", { reason: "manually_stopped" });
    return true;
  }

  deleteRun(runId: string): boolean {
    const run = this.getRun(runId);
    if (!run) return false;
    this.db.prepare(`DELETE FROM runs WHERE id = ?`).run(runId);
    return true;
  }

  private fromTaskRow(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      runId: row.run_id,
      title: row.title,
      description: row.description,
      contextCapsule: JSON.parse(row.context_capsule_json),
      acceptanceCriteria: JSON.parse(row.acceptance_criteria_json),
      verification: JSON.parse(row.verification_json),
      estimatedEffort: row.estimated_effort,
      status: row.status,
      sequenceOrder: row.sequence_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}