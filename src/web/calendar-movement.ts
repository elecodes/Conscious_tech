import type { WeeklySchedule } from "../domain/schedule";
import type { MovementAction } from "../domain/item-activity-types";

/** Simple day moves reuse the atomic domain command; split assignments stay explicit. */
export function calendarMovement(
  schedule: WeeklySchedule,
  itemId: string,
  sourceDay: string,
  targetDay: string
): MovementAction | null {
  if (sourceDay === targetDay) return null;
  const blocks = schedule.timeBlocks.filter(
    (row) => row.itemId === itemId && row.day === sourceDay
  );
  const allocations = schedule.dailyAllocations.filter(
    (row) => row.itemId === itemId && row.day === sourceDay
  );
  if (blocks.length === 1 && allocations.length === 0) {
    const block = blocks[0]!;
    return {
      type: "reassign_time_block",
      itemId,
      currentBlock: block,
      proposedBlock: { ...block, day: targetDay },
      rationale: "Día elegido directamente en el calendario.",
    };
  }
  if (blocks.length === 0 && allocations.length === 1 && allocations[0]!.allocatedHours > 0) {
    return {
      type: "reallocate_day_work",
      itemId,
      sourceDay,
      targetDay,
      hoursToMove: allocations[0]!.allocatedHours,
      rationale: "Día elegido directamente en el calendario.",
    };
  }
  return null;
}
