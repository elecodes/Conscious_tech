import {
  WeeklyPlanRepository,
  WeeklyScheduleRepository,
  WeeklyCloseRepository,
  MemoryRepository,
  StoredWeeklyPlan,
  StoredCloseWeekReport,
  ClosedWeekSummary,
} from "../domain/repositories/types";
import { TargetWeek } from "../domain/week";
import { WeeklySchedule, ScheduleAdjustmentRecord } from "../domain/schedule";
import { StoreCandidate, MemoryOperation } from "../domain/memory";

export type CreatePlanResult =
  | { status: "success"; plan: StoredWeeklyPlan; schedule: WeeklySchedule | null }
  | { status: "conflict_active_plan_exists"; existingActivePlanId: string }
  | { status: "inconsistent_references"; reason: string }
  | { status: "invalid_data"; reason: string };

export type GetPlanResult =
  | { status: "success"; plan: StoredWeeklyPlan; schedule: WeeklySchedule | null }
  | { status: "not_found"; reason: string }
  | { status: "inconsistent_references"; reason: string };

export type ApplyAdjustmentServiceResult =
  | {
      status: "success";
      schedule: WeeklySchedule;
      appliedRecord: ScheduleAdjustmentRecord;
    }
  | {
      status: "rejected";
      schedule: WeeklySchedule;
      reason: string;
    }
  | {
      status: "concurrency_conflict";
      currentVersion: number;
      expectedVersion: number;
    }
  | {
      status: "failed";
      errorCode: string;
      failureReason: string;
      schedule: WeeklySchedule;
    }
  | {
      status: "not_found";
      reason: string;
    };

export type CloseWeekServiceResult =
  | {
      status: "success";
      closeReport: StoredCloseWeekReport;
      memoryCandidates: StoreCandidate[];
    }
  | {
      status: "not_found";
      reason: string;
    }
  | {
      status: "failed";
      reason: string;
    };

export type ConfirmMemoryResult =
  | { status: "applied"; operationType: MemoryOperation["type"]; memoryId: string }
  | { status: "rejected"; reason: string }
  | { status: "invalid_operation"; reason: string }
  | { status: "not_found"; reason: string };

export type PurgePlanResult =
  | { status: "success"; purgedPlanId: string }
  | { status: "not_found"; reason: string }
  | { status: "failed"; reason: string };

export type ReopenWeekResult =
  | { status: "success"; plan: StoredWeeklyPlan }
  | { status: "conflict_active_plan_exists"; existingActivePlanId: string }
  | { status: "not_found"; reason: string }
  | { status: "not_closed"; reason: string }
  | { status: "failed"; reason: string };

export type LatestClosedWeekResult =
  | { status: "found"; summary: ClosedWeekSummary }
  | { status: "none" }
  | { status: "inconsistent"; reason: string };

export interface PendingCarryOverTask {
  itemId: string;
  title: string;
  originCategory: string;
  postponementReason: string;
  targetWeek?: TargetWeek;
  dueDate?: string;
  estimatedHours?: number | null;
}

export interface WeeklySessionServiceDependencies {
  plans: WeeklyPlanRepository;
  schedules: WeeklyScheduleRepository;
  closeReports: WeeklyCloseRepository;
  memories: MemoryRepository;
  getDb?: () => IDBDatabase;
}
