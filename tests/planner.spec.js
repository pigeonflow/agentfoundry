import { describe, expect, it } from "vitest";
import { decomposePrompt } from "../src/planner/taskDecomposer.js";
import { evaluatePlanQuality } from "../src/planner/qualityGate.js";
describe("planner", () => {
    it("decomposes prompt into sequential tasks", () => {
        const input = "Create CLI command. Add tests. Update docs.";
        const result = decomposePrompt("run_1", input);
        expect(result.tasks.length).toBe(3);
        expect(result.dependencies.length).toBe(2);
        expect(result.dependencies[0].taskId).toBe(result.tasks[1].id);
        expect(result.dependencies[0].dependsOnTaskId).toBe(result.tasks[0].id);
    });
    it("quality gate flags missing verification commands", () => {
        const result = decomposePrompt("run_1", "Do one thing.");
        result.tasks[0].verification.commands = [];
        const quality = evaluatePlanQuality(result.tasks);
        expect(quality.isAcceptable).toBe(false);
        expect(quality.discrepancies.some((item) => item.includes("missing verification commands"))).toBe(true);
    });
});
//# sourceMappingURL=planner.spec.js.map