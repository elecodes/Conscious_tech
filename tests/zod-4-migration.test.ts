import { describe, it, expect } from "vitest";
import { ProposedWeekSchema } from "../src/domain/week";
import { WeeklyScheduleSchema } from "../src/domain/schedule";
import { WeeklyPlanDraftContextSchema } from "../src/domain/repositories/types";
import { EffortSchema } from "../src/domain/items";
import { CalendarEventSchema } from "../src/domain/calendar";
import { MemoryItemSchema } from "../src/domain/memory";
import { ProposeAdjustmentUserPreferencesSchema } from "../src/domain/adjustment";
import { TimeBlockSchema } from "../src/domain/conflict";

describe("Zod 4 Migration — Strict Object and Default Semantics Parity", () => {
  describe("1. Strict rejection of unknown keys", () => {
    it("rejects unknown keys on ProposedWeekSchema", () => {
      const validWeek = {
        weekSummary: {
          targetWeek: { startDate: "2026-10-12", endDate: "2026-10-18" },
          capacity: {
            totalAvailableHours: 25,
            plannableHours: 18,
            plannedHours: 10,
            knownEstimatedHours: 10,
            estimationCompleteness: "complete",
            protectedSpaceHours: 7,
            capacityStatus: "within_capacity",
            protectedSpaceStatus: "respected",
          },
          intent: "Semana balanceada",
        },
        foci: [],
        obligations: [],
        flexibleOptions: [],
        deferredItems: [],
        unplannedSpace: {
          rationale: "Espacio protegido",
          recommendedHours: 7,
        },
        extraBogusKey: "malicious_payload",
      };

      const result = ProposedWeekSchema.safeParse(validWeek);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
      }
    });

    it("rejects unknown keys on TimeBlockSchema", () => {
      const block = {
        blockId: "block-1",
        date: "2026-10-12",
        startTime: "09:00",
        endTime: "10:00",
        label: "Sync",
        unrecognizedField: true,
      };

      const result = TimeBlockSchema.safeParse(block);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
      }
    });
  });

  describe("2. Default values semantics on missing key, undefined, and null", () => {
    it("EffortSchema: applies default source='user' on missing and undefined, rejects null", () => {
      const base = {
        value: 2,
        unit: "hours" as const,
      };

      // Missing key -> defaults to "user"
      const parsedMissing = EffortSchema.parse(base);
      expect(parsedMissing.source).toBe("user");

      // Explicit undefined -> defaults to "user"
      const parsedUndefined = EffortSchema.parse({ ...base, source: undefined });
      expect(parsedUndefined.source).toBe("user");

      // Explicit null -> rejects
      const resultNull = EffortSchema.safeParse({ ...base, source: null });
      expect(resultNull.success).toBe(false);
    });

    it("WeeklyScheduleSchema: applies default arrays and version=1 on missing and undefined, rejects null", () => {
      const base = {
        scheduleId: "sched-1",
        planId: "plan-1",
        weekRange: { startDate: "2026-10-12", endDate: "2026-10-18" },
        createdAt: "2026-10-12T08:00:00.000Z",
        updatedAt: "2026-10-12T08:00:00.000Z",
      };

      const parsedMissing = WeeklyScheduleSchema.parse(base);
      expect(parsedMissing.timeBlocks).toEqual([]);
      expect(parsedMissing.dailyAllocations).toEqual([]);
      expect(parsedMissing.appliedAdjustments).toEqual([]);
      expect(parsedMissing.version).toBe(1);

      const parsedUndefined = WeeklyScheduleSchema.parse({
        ...base,
        timeBlocks: undefined,
        dailyAllocations: undefined,
        appliedAdjustments: undefined,
        version: undefined,
      });
      expect(parsedUndefined.timeBlocks).toEqual([]);
      expect(parsedUndefined.version).toBe(1);

      expect(WeeklyScheduleSchema.safeParse({ ...base, timeBlocks: null }).success).toBe(false);
      expect(WeeklyScheduleSchema.safeParse({ ...base, version: null }).success).toBe(false);
    });

    it("CalendarEventSchema: applies default allDay=false on missing and undefined, rejects null", () => {
      const base = {
        id: "cal-1",
        title: "Meeting",
        day: "2026-10-12",
        startTime: "10:00",
        endTime: "11:00",
        durationHours: 1,
      };

      expect(CalendarEventSchema.parse(base).allDay).toBe(false);
      expect(CalendarEventSchema.parse({ ...base, allDay: undefined }).allDay).toBe(false);
      expect(CalendarEventSchema.safeParse({ ...base, allDay: null }).success).toBe(false);
    });

    it("MemoryItemSchema: applies default tags=[] on missing and undefined, rejects null", () => {
      const base = {
        id: "mem-1",
        content: "Prefers deep work on Tuesday mornings",
        category: "preference" as const,
        confirmationStatus: "unconfirmed" as const,
        temporalStatus: "active" as const,
        createdAt: "2026-10-12",
        provenance: {
          source: "conversation_inference" as const,
          referenceText: "I usually prefer mornings",
        },
      };

      expect(MemoryItemSchema.parse(base).tags).toEqual([]);
      expect(MemoryItemSchema.parse({ ...base, tags: undefined }).tags).toEqual([]);
      expect(MemoryItemSchema.safeParse({ ...base, tags: null }).success).toBe(false);
    });

    it("ProposeAdjustmentUserPreferencesSchema: applies default maxProposals=3 on missing and undefined", () => {
      const parsedMissing = ProposeAdjustmentUserPreferencesSchema.parse({});
      expect(parsedMissing.maxProposals).toBe(3);

      const parsedUndefined = ProposeAdjustmentUserPreferencesSchema.parse({
        maxProposals: undefined,
      });
      expect(parsedUndefined.maxProposals).toBe(3);

      expect(ProposeAdjustmentUserPreferencesSchema.safeParse({ maxProposals: null }).success).toBe(
        false
      );
    });
  });

  describe("3. Record schema with string keys in WeeklyPlanDraftContextSchema", () => {
    it("parses valid overdueDecisions and deferredDecisions records", () => {
      const draftContext = {
        overdueDecisions: {
          "task-1": {
            decision: "reschedule_future",
            rescheduleTargetWeek: { startDate: "2026-10-19", endDate: "2026-10-25" },
          },
          "task-2": {
            decision: "keep_unscheduled",
          },
        },
        deferredDecisions: {
          "task-3": "intentional_postponement",
          "task-4": "included",
        },
      };

      const result = WeeklyPlanDraftContextSchema.safeParse(draftContext);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overdueDecisions?.["task-1"].decision).toBe("reschedule_future");
        expect(result.data.deferredDecisions?.["task-3"]).toBe("intentional_postponement");
      }
    });
  });
});
