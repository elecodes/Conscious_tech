import type { WeeklySchedule } from "../../src/domain/schedule";
import { extractPlanItems } from "../../src/web/components/weekly-session-formatters";
import { createReviewFixture } from "./review-proposal";

export function createActiveWeekFixture() {
  const fixture = createReviewFixture();
  const plan = { ...fixture.plan, planId: "active-week-fixture", status: "active" as const };
  const schedule: WeeklySchedule = {
    scheduleId: "active-schedule-fixture",
    planId: plan.planId,
    weekRange: plan.targetWeek,
    version: 1,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    dailyAllocations: [{ itemId: "g", day: "2026-12-09", allocatedHours: 1 }],
    timeBlocks: [{ itemId: "g", day: "2026-12-09", startTime: "14:00", endTime: "15:00" }],
    appliedAdjustments: [],
    dayConstraints: [],
  };
  return { ...fixture, plan, schedule, items: extractPlanItems(plan, schedule) };
}
