import React, {
  createContext,
  useContext,
  useSyncExternalStore,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  WeeklySessionService,
  CreatePlanResult,
  ApplyAdjustmentServiceResult,
  CloseWeekServiceResult,
  ConfirmMemoryResult,
  PurgePlanResult,
  ReopenWeekResult,
} from "../../application/weekly-session-service";
import {
  StoredWeeklyPlan,
  StoredCloseWeekReport,
  ExplicitHumanConfirmation,
  ClosedWeekSummary,
} from "../../domain/repositories/types";
import { WeeklySchedule, HumanDecision } from "../../domain/schedule";
import { SuggestedAdjustmentAction } from "../../domain/adjustment";
import { ItemOutcomeInput, UserReflectionInput } from "../../domain/close-week";
import {
  MemoryItem,
  MemoryOperation,
  StoreCandidate,
  isValidEpistemicState,
} from "../../domain/memory";
import { createIndexedDbStorage } from "../../infrastructure/storage/indexeddb";
import {
  UserDataBackup,
  ImportBackupOptions,
  ImportBackupResult,
} from "../../infrastructure/storage/indexeddb/backup";
import { TargetWeek } from "../../domain/week";

// ============================================================================
// State Definition
// ============================================================================

export type WeeklySessionUIStatus =
  | "loading"
  | "no_active_session"
  | "session_resumed"
  | "ambiguous_active_plans"
  | "inconsistent_references"
  | "error";

export interface WeeklySessionUIState {
  status: WeeklySessionUIStatus;
  activePlan: StoredWeeklyPlan | null;
  activeSchedule: WeeklySchedule | null;
  latestCloseReport: StoredCloseWeekReport | null;
  latestClosedPlan: StoredWeeklyPlan | null;
  latestClosedWeek: ClosedWeekSummary | null;
  concurrencyConflict: { currentVersion: number; expectedVersion: number } | null;
  memories: MemoryItem[];
  memoryCandidates: StoreCandidate[];
  ambiguousPlanIds: string[];
  inconsistencyReason: string | null;
  errorMessage: string | null;
  draftPlan: StoredWeeklyPlan | null;
  draftPlans?: StoredWeeklyPlan[];
}

export const initialWeeklySessionState: WeeklySessionUIState = {
  status: "loading",
  activePlan: null,
  activeSchedule: null,
  latestCloseReport: null,
  latestClosedPlan: null,
  latestClosedWeek: null,
  concurrencyConflict: null,
  memories: [],
  memoryCandidates: [],
  ambiguousPlanIds: [],
  inconsistencyReason: null,
  errorMessage: null,
  draftPlan: null,
  draftPlans: [],
};

// ============================================================================
// Store / Controller Implementation (Concurrency-safe & Strict Mode-safe)
// ============================================================================

export class WeeklySessionController {
  private state: WeeklySessionUIState = { ...initialWeeklySessionState };
  private listeners = new Set<() => void>();
  private currentResumeId = 0;
  private isClosing = false;
  private isSavingPlan = false;

  constructor(private readonly service: WeeklySessionService) {}

  public getSnapshot = (): WeeklySessionUIState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(updater: (prev: WeeklySessionUIState) => WeeklySessionUIState) {
    this.state = updater(this.state);
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Resumes the active session using WeeklySessionService.
   * Concurrency guard: increments resumeId so stale or cancelled async operations
   * cannot overwrite newer state under React Strict Mode re-mounts.
   */
  public async reloadSession(): Promise<void> {
    const resumeId = ++this.currentResumeId;
    this.setState((s) => ({
      ...s,
      status: "loading",
      concurrencyConflict: null,
      errorMessage: null,
    }));

    try {
      const result = await this.service.resumeSession();

      // Guard against superseded or stale resolutions
      if (resumeId !== this.currentResumeId) {
        return;
      }

      switch (result.status) {
        case "session_resumed":
          this.setState((s) => ({
            ...s,
            status: "session_resumed",
            activePlan: result.state.activePlan,
            activeSchedule: result.state.activeSchedule,
            latestCloseReport: result.state.latestCloseReport,
            latestClosedPlan:
              result.state.activePlan?.status === "closed"
                ? result.state.activePlan
                : s.latestClosedPlan,
            latestClosedWeek: result.latestClosedWeek ?? null,
            memories: result.state.memories,
            draftPlan: result.draftPlan ?? null,
            draftPlans: result.draftPlans ?? [],
            ambiguousPlanIds: [],
            inconsistencyReason: null,
            concurrencyConflict: null,
            errorMessage: null,
          }));
          break;

        case "no_active_session":
          this.setState((s) => ({
            ...s,
            status: "no_active_session",
            activePlan: null,
            activeSchedule: null,
            latestCloseReport: result.latestClosedWeek?.closeReport ?? null,
            latestClosedPlan: result.latestClosedWeek?.plan ?? null,
            latestClosedWeek: result.latestClosedWeek ?? null,
            memories: result.memories ?? s.memories ?? [],
            memoryCandidates: s.memoryCandidates.length > 0 ? s.memoryCandidates : [],
            draftPlan: result.draftPlan ?? null,
            draftPlans: result.draftPlans ?? [],
            ambiguousPlanIds: [],
            inconsistencyReason: null,
            concurrencyConflict: null,
            errorMessage: null,
          }));
          break;

        case "ambiguous_active_plans":
          this.setState((s) => ({
            ...s,
            status: "ambiguous_active_plans",
            activePlan: null,
            activeSchedule: null,
            latestCloseReport: null,
            draftPlan: null,
            ambiguousPlanIds: result.activePlanIds,
            inconsistencyReason: null,
            concurrencyConflict: null,
            errorMessage: null,
          }));
          break;

        case "inconsistent_references":
          this.setState((s) => ({
            ...s,
            status: "inconsistent_references",
            activePlan: null,
            activeSchedule: null,
            latestCloseReport: null,
            draftPlan: null,
            ambiguousPlanIds: [],
            inconsistencyReason: result.reason,
            concurrencyConflict: null,
            errorMessage: null,
          }));
          break;
      }
    } catch (err) {
      if (resumeId !== this.currentResumeId) return;
      this.setState((s) => ({
        ...s,
        status: "error",
        concurrencyConflict: null,
        errorMessage: (err as Error).message || "Failed to resume weekly session",
      }));
    }
  }

  /**
   * Saves or creates a new weekly plan and optional schedule.
   * Concurrency guard: prevents overlapping save calls (double-click protection).
   */
  public async createOrSavePlan(
    plan: StoredWeeklyPlan,
    schedule?: WeeklySchedule,
    expectedScheduleVersion?: number
  ): Promise<CreatePlanResult> {
    if (this.isSavingPlan) {
      return {
        status: "conflict_active_plan_exists",
        existingActivePlanId: plan.planId,
      };
    }

    this.isSavingPlan = true;
    try {
      const result = await this.service.createOrSavePlanAndSchedule(
        plan,
        schedule,
        expectedScheduleVersion
      );
      if (result.status === "success") {
        await this.reloadSession();
      }
      return result;
    } finally {
      this.isSavingPlan = false;
    }
  }

  /**
   * Applies an adjustment proposal.
   * If concurrency conflict occurs, sets concurrencyConflict in state without assuming application.
   */
  public async applyAdjustment(params: {
    scheduleId: string;
    proposalId: string;
    adjustmentId: string;
    action: SuggestedAdjustmentAction;
    expectedScheduleVersion: number;
    humanDecision: HumanDecision;
    decidedAt?: string;
  }): Promise<ApplyAdjustmentServiceResult> {
    const decidedAt = params.decidedAt ?? new Date().toISOString();
    const result = await this.service.applyAdjustment({
      ...params,
      decidedAt,
    });

    if (result.status === "success") {
      this.setState((s) => ({
        ...s,
        activeSchedule: result.schedule,
        concurrencyConflict: null,
      }));
    } else if (result.status === "concurrency_conflict") {
      this.setState((s) => ({
        ...s,
        concurrencyConflict: {
          currentVersion: result.currentVersion,
          expectedVersion: result.expectedVersion,
        },
      }));
    }

    return result;
  }

  /**
   * Closes the current week deterministically.
   * Guards against concurrent close triggers and updates latestClosedPlan.
   * NEVER auto-saves memory items.
   */
  public async closeWeek(params: {
    planId: string;
    closedAt: string;
    itemOutcomes: ItemOutcomeInput[];
    userReflection?: UserReflectionInput;
  }): Promise<CloseWeekServiceResult> {
    if (this.isClosing) {
      return {
        status: "failed",
        reason: "Ya existe una operación de cierre en curso.",
      };
    }

    this.isClosing = true;
    try {
      const result = await this.service.closeCurrentWeek(params);
      if (result.status === "success") {
        this.setState((s) => {
          const closedPlan: StoredWeeklyPlan | null = s.activePlan
            ? {
                ...s.activePlan,
                status: "closed",
                updatedAt: params.closedAt.includes("T")
                  ? params.closedAt
                  : new Date().toISOString(),
              }
            : null;
          return {
            ...s,
            activePlan: closedPlan,
            latestClosedPlan: closedPlan,
            latestCloseReport: result.closeReport,
            latestClosedWeek: closedPlan
              ? {
                  plan: closedPlan,
                  closeReport: result.closeReport,
                  schedule: s.activeSchedule,
                }
              : s.latestClosedWeek,
            memoryCandidates: result.memoryCandidates,
          };
        });
      }
      return result;
    } finally {
      this.isClosing = false;
    }
  }

  /**
   * Reopens a closed week plan and resumes session.
   * "AI propone. La persona decide."
   */
  public async reopenWeek(planId: string): Promise<ReopenWeekResult> {
    let result: ReopenWeekResult;
    if (typeof this.service.reopenWeek === "function") {
      result = await this.service.reopenWeek(planId);
    } else if (typeof WeeklySessionService.prototype.reopenWeek === "function") {
      result = await WeeklySessionService.prototype.reopenWeek.call(this.service, planId);
    } else {
      return {
        status: "failed",
        reason: "Por favor recargá la página del navegador para actualizar el servicio en memoria.",
      };
    }

    if (result.status === "success") {
      await this.reloadSession();
    }
    return result;
  }

  /**
   * Confirms a memory candidate from the weekly close report.
   * Checks candidate freshness: rejects stale candidates if no longer pending in state.
   * Requires explicit human decision ("accepted" | "rejected").
   */
  public async confirmMemoryCandidate(
    candidate: StoreCandidate,
    decision: "accepted" | "rejected"
  ): Promise<ConfirmMemoryResult> {
    // Stale check: guarantee candidate is still pending in this session state
    const isPending = this.state.memoryCandidates.some(
      (c) => c.candidateId === candidate.candidateId
    );
    if (!isPending) {
      return {
        status: "rejected",
        reason: "El candidato de memoria ya no está pendiente o es obsoleto.",
      };
    }

    const confirmation: ExplicitHumanConfirmation = {
      confirmedBy: "user_explicit",
      decision,
      confirmedAt: new Date().toISOString(),
    };

    if (decision === "rejected") {
      // Human rejected: remove candidate from pending list without persisting
      this.setState((s) => ({
        ...s,
        memoryCandidates: s.memoryCandidates.filter(
          (c) => c.candidateId !== candidate.candidateId
        ),
      }));
      return {
        status: "rejected",
        reason: "User explicitly rejected memory candidate.",
      };
    }

    const today = new Date().toISOString().split("T")[0]!;
    const category = candidate.suggestedCategory ?? "fact";
    const provenanceSource = candidate.isExplicitUserStatement
      ? "user_explicit"
      : (candidate.provenanceSource ?? "system");

    // Check epistemic validation
    const epistemicCheck = isValidEpistemicState(category, "confirmed", {
      source: provenanceSource,
      referenceText: candidate.evidenceReference ?? candidate.rawText,
    });

    const confirmationStatus = epistemicCheck.valid ? "confirmed" : "unconfirmed";

    const proposedMemory: MemoryItem = {
      id: `mem-${candidate.candidateId}`,
      content: candidate.rawText,
      category,
      confirmationStatus,
      temporalStatus: "active",
      tags: [],
      provenance: {
        source: provenanceSource,
        referenceText: candidate.evidenceReference ?? candidate.rawText,
      },
      validUntil: candidate.validUntil ?? null,
      createdAt: today,
    };

    const operation: MemoryOperation = {
      type: "add",
      candidateId: candidate.candidateId,
      proposedMemory,
      rationale: `Human user confirmed memory candidate ${candidate.candidateId}`,
      requiresHumanConfirmation: true,
    };

    const result = await this.service.confirmAndApplyMemoryOperation(
      operation,
      confirmation
    );

    if (result.status === "applied") {
      // Remove candidate from pending list and add to confirmed memories
      this.setState((s) => ({
        ...s,
        memoryCandidates: s.memoryCandidates.filter(
          (c) => c.candidateId !== candidate.candidateId
        ),
        memories: [...s.memories, proposedMemory],
      }));
    }

    return result;
  }

  /**
   * Confirms any general MemoryOperation with explicit confirmation.
   */
  public async confirmMemoryOperation(
    operation: MemoryOperation,
    confirmation: ExplicitHumanConfirmation
  ): Promise<ConfirmMemoryResult> {
    const result = await this.service.confirmAndApplyMemoryOperation(
      operation,
      confirmation
    );
    if (result.status === "applied") {
      await this.reloadSession();
    }
    return result;
  }

  /**
   * Atomically purges a plan and related records.
   */
  public async purgeSession(planId: string): Promise<PurgePlanResult> {
    const result = await this.service.purgePlanAndAssociatedData(planId);
    if (result.status === "success") {
      await this.reloadSession();
    }
    return result;
  }

  /**
   * Resolves ambiguity by explicitly keeping one active plan and purging others.
   * Never makes an implicit or silent choice.
   */
  public async resolveAmbiguity(keepPlanId: string): Promise<void> {
    const ambiguousIds = this.state.ambiguousPlanIds;
    const others = ambiguousIds.filter((id) => id !== keepPlanId);

    for (const otherId of others) {
      await this.service.purgePlanAndAssociatedData(otherId);
    }

    await this.reloadSession();
  }

  /**
   * Retrieves a draft plan for a specific target week or unique draft.
   */
  public async getDraftPlan(targetWeek?: TargetWeek): Promise<StoredWeeklyPlan | null> {
    return this.service.getDraftPlan(targetWeek);
  }

  /**
   * Saves a weekly plan draft without activating it.
   */
  public async saveDraftPlan(
    plan: StoredWeeklyPlan
  ): Promise<{ status: "success"; plan: StoredWeeklyPlan } | { status: "invalid_data"; reason: string }> {
    const result = await this.service.saveDraftPlan(plan);
    if (result.status === "success") {
      this.setState((s) => {
        const currentDrafts = s.draftPlans ?? [];
        const others = currentDrafts.filter((d) => d.planId !== result.plan.planId);
        return {
          ...s,
          draftPlan: result.plan,
          draftPlans: [...others, result.plan],
        };
      });
    }
    return result;
  }

  /**
   * Clears stored draft plans.
   */
  public async clearDraftPlan(planIdOrTargetWeek?: string | TargetWeek): Promise<void> {
    await this.service.clearDraftPlan(planIdOrTargetWeek);
    if (typeof planIdOrTargetWeek === "string") {
      this.setState((s) => ({
        ...s,
        draftPlan: s.draftPlan?.planId === planIdOrTargetWeek ? null : s.draftPlan,
        draftPlans: (s.draftPlans ?? []).filter((d) => d.planId !== planIdOrTargetWeek),
      }));
    } else if (planIdOrTargetWeek && typeof planIdOrTargetWeek === "object") {
      this.setState((s) => ({
        ...s,
        draftPlan:
          s.draftPlan?.targetWeek.startDate === planIdOrTargetWeek.startDate
            ? null
            : s.draftPlan,
        draftPlans: (s.draftPlans ?? []).filter(
          (d) => d.targetWeek.startDate !== planIdOrTargetWeek.startDate
        ),
      }));
    } else {
      this.setState((s) => ({ ...s, draftPlan: null, draftPlans: [] }));
    }
  }

  /**
   * Archives a memory item so it no longer biases future proposals.
   */
  public async archiveMemory(id: string): Promise<void> {
    await this.service.archiveMemory(id);
    await this.reloadSession();
  }

  /**
   * Hard-deletes a memory item completely (right to be forgotten).
   */
  public async deleteMemory(id: string): Promise<void> {
    await this.service.deleteMemory(id);
    await this.reloadSession();
  }

  /**
   * Exports full database contents into a structured JSON backup.
   */
  public async exportBackup(): Promise<UserDataBackup> {
    return this.service.exportBackup();
  }

  /**
   * Restores user data from a structured JSON backup and reloads session.
   */
  public async importBackup(
    jsonString: string,
    options?: ImportBackupOptions
  ): Promise<ImportBackupResult> {
    const res = await this.service.importBackup(jsonString, options);
    await this.reloadSession();
    return res;
  }
}

// ============================================================================
// React Context & Hook
// ============================================================================

export interface WeeklySessionContextValue {
  state: WeeklySessionUIState;
  service: WeeklySessionService;
  controller: WeeklySessionController;
  reloadSession: () => Promise<void>;
  createOrSavePlan: (
    plan: StoredWeeklyPlan,
    schedule?: WeeklySchedule,
    expectedScheduleVersion?: number
  ) => Promise<CreatePlanResult>;
  applyAdjustment: (params: {
    scheduleId: string;
    proposalId: string;
    adjustmentId: string;
    action: SuggestedAdjustmentAction;
    expectedScheduleVersion: number;
    humanDecision: HumanDecision;
    decidedAt?: string;
  }) => Promise<ApplyAdjustmentServiceResult>;
  closeWeek: (params: {
    planId: string;
    closedAt: string;
    itemOutcomes: ItemOutcomeInput[];
    userReflection?: UserReflectionInput;
  }) => Promise<CloseWeekServiceResult>;
  reopenWeek?: (planId: string) => Promise<ReopenWeekResult>;
  confirmMemoryCandidate: (
    candidate: StoreCandidate,
    decision: "accepted" | "rejected"
  ) => Promise<ConfirmMemoryResult>;
  confirmMemoryOperation: (
    operation: MemoryOperation,
    confirmation: ExplicitHumanConfirmation
  ) => Promise<ConfirmMemoryResult>;
  archiveMemory?: (id: string) => Promise<void>;
  deleteMemory?: (id: string) => Promise<void>;
  exportBackup?: () => Promise<UserDataBackup>;
  importBackup?: (
    jsonString: string,
    options?: ImportBackupOptions
  ) => Promise<ImportBackupResult>;
  purgeSession: (planId: string) => Promise<PurgePlanResult>;
  resolveAmbiguity: (keepPlanId: string) => Promise<void>;
  getDraftPlan?: (targetWeek?: TargetWeek) => Promise<StoredWeeklyPlan | null>;
  saveDraftPlan: (
    plan: StoredWeeklyPlan
  ) => Promise<{ status: "success"; plan: StoredWeeklyPlan } | { status: "invalid_data"; reason: string }>;
  clearDraftPlan: (planIdOrTargetWeek?: string | TargetWeek) => Promise<void>;
}

export const WeeklySessionReactContext = createContext<WeeklySessionContextValue | null>(
  null
);

export async function createDefaultWeeklySessionService(): Promise<WeeklySessionService> {
  const storage = await createIndexedDbStorage();
  return new WeeklySessionService({
    plans: storage.plans,
    schedules: storage.schedules,
    closeReports: storage.closeReports,
    memories: storage.memories,
    getDb: () => storage.db,
  });
}

export interface WeeklySessionProviderProps {
  children: React.ReactNode;
  service?: WeeklySessionService;
  autoResume?: boolean;
}

export function WeeklySessionProvider({
  children,
  service,
  autoResume = true,
}: WeeklySessionProviderProps) {
  const [activeService, setActiveService] = useState<WeeklySessionService | null>(
    service ?? null
  );

  useEffect(() => {
    if (service) {
      setActiveService(service);
      return;
    }
    let cancelled = false;
    createDefaultWeeklySessionService().then((srv) => {
      if (!cancelled) {
        setActiveService(srv);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [service]);

  if (!activeService) {
    return <div className="weekly-session-loading-init">Iniciando cuaderno...</div>;
  }

  return (
    <WeeklySessionProviderWithService
      service={activeService}
      autoResume={autoResume}
    >
      {children}
    </WeeklySessionProviderWithService>
  );
}

function WeeklySessionProviderWithService({
  children,
  service,
  autoResume,
}: {
  children: React.ReactNode;
  service: WeeklySessionService;
  autoResume: boolean;
}) {
  const controller = useMemo(
    () => new WeeklySessionController(service),
    [service]
  );

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  // Strict Mode safe initial resumption
  useEffect(() => {
    if (autoResume) {
      controller.reloadSession();
    }
  }, [autoResume, controller]);

  const value: WeeklySessionContextValue = useMemo(
    () => ({
      state,
      service,
      controller,
      reloadSession: () => controller.reloadSession(),
      createOrSavePlan: (plan, schedule, expectedVersion) =>
        controller.createOrSavePlan(plan, schedule, expectedVersion),
      applyAdjustment: (params) => controller.applyAdjustment(params),
      closeWeek: (params) => controller.closeWeek(params),
      reopenWeek: (planId) => controller.reopenWeek(planId),
      confirmMemoryCandidate: (candidate, decision) =>
        controller.confirmMemoryCandidate(candidate, decision),
      confirmMemoryOperation: (operation, confirmation) =>
        controller.confirmMemoryOperation(operation, confirmation),
      archiveMemory: (id) => controller.archiveMemory(id),
      deleteMemory: (id) => controller.deleteMemory(id),
      exportBackup: () => controller.exportBackup(),
      importBackup: (jsonString, options) => controller.importBackup(jsonString, options),
      purgeSession: (planId) => controller.purgeSession(planId),
      resolveAmbiguity: (keepPlanId) => controller.resolveAmbiguity(keepPlanId),
      getDraftPlan: (targetWeek) => controller.getDraftPlan(targetWeek),
      saveDraftPlan: (plan) => controller.saveDraftPlan(plan),
      clearDraftPlan: (planIdOrTargetWeek) => controller.clearDraftPlan(planIdOrTargetWeek),
    }),
    [state, service, controller]
  );

  return (
    <WeeklySessionReactContext.Provider value={value}>
      {children}
    </WeeklySessionReactContext.Provider>
  );
}

export function useWeeklySession(): WeeklySessionContextValue {
  const context = useContext(WeeklySessionReactContext);
  if (!context) {
    throw new Error(
      "useWeeklySession must be used within a <WeeklySessionProvider>."
    );
  }
  return context;
}
