import { describe, it, expect } from "vitest";
import {
  HumanDecisionSchema,
  ApplicationOutcomeSchema,
  ScheduleLifecycleStatusSchema,
  ScheduleAdjustmentRecordSchema,
  WeeklyScheduleSchema,
  WeeklySchedule,
  ScheduleAdjustmentRecord,
  validateWeeklyScheduleInvariants,
  getActiveAppliedAdjustments,
} from "../src/domain/schedule";
import { TargetWeek } from "../src/domain/week";

const validWeekRange: TargetWeek = {
  startDate: "2026-10-12",
  endDate: "2026-10-18",
};

const sampleAction = {
  type: "reassign_time_block" as const,
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
    startTime: "15:00",
    endTime: "16:00",
  },
  rationale: "Resolver colisión horaria",
};

describe("WeeklySchedule Domain Model & Schemas", () => {
  describe("Status Enums", () => {
    it("validates valid HumanDecision values and rejects invalid", () => {
      expect(HumanDecisionSchema.parse("accepted")).toBe("accepted");
      expect(HumanDecisionSchema.parse("rejected")).toBe("rejected");
      expect(() => HumanDecisionSchema.parse("maybe")).toThrow();
    });

    it("validates valid ApplicationOutcome values and rejects invalid", () => {
      expect(ApplicationOutcomeSchema.parse("applied")).toBe("applied");
      expect(ApplicationOutcomeSchema.parse("failed")).toBe("failed");
      expect(() => ApplicationOutcomeSchema.parse("pending")).toThrow();
    });

    it("validates valid ScheduleLifecycleStatus values and rejects invalid", () => {
      expect(ScheduleLifecycleStatusSchema.parse("active")).toBe("active");
      expect(ScheduleLifecycleStatusSchema.parse("superseded")).toBe("superseded");
      expect(ScheduleLifecycleStatusSchema.parse("reverted")).toBe("reverted");
      expect(() => ScheduleLifecycleStatusSchema.parse("deleted")).toThrow();
    });
  });

  describe("ScheduleAdjustmentRecordSchema", () => {
    it("validates a compliant accepted and applied adjustment record", () => {
      const record = {
        adjustmentId: "adj-01",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        userNotes: "Acepto mover la reunión al jueves",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "active",
      };

      const parsed = ScheduleAdjustmentRecordSchema.parse(record);
      expect(parsed.adjustmentId).toBe("adj-01");
      expect(parsed.humanDecision).toBe("accepted");
      expect(parsed.applicationOutcome).toBe("applied");
      expect(parsed.lifecycleStatus).toBe("active");
    });

    it("validates a compliant rejected adjustment record", () => {
      const record = {
        adjustmentId: "adj-02",
        proposalId: "prop-02",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:35:00Z",
        humanDecision: "rejected",
        userNotes: "Prefiero mantener mi bloque original",
        applicationOutcome: "failed",
        failureReason: "Rechazado explícitamente por la persona",
        lifecycleStatus: "active",
      };

      const parsed = ScheduleAdjustmentRecordSchema.parse(record);
      expect(parsed.humanDecision).toBe("rejected");
      expect(parsed.applicationOutcome).toBe("failed");
    });

    it("rejects an adjustment when humanDecision is 'rejected' but applicationOutcome is 'applied'", () => {
      const invalid = {
        adjustmentId: "adj-err1",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "rejected",
        applicationOutcome: "applied", // Contradiction!
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "active",
      };

      expect(() => ScheduleAdjustmentRecordSchema.parse(invalid)).toThrow(
        "A rejected adjustment cannot have applicationOutcome 'applied'"
      );
    });

    it("rejects applicationOutcome 'applied' when appliedAt is missing or failureReason is present", () => {
      // Missing appliedAt
      const missingAppliedAt = {
        adjustmentId: "adj-err2",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        lifecycleStatus: "active",
      };
      expect(() => ScheduleAdjustmentRecordSchema.parse(missingAppliedAt)).toThrow(
        "appliedAt is required when applicationOutcome is 'applied'"
      );

      // Has failureReason while applied
      const withFailureReason = {
        ...missingAppliedAt,
        appliedAt: "2026-10-12T14:30:01Z",
        failureReason: "Some error",
      };
      expect(() => ScheduleAdjustmentRecordSchema.parse(withFailureReason)).toThrow(
        "failureReason must be absent when applicationOutcome is 'applied'"
      );
    });

    it("rejects applicationOutcome 'failed' when failureReason is missing or appliedAt is present", () => {
      // Missing failureReason
      const missingFailure = {
        adjustmentId: "adj-err3",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "failed",
        lifecycleStatus: "active",
      };
      expect(() => ScheduleAdjustmentRecordSchema.parse(missingFailure)).toThrow(
        "failureReason is required when applicationOutcome is 'failed'"
      );

      // Has appliedAt while failed
      const withAppliedAt = {
        ...missingFailure,
        failureReason: "Colisión detectada",
        appliedAt: "2026-10-12T14:30:01Z",
      };
      expect(() => ScheduleAdjustmentRecordSchema.parse(withAppliedAt)).toThrow(
        "appliedAt must be absent when applicationOutcome is 'failed'"
      );
    });

    it("rejects lifecycleStatus 'superseded' or 'reverted' when applicationOutcome is 'failed' (H-02)", () => {
      const baseFailed = {
        adjustmentId: "adj-err4",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted" as const,
        applicationOutcome: "failed" as const,
        failureReason: "Colisión horaria",
      };

      expect(() =>
        ScheduleAdjustmentRecordSchema.parse({
          ...baseFailed,
          lifecycleStatus: "superseded",
        })
      ).toThrow("An adjustment that failed to apply cannot have lifecycleStatus 'superseded' or 'reverted'");

      expect(() =>
        ScheduleAdjustmentRecordSchema.parse({
          ...baseFailed,
          lifecycleStatus: "reverted",
        })
      ).toThrow("An adjustment that failed to apply cannot have lifecycleStatus 'superseded' or 'reverted'");
    });

    it("accepts lifecycleStatus 'superseded' or 'reverted' when applicationOutcome is 'applied' (H-02)", () => {
      const baseApplied = {
        adjustmentId: "adj-hist",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted" as const,
        applicationOutcome: "applied" as const,
        appliedAt: "2026-10-12T14:30:01Z",
      };

      const superseded = ScheduleAdjustmentRecordSchema.parse({
        ...baseApplied,
        lifecycleStatus: "superseded",
      });
      expect(superseded.lifecycleStatus).toBe("superseded");

      const reverted = ScheduleAdjustmentRecordSchema.parse({
        ...baseApplied,
        lifecycleStatus: "reverted",
      });
      expect(reverted.lifecycleStatus).toBe("reverted");
    });
  });

  function createBaseSchedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
    return {
      scheduleId: "sched-001",
      planId: "plan-2026-w42",
      weekRange: validWeekRange,
      timeBlocks: [
        {
          itemId: "item-meeting-01",
          day: "2026-10-13",
          startTime: "10:00",
          endTime: "11:00",
        },
        {
          itemId: "item-focus-01",
          day: "2026-10-13",
          startTime: "11:00",
          endTime: "13:00",
        },
      ],
      dailyAllocations: [
        { itemId: "item-dev-01", day: "2026-10-12", allocatedHours: 3 },
        { itemId: "item-dev-01", day: "2026-10-14", allocatedHours: 2 },
      ],
      dayConstraints: [
        { day: "2026-10-18", availableHours: 0, note: "Domingo sin horas disponibles" },
      ],
      appliedAdjustments: [],
      version: 1,
      createdAt: "2026-10-12T08:00:00Z",
      updatedAt: "2026-10-12T08:00:00Z",
      ...overrides,
    };
  }

  describe("WeeklyScheduleSchema", () => {
    it("parses a minimal schedule with defaults", () => {
      const minimal = {
        scheduleId: "sched-001",
        planId: "plan-2026-w42",
        weekRange: validWeekRange,
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
      };

      const parsed = WeeklyScheduleSchema.parse(minimal);
      expect(parsed.version).toBe(1);
      expect(parsed.timeBlocks).toEqual([]);
      expect(parsed.dailyAllocations).toEqual([]);
      expect(parsed.appliedAdjustments).toEqual([]);
    });

    it("strictly rejects extraneous unexpected properties", () => {
      const withExtra = {
        scheduleId: "sched-001",
        planId: "plan-2026-w42",
        weekRange: validWeekRange,
        createdAt: "2026-10-12T08:00:00Z",
        updatedAt: "2026-10-12T08:00:00Z",
        extraField: "unsupported",
      };

      expect(() => WeeklyScheduleSchema.parse(withExtra)).toThrow();
    });
  });

  describe("validateWeeklyScheduleInvariants", () => {
    it("passes for a consistent, valid weekly schedule", () => {
      const schedule = createBaseSchedule();
      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it("detects timestamp monotonicity error (updatedAt < createdAt)", () => {
      const schedule = createBaseSchedule({
        createdAt: "2026-10-12T10:00:00Z",
        updatedAt: "2026-10-12T09:00:00Z",
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("updatedAt"))).toBe(true);
    });

    it("detects time blocks and daily allocations outside the week range", () => {
      const schedule = createBaseSchedule({
        timeBlocks: [
          {
            itemId: "item-outside",
            day: "2026-10-25", // Outside 2026-10-12 to 2026-10-18
            startTime: "10:00",
            endTime: "11:00",
          },
        ],
        dailyAllocations: [
          {
            itemId: "item-outside-alloc",
            day: "2026-10-05", // Outside
            allocatedHours: 2,
          },
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("item-outside"))).toBe(true);
      expect(res.errors.some((e) => e.includes("item-outside-alloc"))).toBe(true);
    });

    it("detects overlapping schedule collisions on the same day", () => {
      const schedule = createBaseSchedule({
        timeBlocks: [
          {
            itemId: "item-meeting-01",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:30",
          },
          {
            itemId: "item-overlap",
            day: "2026-10-13",
            startTime: "11:00", // Overlaps with 10:00-11:30!
            endTime: "12:00",
          },
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Schedule collision"))).toBe(true);
    });

    it("allows contiguous non-overlapping blocks on the same day", () => {
      const schedule = createBaseSchedule({
        timeBlocks: [
          {
            itemId: "item-block-1",
            day: "2026-10-13",
            startTime: "09:00",
            endTime: "10:00",
          },
          {
            itemId: "item-block-2",
            day: "2026-10-13",
            startTime: "10:00", // Exactly contiguous, no overlap
            endTime: "11:00",
          },
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("allows identical times on different days without collision", () => {
      const schedule = createBaseSchedule({
        timeBlocks: [
          {
            itemId: "item-tuesday",
            day: "2026-10-13",
            startTime: "10:00",
            endTime: "11:00",
          },
          {
            itemId: "item-wednesday",
            day: "2026-10-14",
            startTime: "10:00",
            endTime: "11:00",
          },
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(true);
    });

    it("detects duplicate DailyWorkAllocation for the same item and day", () => {
      const schedule = createBaseSchedule({
        dailyAllocations: [
          { itemId: "item-task-1", day: "2026-10-14", allocatedHours: 2 },
          { itemId: "item-task-1", day: "2026-10-14", allocatedHours: 3 }, // Duplicate!
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Duplicate DailyWorkAllocation"))).toBe(true);
    });

    it("detects duplicate DayConstraint for the same day", () => {
      const schedule = createBaseSchedule({
        dayConstraints: [
          { day: "2026-10-13", availableHours: 4 },
          { day: "2026-10-13", availableHours: 6 }, // Duplicate!
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Duplicate DayConstraint"))).toBe(true);
    });

    it("enforces zero-capacity day constraints against time blocks and allocations", () => {
      const schedule = createBaseSchedule({
        dayConstraints: [
          { day: "2026-10-18", availableHours: 0, note: "Domingo sin horas disponibles" },
        ],
        timeBlocks: [
          {
            itemId: "item-sunday-meeting",
            day: "2026-10-18", // Zero-capacity day!
            startTime: "10:00",
            endTime: "11:00",
          },
        ],
        dailyAllocations: [
          {
            itemId: "item-sunday-work",
            day: "2026-10-18", // Zero-capacity day!
            allocatedHours: 2,
          },
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("declared zero-capacity day"))).toBe(true);
    });

    it("detects adjustment record with expectedScheduleVersion greater than current version", () => {
      const futureRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-future",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 5, // Greater than schedule.version = 1
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "active",
      };

      const schedule = createBaseSchedule({
        version: 1,
        appliedAdjustments: [futureRecord],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("expectedScheduleVersion"))).toBe(true);
    });

    it("detects DayConstraint with day outside weekRange (H-06)", () => {
      const schedule = createBaseSchedule({
        dayConstraints: [
          { day: "2026-10-25", availableHours: 4 }, // Outside 2026-10-12..2026-10-18
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("outside weekRange"))).toBe(true);
    });

    it("enforces positive explicit DayConstraint capacity when allocated hours exceed limit (H-01)", () => {
      const schedule = createBaseSchedule({
        dayConstraints: [
          { day: "2026-10-14", availableHours: 4, note: "Medio día disponible" },
        ],
        dailyAllocations: [
          { itemId: "item-task-1", day: "2026-10-14", allocatedHours: 2.5 },
          { itemId: "item-task-2", day: "2026-10-14", allocatedHours: 2.0 }, // Sum = 4.5 > 4.0
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("exceeds availableHours (4h)"))).toBe(true);
    });

    it("allows allocations within positive explicit DayConstraint capacity (H-01)", () => {
      const schedule = createBaseSchedule({
        dayConstraints: [
          { day: "2026-10-14", availableHours: 5, note: "5 horas disponibles" },
        ],
        dailyAllocations: [
          { itemId: "item-task-1", day: "2026-10-14", allocatedHours: 2.5 },
          { itemId: "item-task-2", day: "2026-10-14", allocatedHours: 2.0 }, // Sum = 4.5 <= 5.0
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(true);
    });

    it("allows allocations on unconstrained days without imposing universal limits (H-01 / H-06)", () => {
      const schedule = createBaseSchedule({
        dailyAllocations: [
          { itemId: "item-big-task", day: "2026-10-15", allocatedHours: 12 }, // No constraint for 2026-10-15
        ],
      });

      const res = validateWeeklyScheduleInvariants(schedule);
      expect(res.valid).toBe(true);
    });
  });

  describe("getActiveAppliedAdjustments (H-05)", () => {
    it("returns only applied and active adjustments, filtering out failed, rejected, superseded, and reverted ones", () => {
      const appliedActive: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-active-1",
        proposalId: "prop-01",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "active",
      };

      const appliedSuperseded: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-superseded-2",
        proposalId: "prop-02",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "superseded",
      };

      const appliedReverted: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-reverted-3",
        proposalId: "prop-03",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "applied",
        appliedAt: "2026-10-12T14:30:01Z",
        lifecycleStatus: "reverted",
      };

      const rejectedRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-rejected-4",
        proposalId: "prop-04",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "rejected",
        applicationOutcome: "failed",
        failureReason: "Rechazado por el usuario",
        lifecycleStatus: "active",
      };

      const failedRecord: ScheduleAdjustmentRecord = {
        adjustmentId: "adj-failed-5",
        proposalId: "prop-05",
        action: sampleAction,
        expectedScheduleVersion: 1,
        decidedAt: "2026-10-12T14:30:00Z",
        humanDecision: "accepted",
        applicationOutcome: "failed",
        failureReason: "Conflict detected",
        lifecycleStatus: "active",
      };

      const schedule = createBaseSchedule({
        appliedAdjustments: [
          appliedActive,
          appliedSuperseded,
          appliedReverted,
          rejectedRecord,
          failedRecord,
        ],
      });

      const active = getActiveAppliedAdjustments(schedule);

      expect(active).toHaveLength(1);
      expect(active[0]?.adjustmentId).toBe("adj-active-1");
      expect(active[0]?.lifecycleStatus).toBe("active");
      expect(active[0]?.applicationOutcome).toBe("applied");

      // Verify immutability: returns new array and does not modify original schedule
      expect(active).not.toBe(schedule.appliedAdjustments);
      expect(schedule.appliedAdjustments).toHaveLength(5);
    });

    it("returns empty array when schedule has no adjustments", () => {
      const schedule = createBaseSchedule({ appliedAdjustments: [] });
      expect(getActiveAppliedAdjustments(schedule)).toEqual([]);
    });
  });
});
