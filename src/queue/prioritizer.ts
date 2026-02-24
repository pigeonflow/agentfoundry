import { TaskRecord } from "../core/types.js";

const effortPriority: Record<TaskRecord["estimatedEffort"], number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3
};

export function prioritizeReadyTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort((left, right) => {
    if (left.sequenceOrder !== right.sequenceOrder) {
      return left.sequenceOrder - right.sequenceOrder;
    }
    return effortPriority[left.estimatedEffort] - effortPriority[right.estimatedEffort];
  });
}