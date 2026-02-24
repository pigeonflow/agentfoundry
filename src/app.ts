import { Engine } from "./core/engine.js";
import { DispatchRouter } from "./dispatch/dispatcher.js";
import { LocalWorkerDispatcher } from "./dispatch/adapters/localWorker.js";
import { McpDispatcher } from "./dispatch/adapters/mcpAdapter.js";
import { Repository } from "./db/repository.js";
import { Planner } from "./planner/planner.js";
import { Scheduler } from "./queue/scheduler.js";
import { VerificationRunner } from "./verify/verificationRunner.js";

export class AgentFoundryApp {
  readonly repo: Repository;
  readonly planner: Planner;
  readonly engine: Engine;

  constructor(dbPath?: string) {
    this.repo = new Repository(dbPath);
    this.planner = new Planner(this.repo);
    const scheduler = new Scheduler(this.repo);
    const router = new DispatchRouter([new McpDispatcher(), new LocalWorkerDispatcher()]);
    const verifier = new VerificationRunner();

    this.engine = new Engine(this.repo, scheduler, router, verifier);
  }

  close(): void {
    this.repo.close();
  }
}