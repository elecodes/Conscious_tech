import { useState, useRef, useEffect } from "react";
import { AIProvider } from "../../providers/ai-provider";
import { MockProvider } from "../../providers/mock-provider";
import { ExtractedItem, ExtractedItems } from "../../domain/items";
import {
  ProposedWeek,
  resolveDefaultTargetWeek,
  TargetWeek,
  WeeklyFocus,
  WeeklyFlexibleOption,
  DeferredItem,
} from "../../domain/week";
import { StoredWeeklyPlan, WeeklyPlanDraftContext } from "../../domain/repositories/types";
import { WeeklySchedule } from "../../domain/schedule";
import { extractItems } from "../../skills/extract-items";
import { calculateWeeklyCapacity } from "../../skills/build-week/deterministic";
import {
  generateWeeklyProposalFromItemsDetailed,
  PipelineDiagnostic,
} from "../../application/planning-pipeline";
import { useWeeklySession } from "../context/weekly-session-context";
import { formatHours } from "./weekly-session-formatters";
import { VoiceDictationButton } from "./voice-dictation-button";
import { PlanningCapacityHud } from "./planning-capacity-hud";
import { PlanningHeaderSection, type PendingCarryOverTask } from "./planning-header-section";
export type { PendingCarryOverTask };
import { PlanningExtractedItemsReview } from "./planning-extracted-items-review";
import { PlanningProposedItemsSection } from "./planning-proposed-items-section";
import { PlanningDeferredItemsSection } from "./planning-deferred-items-section";
import { PlanningProposalReviewFooter } from "./planning-proposal-review-footer";
import { logger } from "../../utils/logger";
import { CalendarWeekSummary } from "../../domain/calendar";
import sampleDumpsData from "../../../cases/sample-dumps.json";

export interface WeeklyPlanningFromNotesProps {
  provider?: AIProvider;
  currentDate?: string;
  onPlanCreated?: () => void;
  hasActivePlan?: boolean;
  initialItems?: ExtractedItem[];
  initialProposedWeek?: ProposedWeek;
  onProposalStatusChange?: (hasProposal: boolean) => void;
  initialStep?: "write" | "review" | "confirm";
  onNavigateSpace?: (space: "capture" | "prepare" | "active" | "review") => void;
}

const STORAGE_KEY_CAPTURE_TEXT = "conscious_tech_transient_dump_text";
const STORAGE_KEY_CAPTURE_RESULT = "conscious_tech_transient_dump_result";

export function WeeklyPlanningFromNotes({
  provider = new MockProvider(),
  currentDate,
  onPlanCreated,
  hasActivePlan = false,
  initialItems,
  initialProposedWeek,
  onProposalStatusChange,
  initialStep,
  onNavigateSpace,
}: WeeklyPlanningFromNotesProps) {
  const { createOrSavePlan, service, state } = useWeeklySession();

  const effectiveCurrentDate =
    currentDate || new Date().toISOString().split("T")[0] || "2026-10-12";

  // Target week being planned (customizable by human)
  const defaultTargetWeek = state?.activePlan
    ? resolveDefaultTargetWeek(state.activePlan.targetWeek.endDate)
    : resolveDefaultTargetWeek(effectiveCurrentDate);
  const [targetWeekStart, setTargetWeekStart] = useState(defaultTargetWeek.startDate);
  const [targetWeekEnd, setTargetWeekEnd] = useState(defaultTargetWeek.endDate);

  const activeTargetWeek: TargetWeek = {
    startDate: targetWeekStart,
    endDate: targetWeekEnd,
  };

  // Handlers para ajustar horas y fechas directamente en los elementos identificados
  const handleUpdateItemEffort = (itemId: string, hours: number | null) => {
    setExtractedItems((prev) => {
      if (!prev) return prev;
      return prev.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          estimatedEffort:
            hours != null && hours > 0
              ? { value: hours, unit: "hours" as const, source: "user" as const }
              : undefined,
        };
      });
    });
  };

  const handleUpdateItemDeadline = (itemId: string, dateStr: string | null) => {
    setExtractedItems((prev) => {
      if (!prev) return prev;
      return prev.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          deadline: dateStr
            ? { raw: dateStr, resolved: dateStr, confidence: "high" as const }
            : undefined,
        };
      });
    });
  };

  // State: Carryover tasks from previous closed weeks or active schedules
  const [carryOverTasks, setCarryOverTasks] = useState<PendingCarryOverTask[]>([]);
  const [selectedCarryOverItemIds, setSelectedCarryOverItemIds] = useState<Set<string>>(new Set());

  // State: Guided flow step (1. Escribir -> 2. Revisar -> 3. Confirmar)
  const [flowStep, setFlowStep] = useState<"write" | "review" | "confirm">(() => {
    if (initialStep) return initialStep;
    if (initialProposedWeek || (initialItems && initialItems.length > 0)) return "review";
    return "write";
  });

  useEffect(() => {
    if (initialStep) {
      setFlowStep(initialStep);
    }
  }, [initialStep]);

  // State: Notes & Extraction
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [noteText, setNoteText] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_CAPTURE_TEXT) || "";
    } catch {
      return "";
    }
  });

  // Autosave mental dump text
  useEffect(() => {
    try {
      if (noteText) {
        localStorage.setItem(STORAGE_KEY_CAPTURE_TEXT, noteText);
      } else {
        localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
      }
    } catch {
      // ignore
    }
  }, [noteText]);

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[] | null>(() => {
    if (initialItems && initialItems.length > 0) return initialItems;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CAPTURE_RESULT);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.items && Array.isArray(parsed.items)) return parsed.items;
      }
    } catch {
      // ignore
    }
    return null;
  });

  // Autosave extracted result
  useEffect(() => {
    try {
      if (extractedItems && extractedItems.length > 0) {
        localStorage.setItem(STORAGE_KEY_CAPTURE_RESULT, JSON.stringify({ items: extractedItems }));
      } else {
        localStorage.removeItem(STORAGE_KEY_CAPTURE_RESULT);
      }
    } catch {
      // ignore
    }
  }, [extractedItems]);

  const [acceptedItemIds, setAcceptedItemIds] = useState<Set<string>>(
    () => new Set((initialItems || extractedItems || []).map((i) => i.id))
  );

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setExtractedItems(initialItems);
      setAcceptedItemIds(new Set(initialItems.map((i) => i.id)));
      setProposedWeek(null);
      setFlowStep("review");
    }
  }, [initialItems]);

  const [userIntent, setUserIntent] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [proposedWeek, setProposedWeek] = useState<ProposedWeek | null>(
    initialProposedWeek ?? null
  );
  const [isReviewingSelection, setIsReviewingSelection] = useState(false);

  useEffect(() => {
    onProposalStatusChange?.(Boolean(proposedWeek));
  }, [proposedWeek, onProposalStatusChange]);
  const [overdueDecisions, setOverdueDecisions] = useState<
    Record<
      string,
      {
        decision: "keep_unscheduled" | "include_recovery" | "reschedule_future";
        rescheduleTargetWeek?: TargetWeek;
      }
    >
  >({});
  const [deferredDecisions, setDeferredDecisions] = useState<
    Record<string, "pending_decision" | "intentional_postponement" | "included">
  >({});
  const [activePlanConflict, setActivePlanConflict] = useState<{
    existingActivePlanId: string;
    targetWeek: TargetWeek;
  } | null>(null);
  const [diagnostics, setDiagnostics] = useState<PipelineDiagnostic[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Capacity & Protected Space registration state
  const initialAvailable =
    initialProposedWeek?.weekSummary?.capacity?.totalAvailableHours != null
      ? String(initialProposedWeek.weekSummary.capacity.totalAvailableHours)
      : "";
  const initialRatioPercent =
    initialProposedWeek?.weekSummary?.capacity?.totalAvailableHours != null &&
    initialProposedWeek?.weekSummary?.capacity?.protectedSpaceHours != null
      ? String(
          Math.round(
            (initialProposedWeek.weekSummary.capacity.protectedSpaceHours /
              initialProposedWeek.weekSummary.capacity.totalAvailableHours) *
              100
          )
        )
      : "25";

  const [availableHoursInput, setAvailableHoursInput] = useState(initialAvailable);
  const [protectedSpacePercentInput, setProtectedSpacePercentInput] = useState(initialRatioPercent);
  const [capacityFeedbackMessage, setCapacityFeedbackMessage] = useState<string | null>(null);
  const [calendarSummary, setCalendarSummary] = useState<CalendarWeekSummary | null>(null);
  const [isEditingCapacity, setIsEditingCapacity] = useState(false);

  const handleCalendarApplied = (summary: CalendarWeekSummary) => {
    setCalendarSummary(summary);
    const defaultWeeklyBase = 40;
    const remainingPlannable = Math.max(0, defaultWeeklyBase - summary.totalCommittedHours);
    setAvailableHoursInput(String(remainingPlannable));
    setCapacityFeedbackMessage(
      `📅 Google Calendar sincronizado: ${summary.totalCommittedHours}h ocupadas en ${summary.events.length} reunión(es). Capacidad restante ajustada a ${remainingPlannable}h.`
    );
  };
  const [editingProposalItemId, setEditingProposalItemId] = useState<string | null>(null);
  const [proposalItemHoursInput, setProposalItemHoursInput] = useState<string>("");

  const [lastGeneratedParams, setLastGeneratedParams] = useState<{
    acceptedItemIds: string;
    carryOverIds: string;
    userIntent: string;
    availableHours: string;
    protectedSpace: string;
  } | null>(null);

  const currentAcceptedSignature = Array.from(acceptedItemIds).sort().join(",");
  const currentCarryOverSignature = Array.from(selectedCarryOverItemIds).sort().join(",");
  const currentUserIntent = userIntent.trim();
  const currentAvailableHours = availableHoursInput.trim();
  const currentProtectedSpace = protectedSpacePercentInput.trim();

  const isProposalDirty = Boolean(
    proposedWeek !== null &&
    lastGeneratedParams !== null &&
    (lastGeneratedParams.acceptedItemIds !== currentAcceptedSignature ||
      lastGeneratedParams.carryOverIds !== currentCarryOverSignature ||
      lastGeneratedParams.userIntent !== currentUserIntent ||
      lastGeneratedParams.availableHours !== currentAvailableHours ||
      lastGeneratedParams.protectedSpace !== currentProtectedSpace)
  );

  useEffect(() => {
    if (initialProposedWeek?.weekSummary?.capacity?.totalAvailableHours != null) {
      setAvailableHoursInput(String(initialProposedWeek.weekSummary.capacity.totalAvailableHours));
      if (initialProposedWeek.weekSummary.capacity.protectedSpaceHours != null) {
        setProtectedSpacePercentInput(
          String(
            Math.round(
              (initialProposedWeek.weekSummary.capacity.protectedSpaceHours /
                initialProposedWeek.weekSummary.capacity.totalAvailableHours) *
                100
            )
          )
        );
      }
    }
  }, [initialProposedWeek]);

  // --------------------------------------------------------------------------
  // Lifecycle: Hydrate proposal from persisted draft if no active in-memory proposal
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    async function restoreDraft() {
      // Do not overwrite if explicit initial items are transferred from capture space
      if (
        initialProposedWeek ||
        (initialItems && initialItems.length > 0) ||
        !service?.getDraftPlan
      )
        return;
      try {
        const currentTargetWeek: TargetWeek = {
          startDate: targetWeekStart,
          endDate: targetWeekEnd,
        };
        const draft = await service.getDraftPlan(currentTargetWeek);
        if (isCancelled) return;
        if (draft && draft.status === "draft" && draft.proposal) {
          setProposedWeek(draft.proposal);
          if (draft.draftContext) {
            if (draft.draftContext.extractedItems) {
              setExtractedItems(draft.draftContext.extractedItems);
            }
            if (draft.draftContext.acceptedItemIds) {
              setAcceptedItemIds(new Set(draft.draftContext.acceptedItemIds));
            }
            if (draft.draftContext.selectedCarryOverItemIds) {
              setSelectedCarryOverItemIds(new Set(draft.draftContext.selectedCarryOverItemIds));
            }
            if (draft.draftContext.overdueDecisions) {
              setOverdueDecisions(draft.draftContext.overdueDecisions);
            }
            if (draft.draftContext.deferredDecisions) {
              setDeferredDecisions(draft.draftContext.deferredDecisions);
            }
            if (draft.draftContext.availableHoursInput !== undefined) {
              setAvailableHoursInput(draft.draftContext.availableHoursInput);
            } else if (draft.proposal.weekSummary.capacity.totalAvailableHours != null) {
              setAvailableHoursInput(
                String(draft.proposal.weekSummary.capacity.totalAvailableHours)
              );
            }
            if (draft.draftContext.protectedSpacePercentInput !== undefined) {
              setProtectedSpacePercentInput(draft.draftContext.protectedSpacePercentInput);
            } else if (
              draft.proposal.weekSummary.capacity.totalAvailableHours != null &&
              draft.proposal.weekSummary.capacity.protectedSpaceHours != null &&
              draft.proposal.weekSummary.capacity.totalAvailableHours > 0
            ) {
              setProtectedSpacePercentInput(
                String(
                  Math.round(
                    (draft.proposal.weekSummary.capacity.protectedSpaceHours /
                      draft.proposal.weekSummary.capacity.totalAvailableHours) *
                      100
                  )
                )
              );
            }
            if (draft.draftContext.noteText !== undefined) {
              setNoteText(draft.draftContext.noteText);
            }
            if (draft.draftContext.userIntent !== undefined) {
              setUserIntent(draft.draftContext.userIntent);
            }
            if (draft.draftContext.isEditingCapacity !== undefined) {
              setIsEditingCapacity(draft.draftContext.isEditingCapacity);
            }
            const draftAccepted = draft.draftContext?.acceptedItemIds
              ? draft.draftContext.acceptedItemIds.slice().sort().join(",")
              : "";
            const draftCarryOver = draft.draftContext?.selectedCarryOverItemIds
              ? draft.draftContext.selectedCarryOverItemIds.slice().sort().join(",")
              : "";
            setLastGeneratedParams({
              acceptedItemIds: draftAccepted,
              carryOverIds: draftCarryOver,
              userIntent: draft.draftContext?.userIntent?.trim() || "",
              availableHours:
                draft.draftContext?.availableHoursInput?.trim() ||
                (draft.proposal.weekSummary.capacity.totalAvailableHours != null
                  ? String(draft.proposal.weekSummary.capacity.totalAvailableHours)
                  : ""),
              protectedSpace: draft.draftContext?.protectedSpacePercentInput?.trim() || "25",
            });
          }
        } else {
          setProposedWeek((prev) => {
            if (prev && prev.weekSummary.targetWeek.startDate !== targetWeekStart) {
              return null;
            }
            return prev;
          });
        }
      } catch (err) {
        logger.error("Failed to restore draft plan", err);
      }
    }
    restoreDraft();
    return () => {
      isCancelled = true;
    };
  }, [service, initialProposedWeek, targetWeekStart, targetWeekEnd]);

  const persistDraft = async (
    proposalToSave: ProposedWeek,
    contextOverrides?: Partial<WeeklyPlanDraftContext>
  ) => {
    if (!service?.saveDraftPlan) return;
    const nowIso = new Date().toISOString();
    const tWeek = proposalToSave.weekSummary.targetWeek;
    const draftPlan: StoredWeeklyPlan = {
      planId: `draft-${tWeek.startDate}`,
      status: "draft",
      targetWeek: tWeek,
      proposal: proposalToSave,
      draftContext: {
        extractedItems: extractedItems || undefined,
        acceptedItemIds: Array.from(acceptedItemIds),
        selectedCarryOverItemIds: Array.from(selectedCarryOverItemIds),
        overdueDecisions,
        deferredDecisions,
        availableHoursInput,
        protectedSpacePercentInput,
        noteText,
        userIntent,
        isEditingCapacity,
        ...contextOverrides,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    try {
      await service.saveDraftPlan(draftPlan);
    } catch (e) {
      logger.error("Failed to save plan draft", e);
    }
  };

  const handleStartEditCapacity = () => {
    if (proposedWeek?.weekSummary.capacity.totalAvailableHours != null) {
      setAvailableHoursInput(String(proposedWeek.weekSummary.capacity.totalAvailableHours));
      const ratio =
        proposedWeek.weekSummary.capacity.protectedSpaceHours != null &&
        proposedWeek.weekSummary.capacity.totalAvailableHours > 0
          ? Math.round(
              (proposedWeek.weekSummary.capacity.protectedSpaceHours /
                proposedWeek.weekSummary.capacity.totalAvailableHours) *
                100
            )
          : 25;
      setProtectedSpacePercentInput(String(ratio));
    }
    setIsEditingCapacity(true);
  };

  const handleCancelEditCapacity = () => {
    if (proposedWeek?.weekSummary.capacity.totalAvailableHours != null) {
      setAvailableHoursInput(String(proposedWeek.weekSummary.capacity.totalAvailableHours));
      const ratio =
        proposedWeek.weekSummary.capacity.protectedSpaceHours != null &&
        proposedWeek.weekSummary.capacity.totalAvailableHours > 0
          ? Math.round(
              (proposedWeek.weekSummary.capacity.protectedSpaceHours /
                proposedWeek.weekSummary.capacity.totalAvailableHours) *
                100
            )
          : 25;
      setProtectedSpacePercentInput(String(ratio));
    }
    setIsEditingCapacity(false);
  };

  // Request ID counters for race-condition & stale async response protection
  const extractRequestIdRef = useRef(0);
  const planningRequestIdRef = useRef(0);

  // --------------------------------------------------------------------------
  // Lifecycle: Load pending carryover tasks from persisted storage
  // --------------------------------------------------------------------------
  useEffect(() => {
    let isCancelled = false;
    async function loadCarryOver() {
      if (!service) return;
      try {
        const tasks = await service.getPendingCarryOverTasks(activeTargetWeek);
        if (!isCancelled) {
          setCarryOverTasks(tasks);
          // By default, do NOT auto-select: "La IA propone; la persona decide"
          setSelectedCarryOverItemIds(new Set());
        }
      } catch (err) {
        // Log quietly without breaking note planning
        logger.error("Failed to load carryover tasks", err);
      }
    }
    loadCarryOver();
    return () => {
      isCancelled = true;
    };
  }, [service, targetWeekStart, targetWeekEnd]);

  const handleToggleCarryOverItem = (itemId: string) => {
    setSelectedCarryOverItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // Handlers: Step 1 - Extract Items
  // --------------------------------------------------------------------------
  const handleExtract = async (mode: "replace" | "append" = "replace") => {
    const trimmed = noteText.trim();
    if (!trimmed || isExtracting) return;

    const reqId = ++extractRequestIdRef.current;
    setIsExtracting(true);
    setExtractError(null);
    setConfirmationError(null);
    setSuccessMessage(null);

    try {
      const result: ExtractedItems = await extractItems(provider, {
        text: trimmed,
        currentDate: effectiveCurrentDate,
        locale: "es-ES",
      });

      // Discard stale responses if user triggered another extraction in the meantime
      if (reqId !== extractRequestIdRef.current) return;

      const newItems = result.items || [];
      if (mode === "append" && extractedItems && extractedItems.length > 0) {
        const existingMap = new Map(extractedItems.map((i) => [i.id, i]));
        for (const item of newItems) {
          existingMap.set(item.id, item);
        }
        const merged = Array.from(existingMap.values());
        setExtractedItems(merged);
        setAcceptedItemIds((prev) => {
          const next = new Set(prev);
          for (const item of newItems) next.add(item.id);
          return next;
        });
        setSuccessMessage(`Se añadieron ${newItems.length} nueva(s) idea(s) a la lista existente.`);
      } else {
        setExtractedItems(newItems);
        // By default, accept all extracted items for review
        setAcceptedItemIds(new Set(newItems.map((it) => it.id)));
      }
      setProposedWeek(null);
      setDiagnostics([]);
      setNoteText("");
    } catch (err) {
      if (reqId !== extractRequestIdRef.current) return;
      setExtractError(
        (err as Error).message ||
          "No se pudieron extraer elementos del texto. Verifica el proveedor o tus notas."
      );
      // NOTE: noteText is intentionally preserved so user doesn't lose input
    } finally {
      if (reqId === extractRequestIdRef.current) {
        setIsExtracting(false);
      }
    }
  };

  const handleCaseSelect = (caseId: string) => {
    setSelectedCaseId(caseId);
    if (!caseId) {
      setNoteText("");
      return;
    }
    const found = sampleDumpsData.find((c) => c.id === caseId);
    if (found) {
      setNoteText(found.text);
    }
  };

  const handleClearText = () => {
    setNoteText("");
    setSelectedCaseId("");
    try {
      localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
    } catch {
      // ignore
    }
  };

  const handleContinueFromWrite = async () => {
    const trimmed = noteText.trim();
    if (!trimmed || isExtracting || isPlanning) return;

    const reqId = ++extractRequestIdRef.current;
    setIsExtracting(true);
    setExtractError(null);
    setPlanningError(null);
    setConfirmationError(null);
    setSuccessMessage(null);

    try {
      // 1. Extraer elementos de las notas
      const result: ExtractedItems = await extractItems(provider, {
        text: trimmed,
        currentDate: effectiveCurrentDate,
        locale: "es-ES",
      });

      if (reqId !== extractRequestIdRef.current) return;

      const newItems = result.items || [];
      setExtractedItems(newItems);
      const newAcceptedIds = new Set(newItems.map((it) => it.id));
      setAcceptedItemIds(newAcceptedIds);

      // 2. Construir propuesta semanal con estos elementos
      setIsExtracting(false);
      setIsPlanning(true);

      const totalAvailableHours =
        availableHoursInput.trim() !== "" ? Number(availableHoursInput) : undefined;
      const minProtectedSpaceRatio =
        protectedSpacePercentInput.trim() !== "" ? Number(protectedSpacePercentInput) / 100 : 0.25;

      const currentCapacityConfig =
        totalAvailableHours !== undefined &&
        Number.isFinite(totalAvailableHours) &&
        totalAvailableHours >= 0
          ? {
              totalAvailableHours,
              minProtectedSpaceRatio:
                Number.isFinite(minProtectedSpaceRatio) &&
                minProtectedSpaceRatio >= 0 &&
                minProtectedSpaceRatio <= 1
                  ? minProtectedSpaceRatio
                  : 0.25,
            }
          : undefined;

      const detailedResult = await generateWeeklyProposalFromItemsDetailed(provider, {
        items: newItems,
        currentDate: effectiveCurrentDate,
        targetWeek: activeTargetWeek,
        userIntent: userIntent.trim() || undefined,
        totalAvailableHours: currentCapacityConfig?.totalAvailableHours,
        minProtectedSpaceRatio: currentCapacityConfig?.minProtectedSpaceRatio,
      });

      if (reqId !== extractRequestIdRef.current) return;

      setProposedWeek(detailedResult.proposal);
      setDiagnostics(detailedResult.diagnostics);
      await persistDraft(detailedResult.proposal, {
        extractedItems: newItems,
        acceptedItemIds: Array.from(newAcceptedIds),
        noteText: trimmed,
      });
      setLastGeneratedParams({
        acceptedItemIds: Array.from(newAcceptedIds).sort().join(","),
        carryOverIds: Array.from(selectedCarryOverItemIds).sort().join(","),
        userIntent: userIntent.trim(),
        availableHours: availableHoursInput.trim(),
        protectedSpace: protectedSpacePercentInput.trim(),
      });
      setFlowStep("review");
    } catch (err) {
      if (reqId !== extractRequestIdRef.current) return;
      setExtractError(
        (err as Error).message ||
          "No se pudieron extraer elementos ni preparar la propuesta. Verifica tus notas o el asistente."
      );
      // NOTE: noteText se conserva intacto
    } finally {
      if (reqId === extractRequestIdRef.current) {
        setIsExtracting(false);
        setIsPlanning(false);
      }
    }
  };

  const handleStartFreshWeek = async () => {
    setExtractedItems(null);
    setAcceptedItemIds(new Set());
    setProposedWeek(null);
    setDiagnostics([]);
    setNoteText("");
    setSelectedCaseId("");
    setUserIntent("");
    setExtractError(null);
    setPlanningError(null);
    setConfirmationError(null);
    setFlowStep("write");
    try {
      localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
      localStorage.removeItem(STORAGE_KEY_CAPTURE_RESULT);
    } catch {
      // ignore
    }
    if (service?.clearDraftPlan) {
      try {
        await service.clearDraftPlan(activeTargetWeek);
      } catch (e) {
        logger.error("Error clearing draft in storage", e);
      }
    }
    setSuccessMessage("Lienzo despejado para planificar una nueva semana.");
  };

  // --------------------------------------------------------------------------
  // Handlers: Step 2 - Review & Toggle Items
  // --------------------------------------------------------------------------
  const handleToggleItem = (itemId: string) => {
    setAcceptedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleAcceptAll = () => {
    if (!extractedItems) return;
    setAcceptedItemIds(new Set(extractedItems.map((i) => i.id)));
  };

  const handleDiscardAll = () => {
    setAcceptedItemIds(new Set());
  };

  // --------------------------------------------------------------------------
  // Handlers: Step 3 - Generate Weekly Proposal
  // --------------------------------------------------------------------------
  const handleGenerateProposal = async () => {
    if (isPlanning) return;

    const acceptedExtracted = extractedItems
      ? extractedItems.filter((i) => acceptedItemIds.has(i.id))
      : [];

    const selectedCarryOver = carryOverTasks.filter((t) => selectedCarryOverItemIds.has(t.itemId));

    // Guard: Prevent duplicates if an item ID is present in both sets
    const existingItemIds = new Set(acceptedExtracted.map((it) => it.id));
    const carryOverAsItems: ExtractedItem[] = [];

    for (const cot of selectedCarryOver) {
      if (!existingItemIds.has(cot.itemId)) {
        existingItemIds.add(cot.itemId);
        carryOverAsItems.push({
          id: cot.itemId,
          title: cot.title,
          rawText: cot.title,
          type: "task",
          status: "pending",
          commitment: cot.originCategory === "obligation" ? "external" : "personal",
          deadline: cot.dueDate
            ? {
                raw: cot.dueDate,
                resolved: cot.dueDate,
                confidence: "high",
              }
            : null,
          estimatedEffort:
            cot.estimatedHours != null
              ? {
                  value: cot.estimatedHours,
                  unit: "hours",
                  source: "estimated",
                }
              : null,
        });
      }
    }

    const combinedItems = [...acceptedExtracted, ...carryOverAsItems];

    if (combinedItems.length === 0) {
      setPlanningError(
        "Selecciona al menos una tarea (extraída o postergada de semanas anteriores) para generar la planificación semanal."
      );
      return;
    }

    const reqId = ++planningRequestIdRef.current;
    setIsPlanning(true);
    setPlanningError(null);
    setConfirmationError(null);

    try {
      const totalAvailableHours =
        availableHoursInput.trim() !== "" ? Number(availableHoursInput) : undefined;
      const minProtectedSpaceRatio =
        protectedSpacePercentInput.trim() !== "" ? Number(protectedSpacePercentInput) / 100 : 0.25;

      const currentCapacityConfig =
        totalAvailableHours !== undefined &&
        Number.isFinite(totalAvailableHours) &&
        totalAvailableHours >= 0
          ? {
              totalAvailableHours,
              minProtectedSpaceRatio:
                Number.isFinite(minProtectedSpaceRatio) &&
                minProtectedSpaceRatio >= 0 &&
                minProtectedSpaceRatio <= 1
                  ? minProtectedSpaceRatio
                  : 0.25,
            }
          : undefined;

      const detailedResult = await generateWeeklyProposalFromItemsDetailed(provider, {
        items: combinedItems,
        currentDate: effectiveCurrentDate,
        targetWeek: activeTargetWeek,
        userIntent: userIntent.trim() || undefined,
        totalAvailableHours: currentCapacityConfig?.totalAvailableHours,
        minProtectedSpaceRatio: currentCapacityConfig?.minProtectedSpaceRatio,
      });

      if (reqId !== planningRequestIdRef.current) return;
      let finalProposal = detailedResult.proposal;

      // Re-apply any previous overdue decisions if already chosen
      for (const [itemId, dec] of Object.entries(overdueDecisions)) {
        if (dec.decision === "include_recovery") {
          const it = combinedItems.find((i) => i.id === itemId);
          if (it) {
            const originalDueDate = it.deadline?.resolved || "2026-10-15";
            const updatedFoci = finalProposal.foci.filter(
              (f) => !f.contributingItemIds.includes(itemId)
            );
            const updatedDeferred = finalProposal.deferredItems.filter((d) => d.itemId !== itemId);
            const updatedFlexible = finalProposal.flexibleOptions.filter(
              (o) => o.itemId !== itemId
            );
            if (updatedFoci.length < 3) {
              updatedFoci.push({
                id: `focus-recovery-${itemId}`,
                title: `Recuperación: ${it.title}`,
                desiredOutcome: `Completar como prioridad de recuperación la tarea vencida (fecha límite original: ${originalDueDate})`,
                rationale: `Incluida conscientemente como prioridad de recuperación por decisión de la persona. Fecha límite original conservada: ${originalDueDate}.`,
                contributingItemIds: [itemId],
                estimatedHours: it.estimatedEffort?.value ?? null,
              });
            } else {
              updatedFlexible.push({
                itemId,
                title: `Recuperación: ${it.title}`,
                condition: `Tarea vencida (fecha límite original: ${originalDueDate}) incluida como opción flexible al alcanzarse el máximo de 3 focos.`,
                estimatedHours: it.estimatedEffort?.value ?? null,
              });
            }
            const newCap = calculateWeeklyCapacity({
              capacityConfig: currentCapacityConfig,
              foci: updatedFoci,
              obligations: finalProposal.obligations,
              flexibleOptions: updatedFlexible,
            });
            finalProposal = {
              ...finalProposal,
              foci: updatedFoci,
              deferredItems: updatedDeferred,
              flexibleOptions: updatedFlexible,
              weekSummary: { ...finalProposal.weekSummary, capacity: newCap },
              unplannedSpace: {
                ...finalProposal.unplannedSpace,
                recommendedHours: newCap.protectedSpaceHours,
              },
            };
          }
        }
      }

      setProposedWeek(finalProposal);
      setDiagnostics(detailedResult.diagnostics);
      setIsReviewingSelection(false);
      await persistDraft(finalProposal);
      setLastGeneratedParams({
        acceptedItemIds: Array.from(acceptedItemIds).sort().join(","),
        carryOverIds: Array.from(selectedCarryOverItemIds).sort().join(","),
        userIntent: userIntent.trim(),
        availableHours: availableHoursInput.trim(),
        protectedSpace: protectedSpacePercentInput.trim(),
      });
    } catch (err) {
      if (reqId !== planningRequestIdRef.current) return;
      setPlanningError(
        (err as Error).message || "Ocurrió un error al generar la propuesta semanal con la IA."
      );
    } finally {
      if (reqId === planningRequestIdRef.current) {
        setIsPlanning(false);
      }
    }
  };

  const handleContinueToConfirm = async () => {
    if (isProposalDirty) {
      await handleGenerateProposal();
    }
    setFlowStep("confirm");
  };

  // --------------------------------------------------------------------------
  // Handlers: Step 4 - Explicit Human Confirmation to Persist
  // --------------------------------------------------------------------------
  const handleConfirmPlan = async () => {
    if (!proposedWeek || isConfirming) return;

    setIsConfirming(true);
    setConfirmationError(null);
    const nowIso = new Date().toISOString();
    const targetWeek = proposedWeek.weekSummary.targetWeek;

    const isSameAsActive = Boolean(
      state?.activePlan &&
      state.activePlan.targetWeek.startDate === targetWeek.startDate &&
      state.activePlan.targetWeek.endDate === targetWeek.endDate
    );

    const planId = isSameAsActive
      ? state.activePlan!.planId
      : `plan-${targetWeek.startDate}-${Date.now()}`;

    const existingSched = isSameAsActive ? state.activeSchedule : null;
    const scheduleId = existingSched?.scheduleId ?? `sched-${planId}`;
    const nextVersion = existingSched ? existingSched.version + 1 : 1;
    const expectedScheduleVersion = existingSched ? existingSched.version : undefined;

    const storedPlan: StoredWeeklyPlan = {
      planId,
      status: "active",
      targetWeek,
      proposal: proposedWeek,
      createdAt: isSameAsActive ? state.activePlan!.createdAt : nowIso,
      updatedAt: nowIso,
    };

    const storedSchedule: WeeklySchedule = {
      scheduleId,
      planId,
      weekRange: targetWeek,
      timeBlocks: existingSched?.timeBlocks ?? [],
      dailyAllocations: existingSched?.dailyAllocations ?? [],
      dayConstraints: existingSched?.dayConstraints ?? [],
      appliedAdjustments: existingSched?.appliedAdjustments ?? [],
      version: nextVersion,
      createdAt: existingSched?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    try {
      const result = await createOrSavePlan(storedPlan, storedSchedule, expectedScheduleVersion);

      if (result.status === "success") {
        setSuccessMessage("¡Semana confirmada y guardada con éxito en tu cuaderno!");
        setProposedWeek(null);
        setDiagnostics([]);
        setExtractedItems(null);
        setNoteText("");
        setSelectedCaseId("");
        setFlowStep("write");
        try {
          localStorage.removeItem(STORAGE_KEY_CAPTURE_TEXT);
          localStorage.removeItem(STORAGE_KEY_CAPTURE_RESULT);
        } catch {
          // ignore
        }
        if (onPlanCreated) {
          onPlanCreated();
        }
        if (onNavigateSpace) {
          onNavigateSpace("active");
        }
      } else if (result.status === "conflict_active_plan_exists") {
        await persistDraft(proposedWeek);
        setActivePlanConflict({
          existingActivePlanId: result.existingActivePlanId,
          targetWeek,
        });
      } else if (result.status === "invalid_data") {
        setConfirmationError(`Los datos de la propuesta no son válidos: ${result.reason}`);
      } else if (result.status === "inconsistent_references") {
        setConfirmationError(`Incoherencia en las referencias: ${result.reason}`);
      }
    } catch (err) {
      setConfirmationError(
        (err as Error).message || "Error al persistir el plan en la base de datos local."
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const handleAdjustElements = () => {
    setIsReviewingSelection(true);
    setConfirmationError(null);
  };

  const handleReturnToProposal = () => {
    setIsReviewingSelection(false);
  };

  const handleCancelProposal = async () => {
    setProposedWeek(null);
    setDiagnostics([]);
    setConfirmationError(null);
    setIsReviewingSelection(false);
    if (service?.clearDraftPlan) {
      await service.clearDraftPlan({
        startDate: targetWeekStart,
        endDate: targetWeekEnd,
      });
    }
  };

  const handleApplyOverdueDecision = async (
    itemId: string,
    decision: "keep_unscheduled" | "include_recovery" | "reschedule_future"
  ) => {
    if (!proposedWeek) return;

    const sourceItem = extractedItems?.find((i) => i.id === itemId);
    const itemTitle = sourceItem?.title || "Elemento";
    const originalDueDate = sourceItem?.deadline?.resolved || "2026-10-15";
    const estimatedHours = sourceItem?.estimatedEffort?.value ?? null;

    const defaultNextWeek = resolveDefaultTargetWeek(proposedWeek.weekSummary.targetWeek.endDate);

    const nextDecisions = {
      ...overdueDecisions,
      [itemId]: {
        decision,
        rescheduleTargetWeek: defaultNextWeek,
      },
    };
    setOverdueDecisions(nextDecisions);

    const updatedFoci = proposedWeek.foci.filter((f) => !f.contributingItemIds.includes(itemId));
    const updatedDeferred = proposedWeek.deferredItems.filter((d) => d.itemId !== itemId);
    const updatedFlexible = proposedWeek.flexibleOptions.filter((o) => o.itemId !== itemId);
    const obligations = [...proposedWeek.obligations];

    if (decision === "include_recovery") {
      if (updatedFoci.length < 3) {
        const recoveryFocus: WeeklyFocus = {
          id: `focus-recovery-${itemId}`,
          title: `Recuperación: ${itemTitle}`,
          desiredOutcome: `Completar como prioridad de recuperación la tarea vencida (fecha límite original: ${originalDueDate})`,
          rationale: `Incluida conscientemente como prioridad de recuperación por decisión de la persona. Fecha límite original conservada: ${originalDueDate}.`,
          contributingItemIds: [itemId],
          estimatedHours,
        };
        updatedFoci.push(recoveryFocus);
      } else {
        updatedFlexible.push({
          itemId,
          title: `Recuperación: ${itemTitle}`,
          condition: `Tarea vencida (fecha límite original: ${originalDueDate}) recuperada como opción flexible al alcanzarse el máximo de 3 focos.`,
          estimatedHours,
        });
      }
    } else if (decision === "reschedule_future") {
      updatedDeferred.push({
        itemId,
        title: itemTitle,
        reason: "intentional_postponement",
        rationale: `Reprogramada conscientemente para la semana posterior (${defaultNextWeek.startDate} a ${defaultNextWeek.endDate}). Fecha límite original conservada: ${originalDueDate}.`,
      });
    } else {
      updatedDeferred.push({
        itemId,
        title: itemTitle,
        reason: "not_scheduled",
        rationale: `Elemento no programado en la propuesta; conservado para decisión de la persona. Fecha límite original conservada: ${originalDueDate}.`,
      });
    }

    const propCap = proposedWeek.weekSummary.capacity;
    const resolvedTotalHours =
      availableHoursInput.trim() !== ""
        ? Number(availableHoursInput)
        : (propCap.totalAvailableHours ?? undefined);
    const resolvedRatio =
      protectedSpacePercentInput.trim() !== ""
        ? Number(protectedSpacePercentInput) / 100
        : propCap.totalAvailableHours && propCap.protectedSpaceHours
          ? propCap.protectedSpaceHours / propCap.totalAvailableHours
          : 0.25;

    const currentCapacityConfig =
      resolvedTotalHours !== undefined &&
      Number.isFinite(resolvedTotalHours) &&
      resolvedTotalHours >= 0
        ? {
            totalAvailableHours: resolvedTotalHours,
            minProtectedSpaceRatio:
              Number.isFinite(resolvedRatio) && resolvedRatio >= 0 && resolvedRatio <= 1
                ? resolvedRatio
                : 0.25,
          }
        : undefined;

    const newCapacity = calculateWeeklyCapacity({
      capacityConfig: currentCapacityConfig,
      foci: updatedFoci,
      obligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      foci: updatedFoci,
      obligations,
      flexibleOptions: updatedFlexible,
      deferredItems: updatedDeferred,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCapacity,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCapacity.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    await persistDraft(updatedProposal, {
      overdueDecisions: nextDecisions,
      availableHoursInput:
        resolvedTotalHours !== undefined ? String(resolvedTotalHours) : availableHoursInput,
      protectedSpacePercentInput: String(Math.round(resolvedRatio * 100)),
    });
  };

  const handleDeferredDecisionChange = async (
    itemId: string,
    action: "postpone" | "reconsider_unscheduled" | "include_flexible"
  ) => {
    if (!proposedWeek) return;
    const item = extractedItems?.find((i) => i.id === itemId);
    const itemTitle = item?.title ?? itemId;
    const estimatedHours = item?.estimatedEffort?.value ?? null;

    const nextDeferredDecisions: Record<
      string,
      "pending_decision" | "intentional_postponement" | "included"
    > = {
      ...deferredDecisions,
      [itemId]:
        action === "postpone"
          ? "intentional_postponement"
          : action === "include_flexible"
            ? "included"
            : "pending_decision",
    };
    setDeferredDecisions(nextDeferredDecisions);

    let updatedFoci = [...proposedWeek.foci];
    let updatedDeferred = [...proposedWeek.deferredItems];
    let updatedFlexible = [...proposedWeek.flexibleOptions];

    if (action === "include_flexible") {
      updatedDeferred = updatedDeferred.filter((d) => d.itemId !== itemId);
      const existingFocus = updatedFoci.find((f) => f.contributingItemIds.includes(itemId));
      const existingFlexible = updatedFlexible.find((o) => o.itemId === itemId);
      if (!existingFocus && !existingFlexible) {
        if (updatedFoci.length < 3) {
          updatedFoci.push({
            id: `focus-included-${itemId}`,
            title: itemTitle,
            desiredOutcome: `Avanzar en: ${itemTitle}`,
            rationale:
              "Reconsiderado e incluido conscientemente en la semana por decisión de la persona.",
            contributingItemIds: [itemId],
            estimatedHours,
          });
        } else {
          updatedFlexible.push({
            itemId,
            title: itemTitle,
            condition:
              "Reconsiderado e incluido conscientemente en la semana como opción flexible al alcanzarse el máximo de 3 focos.",
            estimatedHours,
          });
        }
      }
    } else if (action === "postpone") {
      updatedFoci = updatedFoci.filter((f) => !f.contributingItemIds.includes(itemId));
      updatedFlexible = updatedFlexible.filter((o) => o.itemId !== itemId);
      const existingIdx = updatedDeferred.findIndex((d) => d.itemId === itemId);
      const entry: DeferredItem = {
        itemId,
        title: itemTitle,
        reason: "intentional_postponement",
        rationale:
          "Postergado conscientemente por decisión de la persona para evaluar en una semana posterior.",
      };
      if (existingIdx >= 0) {
        updatedDeferred[existingIdx] = entry;
      } else {
        updatedDeferred.push(entry);
      }
    } else {
      updatedFoci = updatedFoci.filter((f) => !f.contributingItemIds.includes(itemId));
      updatedFlexible = updatedFlexible.filter((o) => o.itemId !== itemId);
      const existingIdx = updatedDeferred.findIndex((d) => d.itemId === itemId);
      const entry: DeferredItem = {
        itemId,
        title: itemTitle,
        reason: "not_scheduled",
        rationale: "Fuera de la propuesta actual, pendiente de decisión de la persona.",
      };
      if (existingIdx >= 0) {
        updatedDeferred[existingIdx] = entry;
      } else {
        updatedDeferred.push(entry);
      }
    }

    const propCap = proposedWeek.weekSummary.capacity;
    const resolvedTotalHours =
      availableHoursInput.trim() !== ""
        ? Number(availableHoursInput)
        : (propCap.totalAvailableHours ?? undefined);
    const resolvedRatio =
      protectedSpacePercentInput.trim() !== ""
        ? Number(protectedSpacePercentInput) / 100
        : propCap.totalAvailableHours && propCap.protectedSpaceHours
          ? propCap.protectedSpaceHours / propCap.totalAvailableHours
          : 0.25;

    const currentCapacityConfig =
      resolvedTotalHours !== undefined &&
      Number.isFinite(resolvedTotalHours) &&
      resolvedTotalHours >= 0
        ? {
            totalAvailableHours: resolvedTotalHours,
            minProtectedSpaceRatio:
              Number.isFinite(resolvedRatio) && resolvedRatio >= 0 && resolvedRatio <= 1
                ? resolvedRatio
                : 0.25,
          }
        : undefined;

    const newCapacity = calculateWeeklyCapacity({
      capacityConfig: currentCapacityConfig,
      foci: updatedFoci,
      obligations: proposedWeek.obligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      foci: updatedFoci,
      deferredItems: updatedDeferred,
      flexibleOptions: updatedFlexible,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCapacity,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCapacity.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    await persistDraft(updatedProposal, {
      deferredDecisions: nextDeferredDecisions,
      availableHoursInput:
        resolvedTotalHours !== undefined ? String(resolvedTotalHours) : availableHoursInput,
      protectedSpacePercentInput: String(Math.round(resolvedRatio * 100)),
    });
  };

  const handleVerifyCapacity = async (hoursOverride?: string, ratioOverride?: string) => {
    if (!proposedWeek) return;
    const rawHours = hoursOverride !== undefined ? hoursOverride : availableHoursInput;
    const rawPercent = ratioOverride !== undefined ? ratioOverride : protectedSpacePercentInput;

    const hours = rawHours.trim() !== "" ? Number(rawHours) : undefined;
    const percent = rawPercent.trim() !== "" ? Number(rawPercent) : 25;
    const ratio = (Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 25) / 100;

    const capacityConfig =
      hours !== undefined && Number.isFinite(hours) && hours >= 0
        ? { totalAvailableHours: hours, minProtectedSpaceRatio: ratio }
        : undefined;

    const newCap = calculateWeeklyCapacity({
      capacityConfig,
      foci: proposedWeek.foci,
      obligations: proposedWeek.obligations,
      flexibleOptions: proposedWeek.flexibleOptions,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCap,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCap.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    await persistDraft(updatedProposal, {
      availableHoursInput: rawHours,
      protectedSpacePercentInput: rawPercent,
      isEditingCapacity: false,
    });

    if (newCap.capacityStatus === "within_capacity") {
      setCapacityFeedbackMessage(
        `✓ Capacidad verificada: Semana viable (${formatHours(newCap.plannedHours)} planificadas de ${formatHours(newCap.plannableHours)} planificables, con ${formatHours(newCap.protectedSpaceHours)} de espacio protegido).`
      );
    } else if (newCap.capacityStatus === "over_capacity") {
      setCapacityFeedbackMessage(
        `⚠️ Sobrecarga detectada: ${formatHours(newCap.knownEstimatedHours)} estimadas superan la capacidad planificable de ${formatHours(newCap.plannableHours)}. El espacio protegido (${formatHours(newCap.protectedSpaceHours)}) está comprometido.`
      );
    } else if (newCap.totalAvailableHours != null && newCap.estimationCompleteness !== "complete") {
      setCapacityFeedbackMessage(
        `ℹ️ Límites calibrados (${formatHours(newCap.totalAvailableHours)} disponibles, ${formatHours(newCap.plannableHours)} planificables, con ${formatHours(newCap.protectedSpaceHours)} protegidas). Viabilidad no confirmada debido a tareas sin estimación de esfuerzo.`
      );
    } else {
      setCapacityFeedbackMessage(null);
    }
  };

  const handlePromoteFlexibleToFocus = async (itemId: string) => {
    if (!proposedWeek) return;
    if (proposedWeek.foci.length >= 3) {
      alert(
        "Para proteger tu foco y claridad mental, el límite es de 3 focos principales por semana."
      );
      return;
    }
    const opt = proposedWeek.flexibleOptions.find((o) => o.itemId === itemId);
    if (!opt) return;

    const newFocus: WeeklyFocus = {
      id: `focus-${opt.itemId}`,
      title: opt.title,
      desiredOutcome: `Avanzar en: ${opt.title}`,
      rationale: "Elegido conscientemente como foco semanal por decisión de la persona.",
      contributingItemIds: [opt.itemId],
      estimatedHours: opt.estimatedHours ?? null,
    };

    const updatedFoci = [...proposedWeek.foci, newFocus];
    const updatedFlexible = proposedWeek.flexibleOptions.filter((o) => o.itemId !== itemId);

    const currentCapacityConfig =
      proposedWeek.weekSummary.capacity.totalAvailableHours != null
        ? {
            totalAvailableHours: proposedWeek.weekSummary.capacity.totalAvailableHours,
            minProtectedSpaceRatio:
              proposedWeek.weekSummary.capacity.totalAvailableHours > 0 &&
              proposedWeek.weekSummary.capacity.protectedSpaceHours != null
                ? proposedWeek.weekSummary.capacity.protectedSpaceHours /
                  proposedWeek.weekSummary.capacity.totalAvailableHours
                : 0.25,
          }
        : undefined;

    const newCapacity = calculateWeeklyCapacity({
      capacityConfig: currentCapacityConfig,
      foci: updatedFoci,
      obligations: proposedWeek.obligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      foci: updatedFoci,
      flexibleOptions: updatedFlexible,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCapacity,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCapacity.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    await persistDraft(updatedProposal);
  };

  const handleDemoteFocusToFlexible = async (focusId: string) => {
    if (!proposedWeek) return;
    const focus = proposedWeek.foci.find((f) => f.id === focusId);
    if (!focus) return;

    const itemId = focus.contributingItemIds[0] ?? focus.id;
    const newFlexible: WeeklyFlexibleOption = {
      itemId,
      title: focus.title,
      condition: "Movido a opción flexible por decisión de la persona.",
      estimatedHours: focus.estimatedHours ?? null,
    };

    const updatedFoci = proposedWeek.foci.filter((f) => f.id !== focusId);
    const updatedFlexible = [...proposedWeek.flexibleOptions, newFlexible];

    const currentCapacityConfig =
      proposedWeek.weekSummary.capacity.totalAvailableHours != null
        ? {
            totalAvailableHours: proposedWeek.weekSummary.capacity.totalAvailableHours,
            minProtectedSpaceRatio:
              proposedWeek.weekSummary.capacity.totalAvailableHours > 0 &&
              proposedWeek.weekSummary.capacity.protectedSpaceHours != null
                ? proposedWeek.weekSummary.capacity.protectedSpaceHours /
                  proposedWeek.weekSummary.capacity.totalAvailableHours
                : 0.25,
          }
        : undefined;

    const newCapacity = calculateWeeklyCapacity({
      capacityConfig: currentCapacityConfig,
      foci: updatedFoci,
      obligations: proposedWeek.obligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      foci: updatedFoci,
      flexibleOptions: updatedFlexible,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCapacity,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCapacity.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    await persistDraft(updatedProposal);
  };

  const handleSaveProposalItemHours = async (itemId: string, newHours: number | null) => {
    if (!proposedWeek) return;

    const updatedFoci = proposedWeek.foci.map((f) => {
      if (f.id === itemId || f.contributingItemIds.includes(itemId)) {
        return { ...f, estimatedHours: newHours };
      }
      return f;
    });

    const updatedObligations = proposedWeek.obligations.map((o) => {
      if (o.itemId === itemId) {
        return { ...o, estimatedHours: newHours };
      }
      return o;
    });

    const updatedFlexible = proposedWeek.flexibleOptions.map((opt) => {
      if (opt.itemId === itemId) {
        return { ...opt, estimatedHours: newHours };
      }
      return opt;
    });

    const currentCapacityConfig =
      proposedWeek.weekSummary.capacity.totalAvailableHours != null
        ? {
            totalAvailableHours: proposedWeek.weekSummary.capacity.totalAvailableHours,
            minProtectedSpaceRatio:
              proposedWeek.weekSummary.capacity.totalAvailableHours > 0 &&
              proposedWeek.weekSummary.capacity.protectedSpaceHours != null
                ? proposedWeek.weekSummary.capacity.protectedSpaceHours /
                  proposedWeek.weekSummary.capacity.totalAvailableHours
                : 0.25,
          }
        : undefined;

    const newCapacity = calculateWeeklyCapacity({
      capacityConfig: currentCapacityConfig,
      foci: updatedFoci,
      obligations: updatedObligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedProposal: ProposedWeek = {
      ...proposedWeek,
      foci: updatedFoci,
      obligations: updatedObligations,
      flexibleOptions: updatedFlexible,
      weekSummary: {
        ...proposedWeek.weekSummary,
        capacity: newCapacity,
      },
      unplannedSpace: {
        ...proposedWeek.unplannedSpace,
        recommendedHours: newCapacity.protectedSpaceHours,
      },
    };

    setProposedWeek(updatedProposal);
    setEditingProposalItemId(null);
    setProposalItemHoursInput("");
    await persistDraft(updatedProposal);
  };

  const acceptedCount = extractedItems
    ? extractedItems.filter((i) => acceptedItemIds.has(i.id)).length
    : 0;

  return (
    <section
      className="calm-box weekly-planning-flow"
      style={{
        marginTop: "20px",
        background: "var(--card-bg, #ffffff)",
        borderColor: "var(--border-color, #e0e0e0)",
      }}
      aria-label="Cuaderno de ideas y planificación semanal"
    >
      {/* Cabecera y barra de progreso del flujo guiado */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexWrap: "wrap",
          gap: "8px",
          marginBottom: "6px",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Nueva semana</h2>
          <p className="calm-muted" style={{ margin: "4px 0 0 0", fontSize: "0.88rem" }}>
            Elige qué cuidar esta semana.
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          {hasActivePlan && (
            <span className="badge badge-muted">
              Actualmente ya tienes una semana activa en curso
            </span>
          )}
        </div>
      </div>

      {/* Línea de progreso visible: Escribir → Revisar → Confirmar */}
      <div
        className="guided-flow-progress"
        data-testid="guided-flow-progress"
        role="navigation"
        aria-label="Progreso de nueva semana"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "14px 0 20px 0",
          background: "var(--surface-warm, #fdfbf7)",
          border: "1px solid var(--border-color, #e6ded1)",
          borderRadius: "20px",
          fontSize: "0.85rem",
          flexWrap: "wrap",
        }}
      >
        {/* Paso 1: Escribir */}
        <button
          type="button"
          onClick={() => setFlowStep("write")}
          className={flowStep === "write" ? "primary small" : "secondary small"}
          aria-current={flowStep === "write" ? "step" : undefined}
          data-testid="step-indicator-write"
          style={{
            borderRadius: "14px",
            padding: "3px 12px",
            fontWeight: flowStep === "write" ? 700 : 500,
            cursor: "pointer",
            background: flowStep === "write" ? undefined : "#ffffff",
          }}
        >
          {flowStep !== "write" ? "✓ 1. Escribir" : "1. Escribir"}
        </button>

        <span style={{ color: "#aaa", userSelect: "none" }}>→</span>

        {/* Paso 2: Revisar */}
        <button
          type="button"
          onClick={() => {
            if (proposedWeek || (extractedItems && extractedItems.length > 0)) {
              setFlowStep("review");
            }
          }}
          disabled={!proposedWeek && (!extractedItems || extractedItems.length === 0)}
          className={flowStep === "review" ? "primary small" : "secondary small"}
          aria-current={flowStep === "review" ? "step" : undefined}
          data-testid="step-indicator-review"
          style={{
            borderRadius: "14px",
            padding: "3px 12px",
            fontWeight: flowStep === "review" ? 700 : 500,
            opacity:
              flowStep === "review" || proposedWeek || (extractedItems && extractedItems.length > 0)
                ? 1
                : 0.5,
            cursor:
              proposedWeek || (extractedItems && extractedItems.length > 0) ? "pointer" : "default",
            background: flowStep === "review" ? undefined : "#ffffff",
          }}
        >
          {flowStep === "confirm" ? "✓ 2. Revisar" : "2. Revisar"}
        </button>

        <span style={{ color: "#aaa", userSelect: "none" }}>→</span>

        {/* Paso 3: Confirmar */}
        <button
          type="button"
          onClick={() => {
            if (proposedWeek) {
              setFlowStep("confirm");
            }
          }}
          disabled={!proposedWeek}
          className={flowStep === "confirm" ? "primary small" : "secondary small"}
          aria-current={flowStep === "confirm" ? "step" : undefined}
          data-testid="step-indicator-confirm"
          style={{
            borderRadius: "14px",
            padding: "3px 12px",
            fontWeight: flowStep === "confirm" ? 700 : 500,
            opacity: flowStep === "confirm" || proposedWeek ? 1 : 0.5,
            cursor: proposedWeek ? "pointer" : "default",
            background: flowStep === "confirm" ? undefined : "#ffffff",
          }}
        >
          3. Confirmar
        </button>
      </div>

      {successMessage && (
        <div className="status-message status-info" style={{ marginBottom: "16px" }} role="status">
          {successMessage}
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PASO 1: ESCRIBIR                                                    */}
      {/* -------------------------------------------------------------------- */}
      {flowStep === "write" && (
        <div data-testid="flow-step-write">
          <details className="capture-examples" data-testid="capture-examples">
            <summary>Probar con un ejemplo</summary>
            <label htmlFor="capture-example-select">Caso de ejemplo:</label>
            <select
              id="capture-example-select"
              data-testid="sample-case-select"
              value={selectedCaseId}
              onChange={(e) => handleCaseSelect(e.target.value)}
            >
              <option value="">Elige un ejemplo</option>
              {sampleDumpsData.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </details>

          <section className="input-section">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <label
                htmlFor="planning-notes-input"
                className="textarea-label"
                style={{ margin: 0 }}
              >
                ¿Qué tienes en la cabeza?
              </label>
              <VoiceDictationButton
                getText={() => noteText}
                onTranscript={(transcript) => {
                  setNoteText((prev) => (prev ? `${prev}\n${transcript}` : transcript));
                }}
              />
            </div>

            <textarea
              id="planning-notes-input"
              data-testid="flow-textarea"
              rows={6}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Escribe todo lo que te venga a la mente sin preocuparte por ordenar..."
              style={{ width: "100%", padding: "10px", boxSizing: "border-box" }}
              disabled={isExtracting || isPlanning}
            />

            <div
              className="actions"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "8px",
                marginTop: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.85rem", color: "#8c8273" }}>
                  {noteText.length} caracteres
                </span>
                {noteText.trim().length > 0 && (
                  <span
                    className="calm-muted"
                    style={{
                      fontSize: "0.8rem",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                    data-testid="dump-autosave-indicator"
                  >
                    💾 Borrador guardado automáticamente
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {noteText.trim().length > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleClearText}
                    data-testid="clear-dump-button"
                  >
                    ✨ Limpiar volcado
                  </button>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={isExtracting || isPlanning || !noteText.trim()}
                  onClick={handleContinueFromWrite}
                  data-testid="flow-continue-to-review"
                >
                  {isExtracting
                    ? "Entendiendo notas..."
                    : isPlanning
                      ? "Preparando propuesta..."
                      : "Continuar →"}
                </button>
              </div>
            </div>
          </section>

          {extractError && (
            <div
              className="status-message status-error"
              style={{ marginTop: "12px" }}
              role="alert"
              data-testid="flow-error"
            >
              <strong>Error al procesar:</strong> {extractError}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PASO 2: REVISAR                                                     */}
      {/* -------------------------------------------------------------------- */}
      {flowStep === "review" && (
        <div data-testid="flow-step-review">
          <PlanningHeaderSection
            hasActivePlan={hasActivePlan}
            initialItems={initialItems}
            successMessage={null}
            targetWeekStart={targetWeekStart}
            setTargetWeekStart={setTargetWeekStart}
            targetWeekEnd={targetWeekEnd}
            setTargetWeekEnd={setTargetWeekEnd}
            handleStartFreshWeek={handleStartFreshWeek}
            draftPlans={state.draftPlans}
            proposedWeek={proposedWeek}
            isReviewingSelection={isReviewingSelection}
            handleReturnToProposal={handleReturnToProposal}
            handleCancelProposal={handleCancelProposal}
            carryOverTasks={carryOverTasks}
            selectedCarryOverItemIds={selectedCarryOverItemIds}
            handleToggleCarryOverItem={handleToggleCarryOverItem}
            setSelectedCarryOverItemIds={setSelectedCarryOverItemIds}
            isPlanning={isPlanning}
            handleGenerateProposal={handleGenerateProposal}
            extractedItems={extractedItems}
            activeTargetWeek={activeTargetWeek}
            handleCalendarApplied={handleCalendarApplied}
          />

          {extractedItems && (
            <PlanningExtractedItemsReview
              extractedItems={extractedItems}
              acceptedItemIds={acceptedItemIds}
              acceptedCount={acceptedCount}
              handleAcceptAll={handleAcceptAll}
              handleDiscardAll={handleDiscardAll}
              handleStartFreshWeek={handleStartFreshWeek}
              handleToggleItem={handleToggleItem}
              handleUpdateItemEffort={handleUpdateItemEffort}
              handleUpdateItemDeadline={handleUpdateItemDeadline}
              noteText={noteText}
              setNoteText={setNoteText}
              isExtracting={isExtracting}
              handleExtract={handleExtract}
              userIntent={userIntent}
              setUserIntent={setUserIntent}
              availableHoursInput={availableHoursInput}
              setAvailableHoursInput={setAvailableHoursInput}
              protectedSpacePercentInput={protectedSpacePercentInput}
              setProtectedSpacePercentInput={setProtectedSpacePercentInput}
              isPlanning={isPlanning}
              planningError={planningError}
              selectedCarryOverItemIds={selectedCarryOverItemIds}
              handleGenerateProposal={handleGenerateProposal}
              isProposalDirty={isProposalDirty}
              proposedWeek={proposedWeek}
            />
          )}

          {proposedWeek && (
            <div
              style={{
                marginTop: "24px",
                paddingTop: "16px",
                borderTop: "1px solid var(--border-color, #e0e0e0)",
              }}
              aria-label="Revisión de propuesta semanal"
              data-testid="weekly-proposal-screen"
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div>
                  <div
                    className="calm-muted"
                    style={{
                      fontSize: "0.8rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontWeight: 600,
                    }}
                  >
                    Propuesta semanal
                  </div>
                  <h2 style={{ margin: "2px 0 0 0" }}>
                    {proposedWeek.weekSummary.intent
                      ? `«${proposedWeek.weekSummary.intent}»`
                      : "Plan de la semana"}
                  </h2>
                </div>
                <div
                  style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}
                >
                  <span className="badge badge-task">
                    {proposedWeek.weekSummary.targetWeek.startDate} al{" "}
                    {proposedWeek.weekSummary.targetWeek.endDate}
                  </span>
                  <span className="badge badge-idea" data-testid="draft-notebook-status-badge">
                    📒 Borrador en cuaderno local
                  </span>
                </div>
              </div>

              <PlanningCapacityHud
                proposedWeek={proposedWeek}
                calendarSummary={calendarSummary}
                isEditingCapacity={isEditingCapacity}
                setIsEditingCapacity={setIsEditingCapacity}
                availableHoursInput={availableHoursInput}
                setAvailableHoursInput={setAvailableHoursInput}
                protectedSpacePercentInput={protectedSpacePercentInput}
                setProtectedSpacePercentInput={setProtectedSpacePercentInput}
                capacityFeedbackMessage={capacityFeedbackMessage}
                onStartEditCapacity={handleStartEditCapacity}
                onCancelEditCapacity={handleCancelEditCapacity}
                onVerifyCapacity={handleVerifyCapacity}
              />

              <PlanningProposedItemsSection
                proposedWeek={proposedWeek}
                activeTargetWeek={activeTargetWeek}
                extractedItems={extractedItems}
                editingProposalItemId={editingProposalItemId}
                proposalItemHoursInput={proposalItemHoursInput}
                setEditingProposalItemId={setEditingProposalItemId}
                setProposalItemHoursInput={setProposalItemHoursInput}
                handleDemoteFocusToFlexible={handleDemoteFocusToFlexible}
                handlePromoteFlexibleToFocus={handlePromoteFlexibleToFocus}
                handleSaveProposalItemHours={handleSaveProposalItemHours}
              />

              <PlanningDeferredItemsSection
                proposedWeek={proposedWeek}
                extractedItems={extractedItems}
                deferredDecisions={deferredDecisions}
                handleDeferredDecisionChange={handleDeferredDecisionChange}
                handleApplyOverdueDecision={handleApplyOverdueDecision}
              />
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "24px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border-color, #e0e0e0)",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <button
              type="button"
              className="secondary"
              data-testid="flow-back-to-write"
              onClick={() => setFlowStep("write")}
            >
              ← Volver a escribir
            </button>
            <button
              type="button"
              className="primary"
              data-testid="flow-continue-to-confirm"
              onClick={handleContinueToConfirm}
              disabled={!proposedWeek}
            >
              Continuar a confirmar →
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* PASO 3: CONFIRMAR                                                   */}
      {/* -------------------------------------------------------------------- */}
      {flowStep === "confirm" && proposedWeek && (
        <div data-testid="flow-step-confirm">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <button
              type="button"
              className="secondary"
              data-testid="flow-back-to-review"
              onClick={() => setFlowStep("review")}
            >
              ← Volver a revisar
            </button>
          </div>

          <PlanningProposalReviewFooter
            proposedWeek={proposedWeek}
            activeTargetWeek={activeTargetWeek}
            diagnostics={diagnostics}
            activePlanConflict={activePlanConflict}
            setActivePlanConflict={setActivePlanConflict}
            onPlanCreated={onPlanCreated}
            confirmationError={confirmationError}
            userIntent={userIntent}
            setUserIntent={setUserIntent}
            isConfirming={isConfirming}
            handleAdjustElements={() => {
              handleAdjustElements();
              setFlowStep("review");
            }}
            setIsReviewingSelection={() => setFlowStep("review")}
            handleStartFreshWeek={handleStartFreshWeek}
            handleConfirmPlan={handleConfirmPlan}
          />
        </div>
      )}
    </section>
  );
}
