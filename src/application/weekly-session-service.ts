import {
  StoredWeeklyPlan,
  StoredCloseWeekReport,
  StoredWeeklyPlanSchema,
  ExplicitHumanConfirmation,
  SessionResumeResult,
  StaleVersionConflictError,
} from "../domain/repositories/types";
import { TargetWeek } from "../domain/week";
import { WeeklySchedule, HumanDecision, applyAdjustmentToSchedule } from "../domain/schedule";
import { SuggestedAdjustmentAction } from "../domain/adjustment";
import { ItemOutcomeInput, UserReflectionInput } from "../domain/close-week";
import { executeCloseWeekDeterministic } from "../skills/close-week/deterministic";
import { MemoryOperation, MemoryItemSchema } from "../domain/memory";
import {
  STORES,
  wrapRequest,
  waitForTransaction,
} from "../infrastructure/storage/indexeddb/database";
import {
  exportUserData,
  importUserData,
  UserDataBackup,
  ImportBackupOptions,
  ImportBackupResult,
} from "../infrastructure/storage/indexeddb/backup";
import {
  WeeklySessionServiceDependencies,
  LatestClosedWeekResult,
  PendingCarryOverTask,
  CreatePlanResult,
  GetPlanResult,
  ApplyAdjustmentServiceResult,
  CloseWeekServiceResult,
  ConfirmMemoryResult,
  PurgePlanResult,
  ReopenWeekResult,
} from "./weekly-session-service-types";
import { findLatestClosedWeek, findPendingCarryOverTasks } from "./weekly-session-carryover";

export * from "./weekly-session-service-types";
export * from "./weekly-session-carryover";

// ============================================================================
// WeeklySessionService Implementation
// ============================================================================

export class WeeklySessionService {
  constructor(private readonly deps: WeeklySessionServiceDependencies) {}

  /**
   * Resumes the weekly session by hydrating the active plan, associated schedule,
   * close report, confirmed active memories, and recovering the latest closed week summary.
   *
   * H-01 RESOLUTION:
   * Rejects recovery if multiple active plans exist, exposing unambiguous error
   * without arbitrary selection.
   */
  async resumeSession(): Promise<SessionResumeResult> {
    const activePlans = await this.deps.plans.getActivePlans();

    if (activePlans.length > 1) {
      return {
        status: "ambiguous_active_plans",
        activePlanIds: activePlans.map((p) => p.planId),
      };
    }

    // Retrieve and cross-validate latest closed week summary
    const closedSummaryResult = await this.getLatestClosedWeek();
    if (closedSummaryResult.status === "inconsistent") {
      return {
        status: "inconsistent_references",
        reason: closedSummaryResult.reason,
      };
    }
    const latestClosedWeek =
      closedSummaryResult.status === "found" ? closedSummaryResult.summary : null;

    // Retrieve draft plans
    let draftPlan: StoredWeeklyPlan | null = null;
    let draftPlans: StoredWeeklyPlan[] = [];
    if (this.deps.plans.getDraftPlans) {
      draftPlans = await this.deps.plans.getDraftPlans();
      if (draftPlans.length === 1) {
        draftPlan = draftPlans[0]!;
      }
    } else if (this.deps.plans.getDraftPlan) {
      try {
        draftPlan = await this.deps.plans.getDraftPlan();
        if (draftPlan) {
          draftPlans = [draftPlan];
        }
      } catch {
        // If ambiguous, leave draftPlan as null
      }
    }

    // Retrieve confirmed active memories
    const activeMemories = await this.deps.memories.getAll({
      temporalStatuses: ["active"],
    });

    if (activePlans.length === 0) {
      return {
        status: "no_active_session",
        state: null,
        memories: activeMemories,
        latestClosedWeek,
        draftPlan,
        draftPlans,
      };
    }

    const activePlan = activePlans[0]!;
    let activeSchedule: WeeklySchedule | null = null;
    let latestCloseReport: StoredCloseWeekReport | null = null;

    // Retrieve and cross-validate schedule
    const foundSchedule = await this.deps.schedules.getByPlanId(activePlan.planId);
    if (foundSchedule) {
      if (foundSchedule.planId !== activePlan.planId) {
        return {
          status: "inconsistent_references",
          reason: `Schedule references planId "${foundSchedule.planId}", expected "${activePlan.planId}"`,
        };
      }
      if (
        foundSchedule.weekRange.startDate !== activePlan.targetWeek.startDate ||
        foundSchedule.weekRange.endDate !== activePlan.targetWeek.endDate
      ) {
        return {
          status: "inconsistent_references",
          reason: `Schedule weekRange (${foundSchedule.weekRange.startDate}..${foundSchedule.weekRange.endDate}) does not match plan targetWeek (${activePlan.targetWeek.startDate}..${activePlan.targetWeek.endDate})`,
        };
      }
      activeSchedule = foundSchedule;
    }

    // Retrieve and cross-validate close report
    const foundClose = await this.deps.closeReports.getByPlanId(activePlan.planId);
    if (foundClose) {
      if (foundClose.planId !== activePlan.planId) {
        return {
          status: "inconsistent_references",
          reason: `Close report references planId "${foundClose.planId}", expected "${activePlan.planId}"`,
        };
      }
      latestCloseReport = foundClose;
    }

    return {
      status: "session_resumed",
      state: {
        activePlan,
        activeSchedule,
        latestCloseReport,
        memories: activeMemories,
        draftPlan,
        draftPlans,
      },
      latestClosedWeek,
      draftPlan,
      draftPlans,
    };
  }

  /**
   * Retrieves and cross-validates the most recent closed week summary.
   */
  async getLatestClosedWeek(): Promise<LatestClosedWeekResult> {
    return findLatestClosedWeek(this.deps);
  }

  /**
   * Retrieves pending carryover candidates from:
   * 1. Consciously postponed tasks in closed week reports.
   * 2. Active postponement adjustments (postpone_item) from persisted schedules.
   */
  async getPendingCarryOverTasks(targetWeek: TargetWeek): Promise<PendingCarryOverTask[]> {
    return findPendingCarryOverTasks(this.deps, targetWeek);
  }

  /**
   * Saves a weekly plan and its optional schedule, validating referential integrity,
   * preventing duplicate active plans, and preserving previous state on schedule failure.
   */
  async createOrSavePlanAndSchedule(
    plan: StoredWeeklyPlan,
    schedule?: WeeklySchedule,
    expectedScheduleVersion?: number
  ): Promise<CreatePlanResult> {
    const parseResult = StoredWeeklyPlanSchema.safeParse(plan);
    if (!parseResult.success) {
      return {
        status: "invalid_data",
        reason: parseResult.error.issues.map((i) => i.message).join(", "),
      };
    }

    // Check referential consistency if schedule is provided
    if (schedule) {
      if (schedule.planId !== plan.planId) {
        return {
          status: "inconsistent_references",
          reason: `Schedule planId "${schedule.planId}" does not match plan "${plan.planId}"`,
        };
      }
      if (
        schedule.weekRange.startDate !== plan.targetWeek.startDate ||
        schedule.weekRange.endDate !== plan.targetWeek.endDate
      ) {
        return {
          status: "inconsistent_references",
          reason: `Schedule weekRange does not match plan targetWeek`,
        };
      }
    }

    // Guard single active plan invariant
    if (plan.status === "active") {
      const existingActives = await this.deps.plans.getActivePlans();
      const duplicateActive = existingActives.find((p) => p.planId !== plan.planId);
      if (duplicateActive) {
        return {
          status: "conflict_active_plan_exists",
          existingActivePlanId: duplicateActive.planId,
        };
      }
    }

    // 1. Snapshot previous plan state before any mutation (Compensating Transaction Pattern)
    const previousPlan = await this.deps.plans.getById(plan.planId);

    await this.deps.plans.save(plan);
    if (schedule) {
      try {
        let scheduleToWrite = schedule;
        let resolvedExpectedVersion = expectedScheduleVersion;

        // If expectedScheduleVersion is not explicitly provided, check if schedule already exists
        if (resolvedExpectedVersion === undefined) {
          const existingSchedule = await this.deps.schedules.getById(schedule.scheduleId);
          if (existingSchedule) {
            // If caller provides a schedule matching current existing version, advance version by 1
            if (schedule.version === existingSchedule.version) {
              resolvedExpectedVersion = existingSchedule.version;
              scheduleToWrite = {
                ...schedule,
                version: existingSchedule.version + 1,
              };
            }
          }
        }

        await this.deps.schedules.save(scheduleToWrite, resolvedExpectedVersion);
        schedule = scheduleToWrite;
      } catch (scheduleError) {
        // COMPENSATING TRANSACTION:
        // Do NOT blindly delete the plan. If the plan existed before this operation,
        // restore its pre-operation state. Only if it was newly created in this operation
        // should it be deleted to clean up an orphan.
        try {
          if (previousPlan) {
            await this.deps.plans.save(previousPlan);
          } else {
            await this.deps.plans.delete(plan.planId);
          }
        } catch {
          // Preserve root cause
        }
        throw scheduleError;
      }
    }

    // ONLY after successful activation, clear the specific draft for this week,
    // preserving drafts of all other weeks!
    if (plan.status === "active") {
      try {
        await this.clearDraftPlan(plan.targetWeek);
      } catch {
        // If draft cleanup fails, do not crash active plan activation
      }
    }

    return {
      status: "success",
      plan,
      schedule: schedule ?? null,
    };
  }

  /**
   * Saves or updates a weekly plan draft without activating it.
   */
  async saveDraftPlan(
    plan: StoredWeeklyPlan
  ): Promise<
    { status: "success"; plan: StoredWeeklyPlan } | { status: "invalid_data"; reason: string }
  > {
    const draftPlan: StoredWeeklyPlan = {
      ...plan,
      status: "draft",
    };
    const parseResult = StoredWeeklyPlanSchema.safeParse(draftPlan);
    if (!parseResult.success) {
      return {
        status: "invalid_data",
        reason: parseResult.error.issues.map((i) => i.message).join(", "),
      };
    }
    await this.deps.plans.save(draftPlan);
    return { status: "success", plan: draftPlan };
  }

  /**
   * Retrieves the stored draft plan for a specific week or unique draft if only one exists.
   */
  async getDraftPlan(targetWeek?: TargetWeek): Promise<StoredWeeklyPlan | null> {
    if (!this.deps.plans.getDraftPlan) return null;
    return this.deps.plans.getDraftPlan(targetWeek);
  }

  /**
   * Retrieves all stored draft plans.
   */
  async getDraftPlans(): Promise<StoredWeeklyPlan[]> {
    if (!this.deps.plans.getDraftPlans) return [];
    return this.deps.plans.getDraftPlans();
  }

  /**
   * Clears stored draft plans for a specific planId, targetWeek, or all drafts if omitted.
   */
  async clearDraftPlan(planIdOrTargetWeek?: string | TargetWeek): Promise<void> {
    if (typeof planIdOrTargetWeek === "string") {
      await this.deps.plans.delete(planIdOrTargetWeek);
      return;
    }
    if (planIdOrTargetWeek && typeof planIdOrTargetWeek === "object") {
      if (this.deps.plans.getDraftPlans) {
        const drafts = await this.deps.plans.getDraftPlans();
        const matching = drafts.filter(
          (d) =>
            d.targetWeek.startDate === planIdOrTargetWeek.startDate &&
            d.targetWeek.endDate === planIdOrTargetWeek.endDate
        );
        for (const draft of matching) {
          await this.deps.plans.delete(draft.planId);
        }
      } else {
        const draft = await this.getDraftPlan(planIdOrTargetWeek);
        if (draft) {
          await this.deps.plans.delete(draft.planId);
        }
      }
      return;
    }
    if (this.deps.plans.getDraftPlans) {
      const drafts = await this.deps.plans.getDraftPlans();
      for (const draft of drafts) {
        await this.deps.plans.delete(draft.planId);
      }
    }
  }

  /**
   * Retrieves a plan and its schedule, verifying referential coherence.
   */
  async getPlanAndSchedule(planId: string): Promise<GetPlanResult> {
    const plan = await this.deps.plans.getById(planId);
    if (!plan) {
      return { status: "not_found", reason: `Plan "${planId}" not found` };
    }

    const schedule = await this.deps.schedules.getByPlanId(planId);
    if (schedule) {
      if (schedule.planId !== plan.planId) {
        return {
          status: "inconsistent_references",
          reason: `Schedule planId "${schedule.planId}" does not match plan "${plan.planId}"`,
        };
      }
    }

    return { status: "success", plan, schedule };
  }

  /**
   * Applies an accepted adjustment to the schedule with optimistic concurrency control.
   * "AI propone. La persona decide."
   */
  async applyAdjustment(params: {
    scheduleId: string;
    proposalId: string;
    adjustmentId: string;
    action: SuggestedAdjustmentAction;
    expectedScheduleVersion: number;
    humanDecision: HumanDecision;
    decidedAt: string;
  }): Promise<ApplyAdjustmentServiceResult> {
    const currentSchedule = await this.deps.schedules.getById(params.scheduleId);
    if (!currentSchedule) {
      return {
        status: "not_found",
        reason: `Schedule "${params.scheduleId}" not found`,
      };
    }

    const storedPlan = await this.deps.plans.getById(currentSchedule.planId);

    // If human rejected the proposal, do not mutate schedule or increment version
    if (params.humanDecision === "rejected") {
      return {
        status: "rejected",
        schedule: currentSchedule,
        reason: "Human user explicitly rejected the adjustment proposal",
      };
    }

    // Apply adjustment deterministically in the domain
    const domainResult = applyAdjustmentToSchedule(currentSchedule, {
      adjustmentId: params.adjustmentId,
      proposalId: params.proposalId,
      action: params.action,
      expectedScheduleVersion: params.expectedScheduleVersion,
      humanDecision: "accepted",
      decidedAt: params.decidedAt,
      activePlan: storedPlan?.proposal,
    });

    if (domainResult.status === "failed") {
      if (domainResult.errorCode === "stale_schedule_version") {
        return {
          status: "concurrency_conflict",
          currentVersion: currentSchedule.version,
          expectedVersion: params.expectedScheduleVersion,
        };
      }
      return {
        status: "failed",
        errorCode: domainResult.errorCode,
        failureReason: domainResult.failureReason,
        schedule: currentSchedule,
      };
    }

    // Persist with optimistic concurrency check in storage
    try {
      await this.deps.schedules.save(domainResult.schedule, params.expectedScheduleVersion);
    } catch (err) {
      if (err instanceof StaleVersionConflictError) {
        return {
          status: "concurrency_conflict",
          currentVersion: err.currentVersion,
          expectedVersion: err.expectedVersion,
        };
      }
      throw err;
    }

    return {
      status: "success",
      schedule: domainResult.schedule,
      appliedRecord: domainResult.appliedRecord,
    };
  }

  /**
   * Closes the current week deterministically and persists the report.
   * Returns memory candidates without auto-persisting them.
   */
  async closeCurrentWeek(params: {
    planId: string;
    closedAt: string;
    itemOutcomes: ItemOutcomeInput[];
    userReflection?: UserReflectionInput;
  }): Promise<CloseWeekServiceResult> {
    const plan = await this.deps.plans.getById(params.planId);
    if (!plan) {
      return { status: "not_found", reason: `Plan "${params.planId}" not found` };
    }

    // Idempotency guard: if plan is already closed, return existing close report without re-executing
    if (plan.status === "closed") {
      const existingClose = await this.deps.closeReports.getByPlanId(params.planId);
      if (existingClose) {
        return {
          status: "success",
          closeReport: existingClose,
          memoryCandidates: existingClose.output.memoryCandidates,
        };
      }
    }

    const schedule = await this.deps.schedules.getByPlanId(params.planId);

    const closeOutput = executeCloseWeekDeterministic({
      closedAt: params.closedAt,
      activePlan: plan.proposal,
      schedule: schedule ?? undefined,
      itemOutcomes: params.itemOutcomes,
      userReflection: params.userReflection,
    });

    const reportId = `close-${params.planId}-${params.closedAt}`;
    const storedReport: StoredCloseWeekReport = {
      reportId,
      planId: params.planId,
      scheduleId: schedule?.scheduleId,
      closedAt: params.closedAt,
      output: closeOutput,
    };

    // Atomically persist close report and close plan status
    if (this.deps.getDb) {
      const db = this.deps.getDb();
      const tx = db.transaction([STORES.CLOSE_REPORTS, STORES.PLANS], "readwrite");
      try {
        const closeStore = tx.objectStore(STORES.CLOSE_REPORTS);
        const plansStore = tx.objectStore(STORES.PLANS);

        // Put close report
        closeStore.put(storedReport);

        // Retrieve plan, update status, and put
        const rawPlan = await wrapRequest(plansStore.get(params.planId));
        if (rawPlan) {
          (rawPlan as StoredWeeklyPlan).status = "closed";
          (rawPlan as StoredWeeklyPlan).updatedAt = params.closedAt.includes("T")
            ? params.closedAt
            : new Date().toISOString();
          plansStore.put(rawPlan);
        }

        await waitForTransaction(tx);
      } catch (err) {
        try {
          tx.abort();
        } catch {
          // Ignored if already aborted
        }
        return {
          status: "failed",
          reason: (err as Error).message || "Atomic close week transaction failed",
        };
      }
    } else {
      // Fallback for mock/in-memory repositories without direct IDBDatabase access
      await this.deps.closeReports.save(storedReport);
      await this.deps.plans.updateStatus(params.planId, "closed");
    }

    return {
      status: "success",
      closeReport: storedReport,
      memoryCandidates: closeOutput.memoryCandidates,
    };
  }

  /**
   * Reopens a closed weekly plan, returning it to active state and removing
   * any premature close report.
   *
   * SOVEREIGNTY INVARIANT:
   * The human user remains in control and must be able to correct premature
   * closure or reopen a week to adjust items, as long as no other active
   * plan exists.
   */
  async reopenWeek(planId: string): Promise<ReopenWeekResult> {
    const plan = await this.deps.plans.getById(planId);
    if (!plan) {
      return { status: "not_found", reason: `Plan "${planId}" not found` };
    }

    if (plan.status !== "closed") {
      return {
        status: "not_closed",
        reason: `Plan "${planId}" is not closed (current status: "${plan.status}")`,
      };
    }

    const existingActives = await this.deps.plans.getActivePlans();
    const otherActive = existingActives.find((p) => p.planId !== planId);
    if (otherActive) {
      return {
        status: "conflict_active_plan_exists",
        existingActivePlanId: otherActive.planId,
      };
    }

    const existingClose = await this.deps.closeReports.getByPlanId(planId);
    const updatedPlan: StoredWeeklyPlan = {
      ...plan,
      status: "active",
      updatedAt: new Date().toISOString(),
    };

    if (this.deps.getDb) {
      const db = this.deps.getDb();
      const tx = db.transaction([STORES.CLOSE_REPORTS, STORES.PLANS], "readwrite");
      try {
        const closeStore = tx.objectStore(STORES.CLOSE_REPORTS);
        const plansStore = tx.objectStore(STORES.PLANS);

        if (existingClose) {
          closeStore.delete(existingClose.reportId);
        }

        plansStore.put(updatedPlan);
        await waitForTransaction(tx);
      } catch (err) {
        try {
          tx.abort();
        } catch {
          // Ignored if already aborted
        }
        return {
          status: "failed",
          reason: (err as Error).message || "Atomic reopen week transaction failed",
        };
      }
    } else {
      if (existingClose) {
        await this.deps.closeReports.delete(existingClose.reportId);
      }
      await this.deps.plans.save(updatedPlan);
    }

    return {
      status: "success",
      plan: updatedPlan,
    };
  }

  /**
   * Confirms and applies a memory operation requiring explicit human confirmation.
   *
   * SOVEREIGNTY INVARIANT:
   * MemoryCandidates from close_week or evaluate_context are NEVER persisted automatically.
   * Only operations with an explicit accepted human confirmation will persist a MemoryItem.
   * evidenceReference is a provenance anchor, NOT cryptographic authorization.
   */
  async confirmAndApplyMemoryOperation(
    operation: MemoryOperation,
    confirmation: ExplicitHumanConfirmation
  ): Promise<ConfirmMemoryResult> {
    if (confirmation.confirmedBy !== "user_explicit" || confirmation.decision !== "accepted") {
      return {
        status: "rejected",
        reason: "Operation rejected: explicit human acceptance was not provided.",
      };
    }

    switch (operation.type) {
      case "add": {
        const parseCheck = MemoryItemSchema.safeParse(operation.proposedMemory);
        if (!parseCheck.success) {
          return {
            status: "invalid_operation",
            reason: `Proposed memory violates schema or epistemic invariants: ${parseCheck.error.issues.map((i) => i.message).join("; ")}`,
          };
        }
        await this.deps.memories.save(parseCheck.data);
        return {
          status: "applied",
          operationType: "add",
          memoryId: parseCheck.data.id,
        };
      }

      case "update": {
        const existing = await this.deps.memories.getById(operation.targetMemoryId);
        if (!existing) {
          return {
            status: "not_found",
            reason: `Target memory "${operation.targetMemoryId}" does not exist.`,
          };
        }
        const todayDate = new Date().toISOString().split("T")[0]!;
        const updatedTarget = {
          ...existing,
          ...operation.updatedFields,
          updatedAt: todayDate,
        };
        const parseCheck = MemoryItemSchema.safeParse(updatedTarget);
        if (!parseCheck.success) {
          return {
            status: "invalid_operation",
            reason: `Updated memory violates schema: ${parseCheck.error.issues.map((i) => i.message).join("; ")}`,
          };
        }
        await this.deps.memories.save(parseCheck.data);
        return {
          status: "applied",
          operationType: "update",
          memoryId: operation.targetMemoryId,
        };
      }

      case "archive": {
        const existing = await this.deps.memories.getById(operation.targetMemoryId);
        if (!existing) {
          return {
            status: "not_found",
            reason: `Target memory "${operation.targetMemoryId}" does not exist.`,
          };
        }
        await this.deps.memories.archive(operation.targetMemoryId);
        return {
          status: "applied",
          operationType: "archive",
          memoryId: operation.targetMemoryId,
        };
      }

      case "forget": {
        await this.deps.memories.delete(operation.targetMemoryId);
        return {
          status: "applied",
          operationType: "forget",
          memoryId: operation.targetMemoryId,
        };
      }

      case "merge": {
        const parseCheck = MemoryItemSchema.safeParse(operation.mergedMemory);
        if (!parseCheck.success) {
          return {
            status: "invalid_operation",
            reason: `Merged memory violates schema: ${parseCheck.error.issues.map((i) => i.message).join("; ")}`,
          };
        }
        await this.deps.memories.save(parseCheck.data);
        // Archive/delete source memories
        for (const sourceId of operation.sourceMemoryIds) {
          await this.deps.memories.delete(sourceId);
        }
        return {
          status: "applied",
          operationType: "merge",
          memoryId: parseCheck.data.id,
        };
      }

      case "keep": {
        return {
          status: "applied",
          operationType: "keep",
          memoryId: operation.targetMemoryId,
        };
      }

      case "request_clarification": {
        return {
          status: "invalid_operation",
          reason: "Clarification request cannot be persisted as a confirmed memory item.",
        };
      }
    }
  }

  /**
   * Atomically purges a plan and all its associated schedule and close report data.
   *
   * H-02 RESOLUTION:
   * Uses a single multi-store transaction across `plans`, `schedules`, and `close_reports`.
   * A failure or abort guarantees zero partial deletions.
   */
  async purgePlanAndAssociatedData(planId: string): Promise<PurgePlanResult> {
    if (!this.deps.getDb) {
      // Fallback if not running directly on IndexedDB context
      const plan = await this.deps.plans.getById(planId);
      if (!plan) {
        return { status: "not_found", reason: `Plan "${planId}" not found` };
      }
      const sched = await this.deps.schedules.getByPlanId(planId);
      if (sched) await this.deps.schedules.delete(sched.scheduleId);
      const close = await this.deps.closeReports.getByPlanId(planId);
      if (close) await this.deps.closeReports.delete(close.reportId);
      await this.deps.plans.delete(planId);
      return { status: "success", purgedPlanId: planId };
    }

    const db = this.deps.getDb();
    const tx = db.transaction([STORES.PLANS, STORES.SCHEDULES, STORES.CLOSE_REPORTS], "readwrite");

    try {
      const plansStore = tx.objectStore(STORES.PLANS);
      const schedulesStore = tx.objectStore(STORES.SCHEDULES);
      const closeStore = tx.objectStore(STORES.CLOSE_REPORTS);

      // Verify plan exists
      const planRaw = await wrapRequest(plansStore.get(planId));
      if (!planRaw) {
        tx.abort();
        return { status: "not_found", reason: `Plan "${planId}" not found` };
      }

      // Find schedule by index and delete
      const schedIndex = schedulesStore.index("by_plan_id");
      const schedRaw = await wrapRequest(schedIndex.get(planId));
      if (schedRaw) {
        const schedId = (schedRaw as { scheduleId: string }).scheduleId;
        schedulesStore.delete(schedId);
      }

      // Find close report by index and delete
      const closeIndex = closeStore.index("by_plan_id");
      const closeRaw = await wrapRequest(closeIndex.get(planId));
      if (closeRaw) {
        const reportId = (closeRaw as { reportId: string }).reportId;
        closeStore.delete(reportId);
      }

      // Delete plan
      plansStore.delete(planId);

      // Await multi-store transaction commit
      await waitForTransaction(tx);

      return { status: "success", purgedPlanId: planId };
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Ignored if already aborted
      }
      return {
        status: "failed",
        reason: (err as Error).message || "Multi-store transaction failed",
      };
    }
  }

  /**
   * Archives a memory item, marking it outdated so it no longer biases future plans
   * while keeping historical audit integrity.
   */
  async archiveMemory(id: string): Promise<void> {
    await this.deps.memories.archive(id);
  }

  /**
   * Hard-deletes a memory item completely (right to be forgotten / privacy).
   */
  async deleteMemory(id: string): Promise<void> {
    await this.deps.memories.delete(id);
  }

  /**
   * Exports the entire user data across all 4 IndexedDB stores.
   */
  async exportBackup(): Promise<UserDataBackup> {
    return exportUserData({
      plans: this.deps.plans,
      schedules: this.deps.schedules,
      closeReports: this.deps.closeReports,
      memories: this.deps.memories,
    });
  }

  /**
   * Validates and imports user data from a JSON backup.
   */
  async importBackup(
    jsonString: string,
    options?: ImportBackupOptions
  ): Promise<ImportBackupResult> {
    return importUserData(
      jsonString,
      {
        plans: this.deps.plans,
        schedules: this.deps.schedules,
        closeReports: this.deps.closeReports,
        memories: this.deps.memories,
      },
      options
    );
  }
}
