import { z } from "zod";
import { TargetWeek, TargetWeekSchema, ProposedWeekSchema } from "../week";
import { ExtractedItemSchema } from "../items";
import { WeeklySchedule } from "../schedule";
import { CloseWeekOutputSchema, ClosedAtTimestampSchema } from "../close-week";
import {
  MemoryItem,
  MemoryCategorySchema,
  ConfirmationStatusSchema,
  TemporalStatusSchema,
  IsoUtcTimestampSchema,
} from "../memory";

// ============================================================================
// 1. Error Domain Hierarchy for Persistence
// ============================================================================

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export class StaleVersionConflictError extends StorageError {
  constructor(
    public readonly currentVersion: number,
    public readonly expectedVersion: number
  ) {
    super(
      `Stale schedule version conflict: database has version ${currentVersion}, but expected ${expectedVersion}. Re-evaluation required.`
    );
    this.name = "StaleVersionConflictError";
  }
}

export class InvalidRecordDataError extends StorageError {
  constructor(
    public readonly storeName: string,
    public readonly recordId: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(
      `Invalid record data in store "${storeName}" with ID "${recordId}": ${issues.map((i) => i.message).join(", ")}`
    );
    this.name = "InvalidRecordDataError";
  }
}

export class AmbiguousActivePlanError extends StorageError {
  constructor(public readonly activePlanIds: string[]) {
    super(
      `Multiple active weekly plans detected: [${activePlanIds.join(", ")}]. Ambiguity must be resolved before proceeding.`
    );
    this.name = "AmbiguousActivePlanError";
  }
}

export class AmbiguousDraftPlanError extends StorageError {
  constructor(
    public readonly draftPlanIds: string[],
    public readonly targetWeek?: TargetWeek
  ) {
    super(
      `Multiple draft weekly plans detected${
        targetWeek ? ` for week ${targetWeek.startDate}..${targetWeek.endDate}` : ""
      }: [${draftPlanIds.join(", ")}]. Ambiguity must be resolved before proceeding.`
    );
    this.name = "AmbiguousDraftPlanError";
  }
}

export class StorageConnectionError extends StorageError {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "StorageConnectionError";
  }
}

// ============================================================================
// 2. Storage Envelopes and Schemas
// ============================================================================

export const WeeklyPlanStatusSchema = z.enum(["draft", "active", "closed"]);
export type WeeklyPlanStatus = z.infer<typeof WeeklyPlanStatusSchema>;

/**
 * Explicit contextual state for weekly plan drafts.
 * Preserves the original inputs, capacity parameters, decisions, and editing state
 * before the plan is confirmed and activated by the person.
 */
export const WeeklyPlanDraftContextSchema = z
  .object({
    extractedItems: z.array(ExtractedItemSchema).optional(),
    acceptedItemIds: z.array(z.string()).optional(),
    selectedCarryOverItemIds: z.array(z.string()).optional(),
    overdueDecisions: z
      .record(
        z.object({
          decision: z.enum(["keep_unscheduled", "include_recovery", "reschedule_future"]),
          rescheduleTargetWeek: TargetWeekSchema.optional(),
        })
      )
      .optional(),
    deferredDecisions: z
      .record(z.enum(["pending_decision", "intentional_postponement", "included"]))
      .optional(),
    availableHoursInput: z.string().optional(),
    protectedSpacePercentInput: z.string().optional(),
    noteText: z.string().optional(),
    userIntent: z.string().optional(),
    isEditingCapacity: z.boolean().optional(),
  })
  .strict();
export type WeeklyPlanDraftContext = z.infer<typeof WeeklyPlanDraftContextSchema>;

/**
 * Storage envelope for ProposedWeek.
 * Resolves the architectural discrepancy where ProposedWeekSchema is .strict()
 * without a top-level planId, while WeeklySchedule requires a referential planId.
 */
export const StoredWeeklyPlanSchema = z
  .object({
    planId: z.string().min(1),
    targetWeek: TargetWeekSchema,
    status: WeeklyPlanStatusSchema,
    proposal: ProposedWeekSchema,
    draftContext: WeeklyPlanDraftContextSchema.optional(),
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
  })
  .strict();
export type StoredWeeklyPlan = z.infer<typeof StoredWeeklyPlanSchema>;

/**
 * Storage envelope for CloseWeekOutput.
 * Provides a canonical reportId and referential links to planId and scheduleId.
 */
export const StoredCloseWeekReportSchema = z
  .object({
    reportId: z.string().min(1),
    planId: z.string().min(1),
    scheduleId: z.string().min(1).optional(),
    closedAt: ClosedAtTimestampSchema,
    output: CloseWeekOutputSchema,
  })
  .strict();
export type StoredCloseWeekReport = z.infer<typeof StoredCloseWeekReportSchema>;

export const MemoryFilterSchema = z
  .object({
    categories: z.array(MemoryCategorySchema).optional(),
    confirmationStatuses: z.array(ConfirmationStatusSchema).optional(),
    temporalStatuses: z.array(TemporalStatusSchema).optional(),
    referenceDate: z.string().optional(),
  })
  .strict();
export type MemoryFilter = z.infer<typeof MemoryFilterSchema>;

// ============================================================================
// 3. Repository Port Interfaces (Domain-Level, IDB-Agnostic)
// ============================================================================

export interface WeeklyPlanRepository {
  save(plan: StoredWeeklyPlan): Promise<void>;
  getById(planId: string): Promise<StoredWeeklyPlan | null>;
  getActivePlan(): Promise<StoredWeeklyPlan | null>;
  getActivePlans(): Promise<StoredWeeklyPlan[]>;
  getDraftPlans(): Promise<StoredWeeklyPlan[]>;
  getDraftPlan(targetWeek?: TargetWeek): Promise<StoredWeeklyPlan | null>;
  getByWeekRange(week: TargetWeek): Promise<StoredWeeklyPlan | null>;
  getAll(): Promise<StoredWeeklyPlan[]>;
  updateStatus(planId: string, status: WeeklyPlanStatus): Promise<boolean>;
  delete(planId: string): Promise<void>;
}

export interface WeeklyScheduleRepository {
  /**
   * Saves a weekly schedule.
   * If expectedVersion is specified, executes strictly within a readwrite transaction:
   * 1. Reads current version in the transaction.
   * 2. Compares with expectedVersion.
   * 3. Aborts and throws StaleVersionConflictError if mismatched.
   * 4. Writes schedule with version incremented by 1 only if matched.
   * If options.force is true, allows restoring/overwriting an existing record without version collision.
   */
  save(
    schedule: WeeklySchedule,
    expectedVersion?: number,
    options?: { force?: boolean }
  ): Promise<void>;
  getById(scheduleId: string): Promise<WeeklySchedule | null>;
  getByPlanId(planId: string): Promise<WeeklySchedule | null>;
  getAll(): Promise<WeeklySchedule[]>;
  delete(scheduleId: string): Promise<void>;
}

export interface WeeklyCloseRepository {
  save(report: StoredCloseWeekReport): Promise<void>;
  getById(reportId: string): Promise<StoredCloseWeekReport | null>;
  getByPlanId(planId: string): Promise<StoredCloseWeekReport | null>;
  getAll(): Promise<StoredCloseWeekReport[]>;
  delete(reportId: string): Promise<void>;
}

export interface MemoryRepository {
  getById(id: string): Promise<MemoryItem | null>;
  getAll(filter?: MemoryFilter): Promise<MemoryItem[]>;
  save(memory: MemoryItem): Promise<void>;
  saveBatch(memories: MemoryItem[]): Promise<void>;
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// ============================================================================
// 4. Session State Contract for Application Resumption
// ============================================================================

export interface ClosedWeekSummary {
  plan: StoredWeeklyPlan;
  closeReport: StoredCloseWeekReport;
  schedule: WeeklySchedule | null;
}

export interface WeeklySessionState {
  activePlan: StoredWeeklyPlan | null;
  activeSchedule: WeeklySchedule | null;
  latestCloseReport: StoredCloseWeekReport | null;
  memories: MemoryItem[];
  draftPlan?: StoredWeeklyPlan | null;
  draftPlans?: StoredWeeklyPlan[];
}

export interface ExplicitHumanConfirmation {
  confirmedBy: "user_explicit";
  confirmedAt: string; // ISO UTC
  decision: "accepted" | "rejected";
}

export type SessionResumeResult =
  | {
      status: "session_resumed";
      state: WeeklySessionState;
      latestClosedWeek?: ClosedWeekSummary | null;
      draftPlan?: StoredWeeklyPlan | null;
      draftPlans?: StoredWeeklyPlan[];
    }
  | {
      status: "no_active_session";
      state: null;
      memories?: MemoryItem[];
      latestClosedWeek?: ClosedWeekSummary | null;
      draftPlan?: StoredWeeklyPlan | null;
      draftPlans?: StoredWeeklyPlan[];
    }
  | { status: "ambiguous_active_plans"; activePlanIds: string[] }
  | { status: "inconsistent_references"; reason: string };
