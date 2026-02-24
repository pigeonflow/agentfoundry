import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verify/verificationRunner.js";

describe("verification runner", () => {
  it("passes when all commands succeed", () => {
    const runner = new VerificationRunner();
    const report = runner.run("task_1", ["node -e \"process.exit(0)\""]);
    expect(report.passed).toBe(true);
  });

  it("fails fast when a command fails", () => {
    const runner = new VerificationRunner();
    const report = runner.run("task_1", ["node -e \"process.exit(1)\"", "node -e \"process.exit(0)\""]);
    expect(report.passed).toBe(false);
    expect(report.commandResults.length).toBe(1);
  });
});