import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ProposedWeek } from "../src/domain/week";
import { WeeklySchedule, validateWeeklyScheduleInvariants } from "../src/domain/schedule";
import { analyzeChangeDeterministically } from "../src/skills/analyze-change/deterministic";
import { detectConflictsDeterministically } from "../src/skills/detect-conflict/deterministic";
import { proposeAdjustmentsDeterministically } from "../src/skills/propose-adjustment/deterministic";
import { manageMemoryDeterministically } from "../src/skills/manage-memory/deterministic";
import { executeCloseWeekDeterministic } from "../src/skills/close-week/deterministic";
import { ItemOutcomeInput } from "../src/domain/close-week";

describe("Skills 07–11 Sample-Input Evaluation Pipeline", () => {
  const evalWeekResultsPath = path.resolve(__dirname, "../cases/eval-week-results.json");
  const rawData = JSON.parse(fs.readFileSync(evalWeekResultsPath, "utf-8"));

  const sampleCaseIds = ["case-01", "case-02", "case-03", "case-04", "case-05"];

  for (const caseId of sampleCaseIds) {
    describe(`Evaluating sample plan output from ${caseId}`, () => {
      const record = rawData[caseId];
      if (!record || !record.proposal) {
        it.skip(`Missing proposal in ${caseId}`, () => {});
        return;
      }

      const proposal = record.proposal as ProposedWeek;
      const targetWeek = proposal.weekSummary.targetWeek;

      function buildSchedule(overrides: Partial<WeeklySchedule> = {}): WeeklySchedule {
        return {
          scheduleId: `sched-${caseId}`,
          planId: `plan-${caseId}`,
          weekRange: targetWeek,
          timeBlocks: proposal.obligations.slice(0, 2).map((ob, idx) => ({
            itemId: ob.itemId,
            day: targetWeek.startDate,
            startTime: idx === 0 ? "10:00" : "14:00",
            endTime: idx === 0 ? "12:00" : "16:00",
            note: ob.title,
          })),
          dailyAllocations: proposal.obligations.map((ob) => ({
            itemId: ob.itemId,
            allocatedHours: ob.estimatedHours ?? 2,
            day: targetWeek.startDate,
          })),
          appliedAdjustments: [],
          version: 1,
          createdAt: "2026-10-12T08:00:00.000Z",
          updatedAt: "2026-10-12T08:00:00.000Z",
          ...overrides,
        };
      }

      it("constructs a valid WeeklySchedule from real proposal tasks", () => {
        const schedule = buildSchedule();
        const invariantCheck = validateWeeklyScheduleInvariants(schedule);
        expect(invariantCheck.errors).toEqual([]);
        expect(invariantCheck.valid).toBe(true);
      });

      it("Skill 07 (analyze_change): evaluates mid-week scope additions deterministically", () => {
        const targetItemId =
          proposal.obligations[0]?.itemId || proposal.flexibleOptions[0]?.itemId || "test-item";
        const result = analyzeChangeDeterministically({
          currentDate: targetWeek.startDate,
          activePlan: proposal,
          changeDescription: "Re-estimación de horas tras evaluación inicial",
          incomingDelta: {
            itemOperations: [
              {
                op: "modify",
                itemId: targetItemId,
                patch: {
                  estimatedHours: 5,
                },
              },
            ],
          },
        });

        expect(result).toBeDefined();
        expect(result.status).toBeTruthy();
        expect(result.capacityImpact).toBeDefined();
      });

      it("Skill 08 (detect_conflict): detects overlaps and capacity stresses without exceptions", () => {
        const schedule = buildSchedule({
          timeBlocks: [
            {
              itemId: "item-overlap-1",
              day: targetWeek.startDate,
              startTime: "10:00",
              endTime: "12:00",
            },
            {
              itemId: "item-overlap-2",
              day: targetWeek.startDate,
              startTime: "11:00",
              endTime: "13:00", // 1 hour collision
            },
          ],
        });

        const conflictOutput = detectConflictsDeterministically({
          currentDate: targetWeek.startDate,
          activePlan: proposal,
          timeBlocks: schedule.timeBlocks,
          dailyAllocations: schedule.dailyAllocations,
        });

        expect(conflictOutput).toBeDefined();
        expect(conflictOutput.conflicts).toBeInstanceOf(Array);
        const collision = conflictOutput.conflicts.find((c) => c.type === "schedule_overlap");
        expect(collision).toBeDefined();
        expect(collision?.type).toBe("schedule_overlap");
      });

      it("Skill 09 (propose_adjustment): generates sovereign actionable choices for detected collisions", () => {
        const schedule = buildSchedule({
          timeBlocks: [
            {
              itemId: "item-adj-1",
              day: targetWeek.startDate,
              startTime: "09:00",
              endTime: "11:00",
            },
            {
              itemId: "item-adj-2",
              day: targetWeek.startDate,
              startTime: "10:30",
              endTime: "12:30",
            },
          ],
        });

        const conflictOutput = detectConflictsDeterministically({
          currentDate: targetWeek.startDate,
          activePlan: proposal,
          timeBlocks: schedule.timeBlocks,
          dailyAllocations: schedule.dailyAllocations,
        });

        const adjustmentOutput = proposeAdjustmentsDeterministically({
          activePlan: proposal,
          timeBlocks: schedule.timeBlocks,
          dailyAllocations: schedule.dailyAllocations,
          conflictReport: conflictOutput,
        });

        expect(adjustmentOutput).toBeDefined();
        expect(adjustmentOutput.status).toBeTruthy();
        expect(adjustmentOutput.proposals).toBeInstanceOf(Array);
      });

      it("Skill 10 & 11 (close_week & manage_memory): completes reflective closure and memory extraction", () => {
        const itemOutcomes: ItemOutcomeInput[] = proposal.obligations.map((ob, idx) => ({
          itemId: ob.itemId,
          status: idx === 0 ? "completed" : "in_progress",
          actualHours: ob.estimatedHours ?? 2,
          userNotes: idx === 0 ? "Completed on time" : "Postponing remaining effort to next week",
          postponementReason: idx === 0 ? undefined : "out_of_capacity",
        }));

        const schedule = buildSchedule();
        const closeResult = executeCloseWeekDeterministic({
          activePlan: proposal,
          planId: schedule.planId,
          schedule,
          itemOutcomes,
          userReflection: {
            generalNotes: "Semana productiva pero exigente en tiempo de revisión.",
            energyLevel: "balanced",
          },
          closedAt: "2026-10-18T20:00:00.000Z",
        });

        expect(["success", "partial_data"]).toContain(closeResult.status);
        expect(closeResult.fociOutcomes).toBeDefined();
        expect(closeResult.memoryCandidates).toBeInstanceOf(Array);

        // Feed extracted candidate memories to Skill 10 (manage_memory)
        const memoryResult = manageMemoryDeterministically({
          referenceDate: "2026-10-18",
          existingMemories: [],
          candidates: closeResult.memoryCandidates,
        });

        expect(memoryResult).toBeDefined();
        expect(memoryResult.status).toBeTruthy();
        expect(memoryResult.proposedOperations).toBeInstanceOf(Array);
      });
    });
  }
});
