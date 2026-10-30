import { describe, it, expect } from "vitest";
import {
  WeeklySchedule,
  TargetWeek,
  applyAdjustmentToSchedule,
  isAdjustmentSupersededBy,
  ScheduleAdjustmentRecord,
  ReassignTimeBlockAction,
  ReallocateDayWorkAction,
  PostponeItemAction,
  AcceptRiskAction,
  RequestInformationAction,
  UnblockDependencyAction,
} from "../src/domain/schedule";
import { ProposedWeek } from "../src/domain/week";

describe("WeeklySchedule Lifecycle & applyAdjustmentToSchedule Engine (Phase 2)", () => {
  const validWeekRange: TargetWeek = {
    startDate: "2026-10-12",
    endDate: "2026-10-18",
  };

  function createTestSchedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
    return {
      scheduleId: "sched-2026-w42",
      planId: "plan-2026-w42",
      weekRange: validWeekRange,
      timeBlocks: [
        {
          itemId: "item-meeting-01",
          day: "2026-10-13", // Tuesday
          startTime: "10:00",
          endTime: "11:00",
          note: "Weekly sync",
        },
        {
          itemId: "item-deep-work",
          day: "2026-10-14", // Wednesday
          startTime: "14:00",
          endTime: "16:00",
        },
      ],
      dailyAllocations: [
        { itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 3 }, // Monday
        { itemId: "item-dev-01", day: "2026-10-14", allocatedHours: 2 }, // Wednesday
        { itemId: "item-write-doc", day: "2026-10-13", allocatedHours: 2 }, // Tuesday
      ],
      dayConstraints: [
        { day: "2026-10-15", availableHours: 4, note: "Thursday limited hours" },
        { day: "2026-10-18", availableHours: 0, note: "Sunday zero capacity" },
      ],
      appliedAdjustments: [],
      version: 1,
      createdAt: "2026-10-12T08:00:00Z",
      updatedAt: "2026-10-12T08:00:00Z",
      ...overrides,
    };
  }

  // ============================================================================
  // 1. Concurrencia Optimista (expectedScheduleVersion)
  // ============================================================================
  describe("1. Concurrencia optimista", () => {
    it("fails with stale_schedule_version when expectedScheduleVersion differs from schedule.version", () => {
      const schedule = createTestSchedule({ version: 2 });
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-15",
          startTime: "10:00",
          endTime: "11:00",
        },
        rationale: "Reschedule sync",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-stale-01",
        action,
        expectedScheduleVersion: 1, // Stale! Schedule is on version 2
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("stale_schedule_version");
        expect(result.failureReason).toContain(
          "Expected schedule version (1) does not match current schedule version (2)"
        );
        // Schedule remains completely untouched and unmutated
        expect(result.schedule).toBe(schedule);
        expect(result.schedule.version).toBe(2);
        // Failed diagnostic record adheres to contract
        expect(result.failedRecord.applicationOutcome).toBe("failed");
        expect(result.failedRecord.lifecycleStatus).toBe("active");
        expect(result.failedRecord.expectedScheduleVersion).toBe(1);
      }
    });
  });

  // ============================================================================
  // 2. Decisión Humana y Trazabilidad (humanDecision)
  // ============================================================================
  describe("2. Decisión humana y soberanía", () => {
    it("fails with decision_rejected and preserves schedule when humanDecision is 'rejected'", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "item-dev-01",
        currentCategory: "foci",
        targetReason: "intentional_postponement",
        hoursFreed: 5,
        rationale: "Defer work",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-rej-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "rejected",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("decision_rejected");
        expect(result.schedule).toBe(schedule);
        expect(result.schedule.version).toBe(1);
        expect(result.schedule.dailyAllocations).toHaveLength(3); // dev-01 allocations not removed!
        expect(result.failedRecord.humanDecision).toBe("rejected");
        expect(result.failedRecord.applicationOutcome).toBe("failed");
        expect(result.failedRecord.lifecycleStatus).toBe("active");
        expect(result.failedRecord.appliedAt).toBeUndefined();
      }
    });
  });

  // ============================================================================
  // 3. Aplicación de Acciones: reassign_time_block
  // ============================================================================
  describe("3. Acción reassign_time_block", () => {
    it("successfully reassigns a time block, increments version, and records applied adjustment", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-16", // Friday
          startTime: "15:00",
          endTime: "16:00", // Exact 60m duration preserved
        },
        rationale: "Move meeting to Friday afternoon",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-move-sync",
        proposalId: "prop-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.schedule.version).toBe(2);
        expect(result.schedule.updatedAt).toBe("2026-10-12T11:00:00Z");

        // Verify block updated
        const targetBlock = result.schedule.timeBlocks.find(
          (tb) => tb.itemId === "item-meeting-01"
        );
        expect(targetBlock).toBeDefined();
        expect(targetBlock?.day).toBe("2026-10-16");
        expect(targetBlock?.startTime).toBe("15:00");
        expect(targetBlock?.endTime).toBe("16:00");

        // Verify audit record
        expect(result.appliedRecord.adjustmentId).toBe("adj-move-sync");
        expect(result.appliedRecord.humanDecision).toBe("accepted");
        expect(result.appliedRecord.applicationOutcome).toBe("applied");
        expect(result.appliedRecord.lifecycleStatus).toBe("active");
        expect(result.appliedRecord.appliedAt).toBe("2026-10-12T11:00:00Z");

        // Verify schedule history
        expect(result.schedule.appliedAdjustments).toHaveLength(1);
        expect(result.schedule.appliedAdjustments[0]?.adjustmentId).toBe("adj-move-sync");

        // Verify original schedule remained unmutated
        expect(schedule.version).toBe(1);
        expect(schedule.timeBlocks[0]?.day).toBe("2026-10-13");
      }
    });

    it("fails with duration_mismatch if proposed block duration does not match current block duration", () => {
      const schedule = createTestSchedule();
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00", // 60 minutes
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-16",
          startTime: "15:00",
          endTime: "16:30", // 90 minutes (duration changed!)
        },
        rationale: "Lengthen and move meeting",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-dur-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("duration_mismatch");
        expect(result.failureReason).toContain(
          "Proposed block duration (90m) does not match current block duration (60m)"
        );
        expect(result.schedule).toBe(schedule);
      }
    });

    it("fails with schedule_overlap when proposed block collides with another existing block", () => {
      const schedule = createTestSchedule();
      // schedule already has item-deep-work on 2026-10-14 from 14:00 to 16:00
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-14",
          startTime: "15:00", // Collides with 14:00-16:00!
          endTime: "16:00",
        },
        rationale: "Move meeting on top of deep work",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-overlap-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("schedule_overlap");
        expect(result.failureReason).toContain("overlaps with existing block for 'item-deep-work'");
        expect(result.schedule).toBe(schedule);
      }
    });

    it("fails with constraint_violation if proposed block is moved to a zero-capacity day", () => {
      const schedule = createTestSchedule();
      // Sunday 2026-10-18 has DayConstraint(availableHours: 0)
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-18", // Sunday zero-capacity day!
          startTime: "10:00",
          endTime: "11:00",
        },
        rationale: "Move to weekend",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-zero-cap-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("constraint_violation");
        expect(result.failureReason).toContain("has 0 available hours declared in DayConstraint");
        expect(result.schedule).toBe(schedule);
      }
    });

    it("fails with item_not_found if currentBlock does not exist in schedule", () => {
      const schedule = createTestSchedule();
      const action: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-ghost",
        currentBlock: {
          itemId: "item-ghost",
          day: "2026-10-13",
          startTime: "09:00",
          endTime: "10:00",
        },
        proposedBlock: {
          itemId: "item-ghost",
          day: "2026-10-15",
          startTime: "09:00",
          endTime: "10:00",
        },
        rationale: "Move ghost block",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-ghost-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("item_not_found");
        expect(result.failureReason).toContain("not found in schedule");
      }
    });
  });

  // ============================================================================
  // 4. Aplicación de Acciones: reallocate_day_work
  // ============================================================================
  describe("4. Acción reallocate_day_work", () => {
    it("successfully reallocates work hours, preserves mathematical hour sum, and increments version", () => {
      const schedule = createTestSchedule({ version: 1 });
      // item-dev-01 has 3h on Monday (2026-10-12) and 2h on Wednesday (2026-10-14).
      // Total schedule allocation: 3 + 2 + 2 = 7h.
      const action: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-16", // Friday (no DayConstraint)
        hoursToMove: 1.5,
        rationale: "Shift 1.5h from Monday to Friday",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-realloc-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T12:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.schedule.version).toBe(2);

        // Check source day remaining
        const sourceAlloc = result.schedule.dailyAllocations.find(
          (a) => a.itemId === "item-dev-01" && a.day === "2026-10-12"
        );
        expect(sourceAlloc?.allocatedHours).toBe(1.5);

        // Check target day allocation created
        const targetAlloc = result.schedule.dailyAllocations.find(
          (a) => a.itemId === "item-dev-01" && a.day === "2026-10-16"
        );
        expect(targetAlloc?.allocatedHours).toBe(1.5);

        // Strict conservation of hours: 1.5 + 2 + 2 + 1.5 = 7.0h
        const totalNewHours = result.schedule.dailyAllocations.reduce(
          (sum, a) => sum + a.allocatedHours,
          0
        );
        expect(totalNewHours).toBe(7.0);

        // Original schedule untouched
        expect(schedule.dailyAllocations).toHaveLength(3);
        expect(schedule.version).toBe(1);
      }
    });

    it("allows reallocation to an unconstrained day even with high load without synthetic limits (ADR 0012 §6)", () => {
      const schedule = createTestSchedule({ version: 1 });
      // Monday has 3h. Move 3h to Wednesday where item-dev-01 already has 2h, making 5h for dev-01 on Wednesday.
      // Wednesday has no DayConstraint. Total hours on Wednesday will be 5h.
      const action: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-14", // Wednesday (unconstrained)
        hoursToMove: 3,
        rationale: "Move all Monday hours to Wednesday",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-unconstrained-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T12:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.schedule.version).toBe(2);
        // Source allocation reached 0h and was cleanly pruned
        const sourceAlloc = result.schedule.dailyAllocations.find(
          (a) => a.itemId === "item-dev-01" && a.day === "2026-10-12"
        );
        expect(sourceAlloc).toBeUndefined();

        // Target allocation accumulated: 2h + 3h = 5h
        const wedAlloc = result.schedule.dailyAllocations.find(
          (a) => a.itemId === "item-dev-01" && a.day === "2026-10-14"
        );
        expect(wedAlloc?.allocatedHours).toBe(5);

        // Total hours preserved exactly: 5 + 2 = 7h
        const totalNewHours = result.schedule.dailyAllocations.reduce(
          (sum, a) => sum + a.allocatedHours,
          0
        );
        expect(totalNewHours).toBe(7.0);
      }
    });

    it("fails with insufficient_source_hours if source day has less hours than requested to move", () => {
      const schedule = createTestSchedule();
      const action: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12", // Has 3h
        targetDay: "2026-10-16",
        hoursToMove: 5, // Requires 5h > 3h!
        rationale: "Try moving more than available",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-shortage-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T12:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("insufficient_source_hours");
        expect(result.failureReason).toContain(
          "has 3h allocated, insufficient for requested move of 5h"
        );
        expect(result.schedule).toBe(schedule);
      }
    });

    it("fails with constraint_violation if moving hours would exceed explicit DayConstraint availableHours", () => {
      // Create schedule where Monday has 6h, and we try to move 5h to Thursday (limit 4h)
      const scheduleWithMoreHours = createTestSchedule({
        dailyAllocations: [{ itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 6 }],
      });

      const overLimitAction: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-15", // Limit 4h
        hoursToMove: 5, // 5 > 4!
        rationale: "Exceed Thursday limit",
      };

      const result = applyAdjustmentToSchedule(scheduleWithMoreHours, {
        proposalId: "prop-cap-exceed-01",
        action: overLimitAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T12:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("constraint_violation");
        expect(result.failureReason).toContain(
          "would bring total allocated hours (5h) above availableHours (4h)"
        );
        expect(result.schedule).toBe(scheduleWithMoreHours);
      }
    });
  });

  // ============================================================================
  // 5. Aplicación de Acciones: postpone_item
  // ============================================================================
  describe("5. Acción postpone_item", () => {
    it("successfully removes all time blocks and allocations for the postponed item and records applied decision", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "item-dev-01",
        currentCategory: "foci",
        targetReason: "intentional_postponement",
        hoursFreed: 5,
        rationale: "Postpone dev-01 to next sprint",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-postpone-dev",
        proposalId: "prop-postpone-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T15:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.schedule.version).toBe(2);

        // Daily allocations for item-dev-01 must be completely removed
        const devAllocations = result.schedule.dailyAllocations.filter(
          (a) => a.itemId === "item-dev-01"
        );
        expect(devAllocations).toHaveLength(0);

        // Other allocations remain intact
        expect(result.schedule.dailyAllocations).toHaveLength(1); // item-write-doc
        expect(result.schedule.dailyAllocations[0]?.itemId).toBe("item-write-doc");

        // Record is applied and active
        expect(result.appliedRecord.adjustmentId).toBe("adj-postpone-dev");
        expect(result.appliedRecord.applicationOutcome).toBe("applied");
        expect(result.appliedRecord.lifecycleStatus).toBe("active");
        expect(result.schedule.appliedAdjustments).toHaveLength(1);
      }
    });

    it("fails with item_not_found if postponed item does not exist in schedule or activePlan", () => {
      const schedule = createTestSchedule();
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "unknown-item-999",
        currentCategory: "flexible_options",
        targetReason: "out_of_capacity",
        hoursFreed: 2,
        rationale: "Postpone unknown item",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-unknown-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T15:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("item_not_found");
        expect(result.failureReason).toContain(
          "not found in schedule time blocks or daily allocations"
        );
      }
    });
  });

  // ============================================================================
  // 6. Acciones No Representables (accept_risk, request_information, unblock_dependency)
  // ============================================================================
  describe("6. Acciones no representables en WeeklySchedule", () => {
    it("fails with unsupported_action for unblock_dependency", () => {
      const schedule = createTestSchedule();
      const action: UnblockDependencyAction = {
        type: "unblock_dependency",
        dependentItemId: "item-dev-01",
        prerequisiteItemId: "item-api-spec",
        requiredAction: "Review API spec with team",
        rationale: "Need spec unblocked",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-unblock-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T16:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("unsupported_action");
        expect(result.failureReason).toContain(
          "does not specify a concrete, verifiable temporal transformation on WeeklySchedule"
        );
        expect(result.schedule).toBe(schedule);
        expect(result.failedRecord.applicationOutcome).toBe("failed");
      }
    });

    it("fails with unsupported_action for accept_risk without modifying schedule", () => {
      const schedule = createTestSchedule();
      const action: AcceptRiskAction = {
        type: "accept_risk",
        conflictId: "conflict-cap-01",
        toleratedRisk: "Risk of long day on Wednesday",
        rationale: "User explicitly accepts risk",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-risk-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T16:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("unsupported_action");
        expect(result.schedule).toBe(schedule);
      }
    });

    it("fails with unsupported_action for request_information without modifying schedule", () => {
      const schedule = createTestSchedule();
      const action: RequestInformationAction = {
        type: "request_information",
        targetItemId: "item-dev-01",
        missingField: "estimated_hours",
        question: "How long will this task take?",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-info-01",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T16:00:00Z",
        humanDecision: "accepted",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("unsupported_action");
        expect(result.schedule).toBe(schedule);
      }
    });
  });

  // ============================================================================
  // 7. Preservación del Historial y Semántica de 'superseded' (ADR 0012 §3 & §7)
  // ============================================================================
  describe("7. Historial y ciclo de vida (superseded vs reverted)", () => {
    it("transitions previously active adjustments on the same item to 'superseded' while preserving their historical evidence", () => {
      const schedule = createTestSchedule({ version: 1 });

      // Step 1: Reassign meeting to Thursday
      const action1: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-15",
          startTime: "11:00",
          endTime: "12:00",
        },
        rationale: "Step 1: move to Thursday",
      };

      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-step-1",
        proposalId: "prop-step-1",
        action: action1,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;

      expect(res1.schedule.version).toBe(2);
      expect(res1.schedule.appliedAdjustments).toHaveLength(1);
      expect(res1.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("active");

      // Step 2: Second reassign for the same item from Thursday to Friday
      const action2: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-15",
          startTime: "11:00",
          endTime: "12:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-16",
          startTime: "15:00",
          endTime: "16:00",
        },
        rationale: "Step 2: move to Friday",
      };

      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-step-2",
        proposalId: "prop-step-2",
        action: action2,
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T11:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;

      expect(res2.schedule.version).toBe(3);
      expect(res2.schedule.appliedAdjustments).toHaveLength(2);

      // Previous record (adj-step-1) must now be superseded, but its humanDecision: accepted and outcome: applied are intact!
      const pastRecord = res2.schedule.appliedAdjustments.find(
        (a) => a.adjustmentId === "adj-step-1"
      );
      expect(pastRecord?.lifecycleStatus).toBe("superseded");
      expect(pastRecord?.humanDecision).toBe("accepted");
      expect(pastRecord?.applicationOutcome).toBe("applied");
      expect(pastRecord?.appliedAt).toBe("2026-10-12T10:00:00Z");

      // New record (adj-step-2) is active
      const currentRecord = res2.schedule.appliedAdjustments.find(
        (a) => a.adjustmentId === "adj-step-2"
      );
      expect(currentRecord?.lifecycleStatus).toBe("active");
      expect(currentRecord?.expectedScheduleVersion).toBe(2);
      expect(currentRecord?.applicationOutcome).toBe("applied");
    });
  });

  // ============================================================================
  // 8. Integración Opcional con activePlan
  // ============================================================================
  describe("8. Validación cruzada opcional con activePlan", () => {
    const sampleActivePlan: ProposedWeek = {
      weekSummary: {
        targetWeek: validWeekRange,
        intent: "Test intent",
        capacity: {
          totalAvailableHours: 40,
          plannableHours: 32,
          plannedHours: 25,
          knownEstimatedHours: 25,
          estimationCompleteness: "complete",
          protectedSpaceHours: 8,
          capacityStatus: "within_capacity",
          protectedSpaceStatus: "respected",
        },
      },
      foci: [
        {
          id: "focus-core",
          title: "Core Architecture",
          desiredOutcome: "Solid foundations",
          rationale: "Architecture before frameworks",
          contributingItemIds: ["item-meeting-01", "item-dev-01"],
          estimatedHours: 15,
        },
      ],
      obligations: [],
      flexibleOptions: [
        {
          itemId: "item-write-doc",
          title: "Write documentation",
          estimatedHours: 2,
        },
      ],
      deferredItems: [],
      unplannedSpace: {
        rationale: "Space preserved",
        recommendedHours: 8,
      },
      confirmationPrompt: {
        question: "Ready?",
        keyTradeoffs: [],
        pendingQuestions: [],
      },
    };

    it("succeeds when itemId exists in activePlan", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "item-write-doc", // In flexibleOptions
        currentCategory: "flexible_options",
        targetReason: "intentional_postponement",
        hoursFreed: 2,
        rationale: "Defer docs",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-plan-ok",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:00:00Z",
        humanDecision: "accepted",
        activePlan: sampleActivePlan,
      });

      expect(result.status).toBe("success");
    });

    it("fails with item_not_found if itemId does not exist in activePlan", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "item-phantom-item",
        currentCategory: "foci",
        targetReason: "out_of_capacity",
        hoursFreed: 4,
        rationale: "Phantom item",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-plan-fail",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:00:00Z",
        humanDecision: "accepted",
        activePlan: sampleActivePlan,
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("item_not_found");
        expect(result.failureReason).toContain("does not exist in activePlan");
      }
    });

    it("fails with constraint_violation if schedule.weekRange does not match activePlan.targetWeek", () => {
      const mismatchedPlan: ProposedWeek = {
        ...sampleActivePlan,
        weekSummary: {
          ...sampleActivePlan.weekSummary,
          targetWeek: {
            startDate: "2026-10-19", // Next week!
            endDate: "2026-10-25",
          },
        },
      };

      const schedule = createTestSchedule({ version: 1 });
      const action: PostponeItemAction = {
        type: "postpone_item",
        itemId: "item-dev-01",
        currentCategory: "foci",
        targetReason: "intentional_postponement",
        hoursFreed: 3,
        rationale: "Defer dev",
      };

      const result = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-mismatch-week",
        action,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:00:00Z",
        humanDecision: "accepted",
        activePlan: mismatchedPlan,
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.errorCode).toBe("constraint_violation");
        expect(result.failureReason).toContain("does not match activePlan targetWeek");
      }
    });
  });

  // ============================================================================
  // 9. Regresiones D-01, R-01, R-02, R-03 (Auditoría de Fase 2)
  // ============================================================================
  describe("9. Regresiones D-01, R-01, R-02, R-03", () => {
    it("Caso 1 (D-01): does not supersede a previous adjustment when reassigning a different block of the same item", () => {
      const schedule = createTestSchedule({
        version: 1,
        timeBlocks: [
          {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "09:00",
            endTime: "10:00",
            note: "Block 1",
          },
          {
            itemId: "item-meeting-01",
            day: "2026-10-14",
            startTime: "14:00",
            endTime: "15:00",
            note: "Block 2",
          },
        ],
      });

      // Move Block 1 to Tuesday 11:00-12:00
      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-block-1",
        proposalId: "prop-block-1",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "09:00",
            endTime: "10:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Reschedule Block 1",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;
      expect(res1.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("active");

      // Move Block 2 to Wednesday 16:00-17:00
      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-block-2",
        proposalId: "prop-block-2",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-14",
            startTime: "14:00",
            endTime: "15:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-14",
            startTime: "16:00",
            endTime: "17:00",
          },
          rationale: "Reschedule Block 2",
        },
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T09:30:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(res2.schedule.appliedAdjustments).toHaveLength(2);
      // BOTH adjustments must remain active because they affected distinct blocks!
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-block-1")
          ?.lifecycleStatus
      ).toBe("active");
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-block-2")
          ?.lifecycleStatus
      ).toBe("active");
    });

    it("Caso 2 (D-01): keeps both reallocations active when they affect disjoint day pairs", () => {
      const schedule = createTestSchedule({
        version: 1,
        dailyAllocations: [
          { itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 3 }, // Monday
          { itemId: "item-dev-01", day: "2026-10-14", allocatedHours: 3 }, // Wednesday
        ],
      });

      // Move 1h from Monday to Tuesday
      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-alloc-1",
        proposalId: "prop-alloc-1",
        action: {
          type: "reallocate_day_work",
          itemId: "item-dev-01",
          sourceDay: "2026-10-12",
          targetDay: "2026-10-13",
          hoursToMove: 1,
          rationale: "Move Monday to Tuesday",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;
      expect(res1.schedule.appliedAdjustments[0]?.lifecycleStatus).toBe("active");

      // Move 1h from Wednesday to Friday
      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-alloc-2",
        proposalId: "prop-alloc-2",
        action: {
          type: "reallocate_day_work",
          itemId: "item-dev-01",
          sourceDay: "2026-10-14",
          targetDay: "2026-10-16",
          hoursToMove: 1,
          rationale: "Move Wednesday to Friday",
        },
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(res2.schedule.appliedAdjustments).toHaveLength(2);
      // Both reallocations remain active because Monday->Tuesday and Wednesday->Friday are disjoint!
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-alloc-1")
          ?.lifecycleStatus
      ).toBe("active");
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-alloc-2")
          ?.lifecycleStatus
      ).toBe("active");
    });

    it("Caso 3 (D-01): marks previous reassign as superseded when modifying the exact same block", () => {
      const schedule = createTestSchedule({ version: 1 });

      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-sync-1",
        proposalId: "prop-sync-1",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-15",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Move sync to Thursday",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;

      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-sync-2",
        proposalId: "prop-sync-2",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-15",
            startTime: "11:00",
            endTime: "12:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-16",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Move sync from Thursday to Friday",
        },
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-sync-1")
          ?.lifecycleStatus
      ).toBe("superseded");
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-sync-2")
          ?.lifecycleStatus
      ).toBe("active");
    });

    it("Caso 4 (D-01): marks previous reallocation as superseded when chained from previous targetDay", () => {
      const schedule = createTestSchedule({
        version: 1,
        dailyAllocations: [
          { itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 3 }, // Monday
        ],
      });

      // Move 2h from Monday to Tuesday
      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-chain-1",
        proposalId: "prop-chain-1",
        action: {
          type: "reallocate_day_work",
          itemId: "item-dev-01",
          sourceDay: "2026-10-12",
          targetDay: "2026-10-13",
          hoursToMove: 2,
          rationale: "Move Monday to Tuesday",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;

      // Chain move 1h from Tuesday (the previous target day) to Friday
      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-chain-2",
        proposalId: "prop-chain-2",
        action: {
          type: "reallocate_day_work",
          itemId: "item-dev-01",
          sourceDay: "2026-10-13", // Chained from previous targetDay
          targetDay: "2026-10-16",
          hoursToMove: 1,
          rationale: "Move Tuesday to Friday",
        },
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-chain-1")
          ?.lifecycleStatus
      ).toBe("superseded");
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-chain-2")
          ?.lifecycleStatus
      ).toBe("active");
    });

    it("Caso 5 (D-01): postpone_item supersedes all previous active temporal adjustments for that item", () => {
      const schedule = createTestSchedule({
        version: 1,
        timeBlocks: [
          {
            itemId: "item-dev-01",
            day: "2026-10-13",
            startTime: "09:00",
            endTime: "10:00",
          },
        ],
        dailyAllocations: [{ itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 3 }],
      });

      // First reallocate day work on item-dev-01
      const res1 = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-dev-realloc",
        proposalId: "prop-dev-realloc",
        action: {
          type: "reallocate_day_work",
          itemId: "item-dev-01",
          sourceDay: "2026-10-12",
          targetDay: "2026-10-14",
          hoursToMove: 2,
          rationale: "Shift dev hours to Wednesday",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("success");
      if (res1.status !== "success") return;

      // Next postpone the item entirely
      const res2 = applyAdjustmentToSchedule(res1.schedule, {
        adjustmentId: "adj-dev-postpone",
        proposalId: "prop-dev-postpone",
        action: {
          type: "postpone_item",
          itemId: "item-dev-01",
          currentCategory: "foci",
          targetReason: "out_of_capacity",
          hoursFreed: 3,
          rationale: "Postpone entire item",
        },
        expectedScheduleVersion: 2,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("success");
      if (res2.status !== "success") return;
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-dev-realloc")
          ?.lifecycleStatus
      ).toBe("superseded");
      expect(
        res2.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-dev-postpone")
          ?.lifecycleStatus
      ).toBe("active");
    });

    it("Caso 6 (D-01): failed, rejected, or reverted records are never transitioned to superseded", () => {
      const priorRejectedRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-prior-rejected",
        proposalId: "prop-prior-rej",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-15",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Rejected suggestion",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T08:00:00Z",
        humanDecision: "rejected",
        applicationOutcome: "failed",
        failureReason: "User rejected proposal",
        lifecycleStatus: "active",
      };

      const priorFailedRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-prior-failed",
        proposalId: "prop-prior-fail",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-15",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Failed attempt",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T08:15:00Z",
        humanDecision: "accepted",
        applicationOutcome: "failed",
        failureReason: "Version mismatch",
        lifecycleStatus: "active",
      };

      const priorRevertedRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-prior-reverted",
        proposalId: "prop-prior-rev",
        action: {
          type: "reassign_time_block",
          itemId: "item-meeting-01",
          currentBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          proposedBlock: {
            itemId: "item-meeting-01",
            day: "2026-10-15",
            startTime: "11:00",
            endTime: "12:00",
          },
          rationale: "Reverted action",
        },
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T08:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T08:30:05Z",
        lifecycleStatus: "reverted",
      };

      // Verify isAdjustmentSupersededBy returns false directly for all three
      const newAction: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-16",
          startTime: "10:00",
          endTime: "11:00",
        },
        rationale: "New move",
      };

      expect(isAdjustmentSupersededBy(priorRejectedRecord, newAction)).toBe(false);
      expect(isAdjustmentSupersededBy(priorFailedRecord, newAction)).toBe(false);
      expect(isAdjustmentSupersededBy(priorRevertedRecord, newAction)).toBe(false);

      // Apply adjustment to a schedule containing all three historical records
      const schedule = createTestSchedule({
        version: 1,
        appliedAdjustments: [priorRejectedRecord, priorFailedRecord, priorRevertedRecord],
      });

      const res = applyAdjustmentToSchedule(schedule, {
        adjustmentId: "adj-new-applied",
        proposalId: "prop-new-applied",
        action: newAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T09:00:00Z",
        humanDecision: "accepted",
      });

      expect(res.status).toBe("success");
      if (res.status !== "success") return;
      expect(res.schedule.appliedAdjustments).toHaveLength(4);

      // Previous non-active/non-applied records maintain their exact status
      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-rejected")
          ?.lifecycleStatus
      ).toBe("active");
      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-rejected")
          ?.applicationOutcome
      ).toBe("failed");

      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-failed")
          ?.lifecycleStatus
      ).toBe("active");
      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-failed")
          ?.applicationOutcome
      ).toBe("failed");

      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-reverted")
          ?.lifecycleStatus
      ).toBe("reverted");
      expect(
        res.schedule.appliedAdjustments.find((a) => a.adjustmentId === "adj-prior-reverted")
          ?.applicationOutcome
      ).toBe("applied");
    });

    it("Caso 7 (R-01): fails atomically with constraint_violation when proposedBlock or currentBlock itemId does not match action.itemId", () => {
      const schedule = createTestSchedule({ version: 1 });

      // Mismatch in proposedBlock.itemId
      const mismatchedProposedAction: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-DIFFERENT-id", // Mismatch!
          day: "2026-10-15",
          startTime: "10:00",
          endTime: "11:00",
        },
        rationale: "Mismatched proposed itemId",
      };

      const res1 = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-mismatch-prop-item",
        action: mismatchedProposedAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res1.status).toBe("failed");
      if (res1.status === "failed") {
        expect(res1.errorCode).toBe("constraint_violation");
        expect(res1.failureReason).toContain(
          "Proposed block itemId 'item-DIFFERENT-id' does not match action itemId 'item-meeting-01'"
        );
        expect(res1.schedule).toBe(schedule);
      }

      // Mismatch in currentBlock.itemId
      const mismatchedCurrentAction: ReassignTimeBlockAction = {
        type: "reassign_time_block",
        itemId: "item-meeting-01",
        currentBlock: {
          itemId: "item-ANOTHER-id", // Mismatch!
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        proposedBlock: {
          itemId: "item-meeting-01",
          day: "2026-10-15",
          startTime: "10:00",
          endTime: "11:00",
        },
        rationale: "Mismatched current itemId",
      };

      const res2 = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-mismatch-curr-item",
        action: mismatchedCurrentAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res2.status).toBe("failed");
      if (res2.status === "failed") {
        expect(res2.errorCode).toBe("constraint_violation");
        expect(res2.failureReason).toContain(
          "Current block itemId 'item-ANOTHER-id' does not match action itemId 'item-meeting-01'"
        );
        expect(res2.schedule).toBe(schedule);
      }
    });

    it("Caso 8 (R-02): fails atomically with constraint_violation when sourceDay === targetDay in reallocate_day_work", () => {
      const schedule = createTestSchedule({ version: 1 });
      const reflexiveAction: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-12", // Reflexive reallocation on same day!
        hoursToMove: 1,
        rationale: "Move work to same day",
      };

      const res = applyAdjustmentToSchedule(schedule, {
        proposalId: "prop-same-day",
        action: reflexiveAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T10:00:00Z",
        humanDecision: "accepted",
      });

      expect(res.status).toBe("failed");
      if (res.status === "failed") {
        expect(res.errorCode).toBe("constraint_violation");
        expect(res.failureReason).toContain(
          "sourceDay and targetDay must be different in reallocate_day_work ('2026-10-12')"
        );
        expect(res.schedule).toBe(schedule);
      }
    });

    it("Caso 9 (R-03): throws explicit error when decidedAt is omitted, never defaulting to system clock", () => {
      const schedule = createTestSchedule({ version: 1 });
      const action: ReallocateDayWorkAction = {
        type: "reallocate_day_work",
        itemId: "item-dev-01",
        sourceDay: "2026-10-12",
        targetDay: "2026-10-13",
        hoursToMove: 1,
        rationale: "Deterministic test",
      };

      // Input object overload without decidedAt
      expect(() => {
        applyAdjustmentToSchedule(schedule, {
          proposalId: "prop-no-date",
          action,
          expectedScheduleVersion: 1,
          humanDecision: "accepted",
        } as any);
      }).toThrow(
        "Explicit 'decidedAt' ISO UTC timestamp is required for deterministic schedule adjustment application (R-03)"
      );

      // Proposal overload without decidedAt in options
      const proposal = {
        id: "prop-proposal-no-date",
        conflictId: "conf-1",
        analysis: "Test",
        actions: [action],
      };

      expect(() => {
        applyAdjustmentToSchedule(schedule, proposal as any, 1, {} as any);
      }).toThrow(
        "Explicit 'decidedAt' ISO UTC timestamp is required for deterministic schedule adjustment application (R-03)"
      );
    });
  });
});
