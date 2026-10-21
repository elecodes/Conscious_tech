import { useState, useRef, useEffect } from "react";
import { AIProvider } from "../../providers/ai-provider";
import { MockProvider } from "../../providers/mock-provider";
import { ExtractedItem, ExtractedItems } from "../../domain/items";
import { ProposedWeek, resolveDefaultTargetWeek, TargetWeek, WeeklyFocus, WeeklyFlexibleOption, DeferredItem } from "../../domain/week";
import { StoredWeeklyPlan, WeeklyPlanDraftContext } from "../../domain/repositories/types";
import { WeeklySchedule } from "../../domain/schedule";
import { extractItems } from "../../skills/extract-items";
import { calculateWeeklyCapacity } from "../../skills/build-week/deterministic";
import {
  generateWeeklyProposalFromItemsDetailed,
  PipelineDiagnostic,
} from "../../application/planning-pipeline";
import { useWeeklySession } from "../context/weekly-session-context";
import {
  formatCapacityStatus,
  formatProtectedSpaceStatus,
  formatEstimationCompleteness,
  formatHours,
  formatDeferredReason,
  formatUnscheduledCategory,
} from "./weekly-session-view";

export interface PendingCarryOverTask {
  itemId: string;
  title: string;
  originCategory: string;
  postponementReason: string;
  targetWeek?: TargetWeek;
  dueDate?: string;
  estimatedHours?: number | null;
}

export interface WeeklyPlanningFromNotesProps {
  provider?: AIProvider;
  currentDate?: string;
  onPlanCreated?: () => void;
  hasActivePlan?: boolean;
  initialItems?: ExtractedItem[];
  initialProposedWeek?: ProposedWeek;
}

export function WeeklyPlanningFromNotes({
  provider = new MockProvider(),
  currentDate,
  onPlanCreated,
  hasActivePlan = false,
  initialItems,
  initialProposedWeek,
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

  // State: Notes & Extraction
  const [noteText, setNoteText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedItems, setExtractedItems] = useState<ExtractedItem[] | null>(
    initialItems && initialItems.length > 0 ? initialItems : null
  );
  const [acceptedItemIds, setAcceptedItemIds] = useState<Set<string>>(
    () => new Set((initialItems || []).map((i) => i.id))
  );

  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setExtractedItems(initialItems);
      setAcceptedItemIds(new Set(initialItems.map((i) => i.id)));
      setProposedWeek(null);
    }
  }, [initialItems]);

  const [userIntent, setUserIntent] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [proposedWeek, setProposedWeek] = useState<ProposedWeek | null>(
    initialProposedWeek ?? null
  );
  const [isReviewingSelection, setIsReviewingSelection] = useState(false);
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
  const [isEditingCapacity, setIsEditingCapacity] = useState(false);
  const [editingProposalItemId, setEditingProposalItemId] = useState<string | null>(null);
  const [proposalItemHoursInput, setProposalItemHoursInput] = useState<string>("");

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
      if (initialProposedWeek || (initialItems && initialItems.length > 0) || !service?.getDraftPlan) return;
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
              setAvailableHoursInput(String(draft.proposal.weekSummary.capacity.totalAvailableHours));
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
        console.error("Failed to restore draft plan", err);
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
      console.error("Failed to save plan draft", e);
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
        console.error("Failed to load carryover tasks", err);
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

  const handleStartFreshWeek = async () => {
    setExtractedItems(null);
    setAcceptedItemIds(new Set());
    setProposedWeek(null);
    setDiagnostics([]);
    setNoteText("");
    setUserIntent("");
    setExtractError(null);
    setConfirmationError(null);
    if (service?.clearDraftPlan) {
      try {
        await service.clearDraftPlan(activeTargetWeek);
      } catch (e) {
        console.error("Error clearing draft in storage", e);
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

    const selectedCarryOver = carryOverTasks.filter((t) =>
      selectedCarryOverItemIds.has(t.itemId)
    );

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
        protectedSpacePercentInput.trim() !== ""
          ? Number(protectedSpacePercentInput) / 100
          : 0.25;

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
            const updatedFoci = finalProposal.foci.filter((f) => !f.contributingItemIds.includes(itemId));
            const updatedDeferred = finalProposal.deferredItems.filter((d) => d.itemId !== itemId);
            const updatedFlexible = finalProposal.flexibleOptions.filter((o) => o.itemId !== itemId);
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
    } catch (err) {
      if (reqId !== planningRequestIdRef.current) return;
      setPlanningError(
        (err as Error).message ||
          "Ocurrió un error al generar la propuesta semanal con la IA."
      );
    } finally {
      if (reqId === planningRequestIdRef.current) {
        setIsPlanning(false);
      }
    }
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
        if (onPlanCreated) {
          onPlanCreated();
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

    const updatedFoci = proposedWeek.foci.filter(
      (f) => !f.contributingItemIds.includes(itemId)
    );
    const updatedDeferred = proposedWeek.deferredItems.filter(
      (d) => d.itemId !== itemId
    );
    const updatedFlexible = proposedWeek.flexibleOptions.filter(
      (o) => o.itemId !== itemId
    );
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
              Number.isFinite(resolvedRatio) &&
              resolvedRatio >= 0 &&
              resolvedRatio <= 1
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
      availableHoursInput: resolvedTotalHours !== undefined ? String(resolvedTotalHours) : availableHoursInput,
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
            rationale: "Reconsiderado e incluido conscientemente en la semana por decisión de la persona.",
            contributingItemIds: [itemId],
            estimatedHours,
          });
        } else {
          updatedFlexible.push({
            itemId,
            title: itemTitle,
            condition: "Reconsiderado e incluido conscientemente en la semana como opción flexible al alcanzarse el máximo de 3 focos.",
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
        rationale: "Postergado conscientemente por decisión de la persona para evaluar en una semana posterior.",
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
              Number.isFinite(resolvedRatio) &&
              resolvedRatio >= 0 &&
              resolvedRatio <= 1
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
      availableHoursInput: resolvedTotalHours !== undefined ? String(resolvedTotalHours) : availableHoursInput,
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
      alert("Para proteger tu foco y claridad mental, el límite es de 3 focos principales por semana.");
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
      className="calm-box"
      style={{
        marginTop: "20px",
        background: "var(--card-bg, #ffffff)",
        borderColor: "var(--border-color, #e0e0e0)",
      }}
      aria-label="Cuaderno de ideas y planificación semanal"
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
        <h3>Planificar semana a partir de ideas</h3>
        <span className="badge badge-idea">IA propone · Tú decides</span>
      </div>

      {hasActivePlan && (
        <div
          className="calm-box"
          style={{
            marginTop: "12px",
            background: "#fff9e6",
            borderColor: "#ffe082",
            fontSize: "0.9rem",
          }}
        >
          ℹ️ <strong>Nota:</strong> Actualmente ya tienes una semana activa. Si generas y confirmas
          un nuevo plan, deberás haber cerrado la semana en curso previamente para evitar conflictos.
        </div>
      )}

      {initialItems && initialItems.length > 0 && (
        <div
          className="calm-box"
          style={{
            marginTop: "12px",
            background: "#eef6ff",
            borderColor: "#bcd7ff",
            fontSize: "0.9rem",
            color: "#1d4ed8",
          }}
          data-testid="transferred-items-notice"
        >
          📋 <strong>Elementos transferidos:</strong> Se cargaron {initialItems.length} elemento(s) extraídos del volcado mental. Puedes ajustar la semana objetivo y seleccionar cuáles incluir antes de generar la propuesta.
        </div>
      )}

      {successMessage && (
        <div
          className="status-message status-info"
          style={{ marginTop: "12px" }}
          role="status"
        >
          {successMessage}
        </div>
      )}

      {/* Selector de semana objetivo a planificar */}
      <div
        className="config-box"
        style={{
          marginTop: "12px",
          padding: "10px 14px",
          background: "#fdfdfd",
          border: "1px solid var(--border-color, #e0e0e0)",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Semana objetivo a planificar:</span>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="target-week-start-input" style={{ fontSize: "0.85rem", color: "#666" }}>
              Desde:
            </label>
            <input
              id="target-week-start-input"
              data-testid="target-week-start-input"
              type="date"
              value={targetWeekStart}
              onChange={(e) => setTargetWeekStart(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "0.85rem" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label htmlFor="target-week-end-input" style={{ fontSize: "0.85rem", color: "#666" }}>
              Hasta:
            </label>
            <input
              id="target-week-end-input"
              data-testid="target-week-end-input"
              type="date"
              value={targetWeekEnd}
              onChange={(e) => setTargetWeekEnd(e.target.value)}
              style={{ padding: "4px 8px", fontSize: "0.85rem" }}
            />
          </div>
        </div>

        <button
          type="button"
          className="secondary small"
          style={{ fontSize: "0.82rem", padding: "4px 8px" }}
          onClick={handleStartFreshWeek}
          data-testid="start-fresh-week-top-button"
          title="Despeja el cuaderno para iniciar la planificación de una nueva semana sin datos previos"
        >
          ✨ Limpiar y empezar nueva semana
        </button>
      </div>

      {/* Lista de borradores guardados si existen en el estado */}
      {state.draftPlans && state.draftPlans.length > 0 && (
        <div
          className="calm-box"
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            background: "#fcfbf9",
            border: "1px dashed var(--border-color, #e0ded9)",
            borderRadius: "6px",
            fontSize: "0.85rem",
          }}
          data-testid="saved-drafts-selector"
        >
          <span style={{ fontWeight: 600, color: "var(--text-main, #333)", marginRight: "8px" }}>
            📂 Borradores guardados:
          </span>
          <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
            {state.draftPlans.map((draft) => {
              const isSelected =
                draft.targetWeek.startDate === targetWeekStart &&
                draft.targetWeek.endDate === targetWeekEnd;
              return (
                <button
                  key={draft.planId}
                  type="button"
                  className={isSelected ? "primary small" : "secondary small"}
                  style={{ fontSize: "0.8rem", padding: "2px 8px" }}
                  onClick={() => {
                    setTargetWeekStart(draft.targetWeek.startDate);
                    setTargetWeekEnd(draft.targetWeek.endDate);
                  }}
                  data-testid={`select-draft-${draft.targetWeek.startDate}`}
                >
                  Semana {draft.targetWeek.startDate} al {draft.targetWeek.endDate}
                  {isSelected ? " (Activo)" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Aviso de propuesta previa ya disponible si el usuario está revisando o ajustando */}
      {proposedWeek && isReviewingSelection && (
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            background: "#f0f7ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong style={{ fontSize: "0.92rem", color: "#1e40af", display: "block" }}>
              ✓ Propuesta semanal ya preparada para esta semana
            </strong>
            <span style={{ fontSize: "0.82rem", color: "#2563eb" }}>
              Estás revisando los elementos y tu intención. La propuesta previa sigue disponible.
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="primary small"
              data-testid="return-to-proposal-button"
              onClick={handleReturnToProposal}
            >
              → Volver a la propuesta generada
            </button>
            <button
              type="button"
              className="secondary small"
              data-testid="discard-proposal-button"
              onClick={handleCancelProposal}
            >
              Descartar propuesta
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 0. Carryover Tasks from Previous Weeks (Sovereign Human Selection)   */}
      {/* -------------------------------------------------------------------- */}
      {carryOverTasks.length > 0 && !proposedWeek && (
        <div
          className="calm-box"
          style={{
            marginTop: "16px",
            background: "#f9fafb",
            borderColor: "#e5e7eb",
          }}
          data-testid="carryover-tasks-section"
          aria-label="Tareas postergadas de semanas anteriores"
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
            <h4 style={{ margin: 0 }}>Tareas postergadas de semanas anteriores</h4>
            <span className="badge badge-muted">
              {selectedCarryOverItemIds.size} de {carryOverTasks.length} seleccionadas
            </span>
          </div>

          <p className="calm-muted" style={{ fontSize: "0.88rem", marginTop: "4px" }}>
            Tareas reprogramadas para esta semana o pendientes de ciclos previos.
            <strong> Ninguna se incorpora automáticamente; tú decides cuáles incluir en el borrador.</strong>
          </p>

          <ul
            className="items-list"
            style={{ marginTop: "12px", listStyle: "none", padding: 0 }}
            aria-label="Lista de tareas postergadas recuperables"
          >
            {carryOverTasks.map((task) => {
              const isSelected = selectedCarryOverItemIds.has(task.itemId);
              const hasExplicitDestination = Boolean(task.targetWeek);
              return (
                <li
                  key={task.itemId}
                  className="item-card"
                  data-testid={`carryover-item-${task.itemId}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "12px",
                    padding: "10px 12px",
                    marginBottom: "8px",
                    background: isSelected ? "#ffffff" : "#fdfdfd",
                    border: isSelected
                      ? "1px solid var(--accent-color, #4a6da7)"
                      : "1px solid #e0e0e0",
                    borderRadius: "6px",
                  }}
                >
                  <input
                    type="checkbox"
                    id={`carryover-check-${task.itemId}`}
                    checked={isSelected}
                    onChange={() => handleToggleCarryOverItem(task.itemId)}
                    aria-label={`Incorporar tarea postergada ${task.title}`}
                    style={{ marginTop: "4px", cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "8px",
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ fontSize: "0.95rem" }}>{task.title}</strong>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <span className="badge badge-task">
                          Origen: {task.originCategory}
                        </span>
                        {task.estimatedHours != null && (
                          <span className="badge badge-muted">
                            ⏱ {task.estimatedHours}h
                          </span>
                        )}
                        {task.dueDate && (
                          <span
                            className="badge badge-error"
                            data-testid={`carryover-deadline-${task.itemId}`}
                          >
                            📅 Deadline original: {task.dueDate}
                          </span>
                        )}
                        {!hasExplicitDestination && (
                          <span
                            className="badge badge-muted"
                            data-testid={`carryover-unconfirmed-${task.itemId}`}
                          >
                            Sin destino confirmado
                          </span>
                        )}
                      </div>
                    </div>

                    {hasExplicitDestination && task.targetWeek && (
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#4a6da7",
                          marginTop: "4px",
                        }}
                        data-testid={`carryover-target-week-${task.itemId}`}
                      >
                        🎯 <strong>Semana destino confirmada:</strong> {task.targetWeek.startDate} al{" "}
                        {task.targetWeek.endDate}
                      </div>
                    )}

                    <div
                      className="calm-muted"
                      style={{
                        fontSize: "0.85rem",
                        marginTop: "4px",
                        fontStyle: "italic",
                      }}
                      data-testid={`carryover-reason-${task.itemId}`}
                    >
                      <em>Motivo de postergación:</em> {task.postponementReason}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Quick action buttons for carryover selection */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "8px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                onClick={() =>
                  setSelectedCarryOverItemIds(
                    new Set(carryOverTasks.map((t) => t.itemId))
                  )
                }
              >
                Seleccionar todas las postergadas
              </button>
              <button
                type="button"
                className="secondary"
                style={{ fontSize: "0.82rem", padding: "4px 8px" }}
                onClick={() => setSelectedCarryOverItemIds(new Set())}
              >
                Deseleccionar todas
              </button>
            </div>

            {/* Direct proposal generation if only planning carryover tasks without extra notes */}
            {!extractedItems && selectedCarryOverItemIds.size > 0 && (
              <button
                type="button"
                className="primary"
                style={{ fontSize: "0.88rem", padding: "6px 12px" }}
                data-testid="generate-proposal-from-carryover-button"
                disabled={isPlanning}
                onClick={handleGenerateProposal}
              >
                {isPlanning
                  ? "Estructurando propuesta semanal..."
                  : `Planificar con ${selectedCarryOverItemIds.size} tarea(s) postergada(s)`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 1. Input Section when no items exist yet */}
      {/* -------------------------------------------------------------------- */}
      {(!extractedItems || extractedItems.length === 0) && (
        <div style={{ marginTop: "16px" }}>
          <label
            htmlFor="planning-notes-input"
            style={{ display: "block", fontWeight: 600, marginBottom: "6px" }}
          >
            ¿Qué tienes en mente para planificar?
          </label>
          <textarea
            id="planning-notes-input"
            rows={5}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Escribe libremente todo lo que tengas en la cabeza: tareas, compromisos con fechas, proyectos o ideas que quieras evaluar..."
            style={{ width: "100%", padding: "10px", boxSizing: "border-box" }}
            disabled={isExtracting}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "6px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "0.85rem", color: "#8c8273" }}>
              {noteText.length} caracteres
            </span>
            <button
              type="button"
              className="primary"
              aria-label="Analizar y extraer elementos de las notas"
              disabled={isExtracting || !noteText.trim()}
              onClick={() => handleExtract("replace")}
              data-testid="extract-button"
            >
              {isExtracting ? "Entendiendo notas..." : "Analizar y extraer elementos"}
            </button>
          </div>
        </div>
      )}

      {extractError && (
        <div
          className="status-message status-error"
          style={{ marginTop: "12px" }}
          role="alert"
        >
          <strong>Error de extracción:</strong> {extractError}
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 2. Review Extracted Items */}
      {/* -------------------------------------------------------------------- */}
      {extractedItems && (!proposedWeek || isReviewingSelection) && (
        <div
          style={{
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-color, #e0e0e0)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <h4 style={{ margin: 0, fontSize: "1.05rem" }}>
              Elementos identificados ({acceptedCount} de {extractedItems.length} seleccionados)
            </h4>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary small"
                style={{ fontSize: "0.82rem", padding: "3px 8px" }}
                onClick={handleAcceptAll}
              >
                Aceptar todos
              </button>
              <button
                type="button"
                className="secondary small"
                style={{ fontSize: "0.82rem", padding: "3px 8px" }}
                onClick={handleDiscardAll}
              >
                Descartar todos
              </button>
              <button
                type="button"
                className="secondary small"
                style={{ fontSize: "0.82rem", padding: "3px 8px", color: "#8c8273" }}
                onClick={handleStartFreshWeek}
                data-testid="clear-extracted-items-button"
                title="Despejar elementos actuales y empezar una nueva semana"
              >
                ✨ Limpiar elementos
              </button>
            </div>
          </div>

          <p className="calm-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px 0" }}>
            Selecciona qué elementos deseas incluir en la propuesta semanal. Los no seleccionados
            se descartarán de esta planificación.
          </p>

          {extractedItems.length === 0 ? (
            <p className="calm-muted" style={{ marginTop: "12px" }}>
              No se identificaron elementos accionables en el texto. Puedes intentar expresarlo con
              más detalle.
            </p>
          ) : (
            <ul
              className="items-list"
              style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}
              aria-label="Lista de elementos identificados"
            >
              {extractedItems.map((item) => {
                const isAccepted = acceptedItemIds.has(item.id);
                return (
                  <li
                    key={item.id}
                    className="item-card"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "8px 12px",
                      background: isAccepted ? "var(--bg-highlight, #fdfdfd)" : "#fafafa",
                      opacity: isAccepted ? 1 : 0.6,
                      border: isAccepted
                        ? "1px solid var(--border-color, #e0ded9)"
                        : "1px dashed #d1d5db",
                      borderRadius: "6px",
                    }}
                  >
                    <input
                      type="checkbox"
                      id={`item-check-${item.id}`}
                      checked={isAccepted}
                      onChange={() => handleToggleItem(item.id)}
                      aria-label={`Incluir elemento ${item.title}`}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <strong
                          style={{
                            fontSize: "0.92rem",
                            textDecoration: isAccepted ? "none" : "line-through",
                            color: isAccepted ? "inherit" : "var(--text-muted, #888)",
                          }}
                        >
                          {item.title}
                        </strong>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span className={`badge badge-${item.type}`}>{item.type}</span>
                          {item.project && (
                            <span className="badge badge-muted">📁 {item.project}</span>
                          )}
                          {item.estimatedEffort && (
                            <span className="badge badge-muted">
                              ⏱ {item.estimatedEffort.value} {item.estimatedEffort.unit}
                            </span>
                          )}
                          {item.deadline && (
                            <span className="badge badge-muted" style={{ color: "#b45309" }}>
                              📅 {item.deadline.raw}{" "}
                              {item.deadline.resolved ? `(${item.deadline.resolved})` : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {isAccepted && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            flexWrap: "wrap",
                            fontSize: "0.82rem",
                            color: "var(--text-muted, #666)",
                            marginTop: "2px",
                          }}
                        >
                          <label
                            htmlFor={`item-effort-${item.id}`}
                            style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
                          >
                            <span>⏱️ Horas:</span>
                            <input
                              id={`item-effort-${item.id}`}
                              type="number"
                              min="0"
                              max="100"
                              step="0.5"
                              placeholder="Sin estimar"
                              value={item.estimatedEffort?.value ?? ""}
                              onChange={(e) => {
                                const val = e.target.value === "" ? null : Number(e.target.value);
                                handleUpdateItemEffort(item.id, val);
                              }}
                              style={{
                                width: "80px",
                                padding: "2px 6px",
                                fontSize: "0.82rem",
                                borderRadius: "4px",
                                border: "1px solid var(--border-color, #ccc)",
                                background: "var(--bg-card, #fff)",
                              }}
                              aria-label={`Horas estimadas para ${item.title}`}
                            />
                            <span>h</span>
                          </label>

                          <label
                            htmlFor={`item-deadline-${item.id}`}
                            style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
                          >
                            <span>📅 Límite / Fecha:</span>
                            <input
                              id={`item-deadline-${item.id}`}
                              type="date"
                              value={
                                item.deadline?.resolved ||
                                (item.deadline?.raw && /^\d{4}-\d{2}-\d{2}$/.test(item.deadline.raw)
                                  ? item.deadline.raw
                                  : "")
                              }
                              onChange={(e) => {
                                handleUpdateItemDeadline(item.id, e.target.value || null);
                              }}
                              style={{
                                padding: "2px 6px",
                                fontSize: "0.82rem",
                                borderRadius: "4px",
                                border: "1px solid var(--border-color, #ccc)",
                                background: "var(--bg-card, #fff)",
                              }}
                              aria-label={`Fecha límite para ${item.title}`}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Añadir más ideas o tareas a la lista */}
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              background: "#fafaf8",
              border: "1px solid var(--border-color, #e6ded1)",
              borderRadius: "8px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "6px" }}>
              <label
                htmlFor="planning-notes-input"
                style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-main)" }}
              >
                ➕ ¿Quieres añadir más ideas o tareas a esta semana? (opcional)
              </label>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {noteText.length} caracteres
              </span>
            </div>
            <textarea
              id="planning-notes-input"
              rows={3}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Escribe tareas o ideas adicionales que quieras sumar a la lista de arriba..."
              style={{ width: "100%", padding: "8px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
              disabled={isExtracting}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "8px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="secondary small"
                aria-label="Añadir nuevas ideas a la lista existente"
                disabled={isExtracting || !noteText.trim()}
                onClick={() => handleExtract("append")}
                data-testid="extract-append-button"
              >
                {isExtracting ? "Entendiendo notas..." : "➕ Añadir a la lista existente"}
              </button>
              <button
                type="button"
                className="secondary small"
                aria-label="Analizar y extraer elementos de las notas"
                disabled={isExtracting || !noteText.trim()}
                onClick={() => handleExtract("replace")}
                data-testid="extract-replace-button"
              >
                🔄 Reemplazar lista actual
              </button>
            </div>
          </div>

          {/* User Intent Input */}
          <div style={{ marginTop: "16px" }}>
            <label
              htmlFor="weekly-intent-input"
              style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, marginBottom: "4px" }}
            >
              Intención o foco prioritario para la semana (opcional):
            </label>
            <input
              id="weekly-intent-input"
              type="text"
              value={userIntent}
              onChange={(e) => setUserIntent(e.target.value)}
              placeholder="Ej: Foco en cerrar entregables críticos y reservar espacio para imprevistos"
              style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
              disabled={isPlanning}
            />
          </div>

          {/* Capacity & Protected Space Configuration (Optional, for verifying viability) */}
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
            }}
            data-testid="planning-capacity-pre-config"
          >
            <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "4px", color: "#374151" }}>
              Límites de capacidad y espacio protegido (opcional)
            </div>
            <p className="calm-muted" style={{ fontSize: "0.82rem", margin: "0 0 10px 0" }}>
              Registra cuántas horas tienes disponibles y cuánto margen quieres proteger para comprobar la viabilidad real.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ flex: "1 1 200px" }}>
                <label
                  htmlFor="planning-available-hours-input"
                  style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px", color: "#4b5563" }}
                >
                  Horas realmente disponibles:
                </label>
                <input
                  id="planning-available-hours-input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={availableHoursInput}
                  onChange={(e) => setAvailableHoursInput(e.target.value)}
                  placeholder="Ej: 30 (deja vacío si es desconocida)"
                  style={{ width: "100%", padding: "6px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
                  disabled={isPlanning}
                  data-testid="planning-available-hours-input"
                />
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <label
                  htmlFor="planning-protected-space-ratio-input"
                  style={{ display: "block", fontSize: "0.82rem", fontWeight: 500, marginBottom: "4px", color: "#4b5563" }}
                >
                  Espacio a proteger (% margen):
                </label>
                <input
                  id="planning-protected-space-ratio-input"
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={protectedSpacePercentInput}
                  onChange={(e) => setProtectedSpacePercentInput(e.target.value)}
                  placeholder="25"
                  style={{ width: "100%", padding: "6px 10px", fontSize: "0.88rem", boxSizing: "border-box" }}
                  disabled={isPlanning}
                  data-testid="planning-protected-space-input"
                />
              </div>
            </div>
          </div>

          {planningError && (
            <div
              className="status-message status-error"
              style={{ marginTop: "12px" }}
              role="alert"
            >
              <strong>Error de planificación:</strong> {planningError}
            </div>
          )}

          <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
            <button
              className="primary"
              aria-label="Generar propuesta semanal con los elementos aceptados"
              disabled={isPlanning || (acceptedCount === 0 && selectedCarryOverItemIds.size === 0)}
              onClick={handleGenerateProposal}
            >
              {isPlanning
                ? "Estructurando propuesta semanal..."
                : selectedCarryOverItemIds.size > 0
                ? `Generar propuesta semanal (${acceptedCount} notas + ${selectedCarryOverItemIds.size} postergadas)`
                : `Generar propuesta semanal (${acceptedCount} elementos)`}
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 3. Review Generated Weekly Proposal (AI Proposes, Person Decides) */}
      {/* -------------------------------------------------------------------- */}
      {proposedWeek && !isReviewingSelection && (
        <div
          style={{
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-color, #e0e0e0)",
          }}
          aria-label="Revisión de propuesta semanal"
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
              <div className="calm-muted" style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                Propuesta semanal
              </div>
              <h2 style={{ margin: "2px 0 0 0" }}>
                {proposedWeek.weekSummary.intent ? `«${proposedWeek.weekSummary.intent}»` : "Plan de la semana"}
              </h2>
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <span className="badge badge-task">
                {proposedWeek.weekSummary.targetWeek.startDate} al{" "}
                {proposedWeek.weekSummary.targetWeek.endDate}
              </span>
              <span className="badge badge-idea" data-testid="draft-notebook-status-badge">
                📒 Borrador en cuaderno local
              </span>
            </div>
          </div>

          {/* Capacity, Protected Space & Viability Overview */}
          <div
            className="calm-box"
            style={{
              marginTop: "16px",
              background: "#fafafa",
              borderColor: "#e0e0e0",
              padding: "16px",
            }}
            data-testid="planning-capacity-section"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h5 style={{ margin: 0, fontSize: "1rem" }}>
                  Balance de tu semana
                </h5>
                <span
                  className={`badge ${
                    proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                      ? "badge-success"
                      : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                      ? "badge-error"
                      : "badge-warning"
                  }`}
                  data-testid="planning-capacity-status-summary-badge"
                >
                  {proposedWeek.weekSummary.capacity.totalAvailableHours == null
                    ? "Capacidad no configurada"
                    : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                    ? "Por encima de la capacidad"
                    : proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                    ? "Dentro de la capacidad"
                    : "Estimación parcial"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "6px",
                  fontSize: "0.82rem",
                }}
              >
                <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
                  <span className="calm-muted">Disponibles:</span>{" "}
                  <strong>{formatHours(proposedWeek.weekSummary.capacity.totalAvailableHours, "No disponible")}</strong>
                </span>
                <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
                  <span className="calm-muted">Planificadas:</span>{" "}
                  <strong>
                    {proposedWeek.weekSummary.capacity.plannedHours != null
                      ? formatHours(proposedWeek.weekSummary.capacity.plannedHours)
                      : formatHours(proposedWeek.weekSummary.capacity.knownEstimatedHours, "Sin estimar")}
                  </strong>
                </span>
                <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
                  <span className="calm-muted">Planificables:</span>{" "}
                  <strong>{formatHours(proposedWeek.weekSummary.capacity.plannableHours, "Desconocido")}</strong>
                </span>
                <span style={{ background: "#f3f0ea", padding: "2px 6px", borderRadius: "4px" }}>
                  <span className="calm-muted">Protegidas:</span>{" "}
                  <strong>{formatHours(proposedWeek.weekSummary.capacity.protectedSpaceHours, "Desconocido")}</strong>
                </span>
              </div>
            </div>

            {/* Tu tiempo de un vistazo (visual bar) */}
            {proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
              proposedWeek.weekSummary.capacity.totalAvailableHours > 0 && (() => {
                const effectivePlanned =
                  proposedWeek.weekSummary.capacity.plannedHours ??
                  proposedWeek.weekSummary.capacity.knownEstimatedHours;
                return (
                  <div className="cognitive-budget-card" style={{ margin: "4px 0 10px", padding: "10px 14px" }}>
                    <div className="cognitive-budget-header">
                      <span className="cognitive-budget-title">Tu tiempo de un vistazo</span>
                      <span className="cognitive-budget-ratio">
                        {proposedWeek.weekSummary.capacity.plannedHours != null
                          ? `${proposedWeek.weekSummary.capacity.plannedHours}h asignadas`
                          : effectivePlanned != null && effectivePlanned > 0
                          ? `~${effectivePlanned}h asignadas (parcial)`
                          : "Tareas sin estimar en horas"}{" "}
                        / {proposedWeek.weekSummary.capacity.totalAvailableHours}h disponibles
                      </span>
                    </div>
                    <div className="cognitive-bar-track">
                      {effectivePlanned != null && effectivePlanned > 0 && (
                        <div
                          className="cognitive-bar-fill"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (effectivePlanned /
                                  proposedWeek.weekSummary.capacity.totalAvailableHours) *
                                  100
                              )
                            )}%`,
                          }}
                          title={`Planificadas: ${effectivePlanned}h`}
                        />
                      )}
                      {proposedWeek.weekSummary.capacity.protectedSpaceHours != null &&
                        proposedWeek.weekSummary.capacity.protectedSpaceHours > 0 && (
                          <div
                            className="cognitive-bar-fill protected"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.round(
                                  (proposedWeek.weekSummary.capacity.protectedSpaceHours /
                                    proposedWeek.weekSummary.capacity.totalAvailableHours) *
                                    100
                                )
                              )}%`,
                            }}
                            title={`Espacio protegido: ${proposedWeek.weekSummary.capacity.protectedSpaceHours}h`}
                          />
                        )}
                    </div>
                  </div>
                );
              })()}

            {/* Desglose progresivo tipo desplegable (como en la semana activa) */}
            <details className="calm-details" style={{ marginTop: "4px" }} data-testid="planning-capacity-details">
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "0.82rem",
                  color: "var(--accent-color, #2b6cb0)",
                  userSelect: "none",
                }}
              >
                Ver desglose completo de cálculos y viabilidad
              </summary>
              <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Separación visual nítida en dos paneles independientes */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: "16px",
                  }}
                >
              {/* Panel 1: Límites de tiempo y disponibilidad */}
              <div
                className="item-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  margin: 0,
                  padding: "14px",
                  background: "#ffffff",
                  border: "1px solid #e5e5e5",
                  borderRadius: "6px",
                }}
                data-testid="planning-time-boundaries-card"
              >
                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#374151" }}>
                  Límites de tiempo y disponibilidad
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                    <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                      Tiempo disponible real:
                    </span>
                    <strong data-testid="planning-available-hours">
                      {formatHours(
                        proposedWeek.weekSummary.capacity.totalAvailableHours,
                        "No registrado"
                      )}
                    </strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                    <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                      Capacidad planificable:
                    </span>
                    <strong data-testid="planning-plannable-hours">
                      {formatHours(proposedWeek.weekSummary.capacity.plannableHours, "Desconocido")}
                    </strong>
                  </div>
                  {proposedWeek.weekSummary.capacity.plannableHours != null &&
                    (proposedWeek.weekSummary.capacity.plannedHours != null ||
                      proposedWeek.weekSummary.capacity.knownEstimatedHours != null) && (
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                          Capacidad planificable restante:
                        </span>
                        <strong data-testid="planning-remaining-plannable-hours">
                          {formatHours(
                            Math.max(
                              0,
                              proposedWeek.weekSummary.capacity.plannableHours -
                                (proposedWeek.weekSummary.capacity.plannedHours ??
                                  proposedWeek.weekSummary.capacity.knownEstimatedHours!)
                            )
                          )}
                        </strong>
                      </div>
                    )}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                    <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                      Espacio protegido:
                    </span>
                    <strong data-testid="planning-protected-space-hours">
                      {formatHours(
                        proposedWeek.weekSummary.capacity.protectedSpaceHours,
                        "Desconocido"
                      )}
                    </strong>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "4px",
                      paddingTop: "6px",
                      borderTop: "1px solid #f0f0f0",
                    }}
                  >
                    <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
                      Margen protegido:
                    </span>
                    <span className="badge badge-idea" data-testid="planning-protected-space-badge">
                      {formatProtectedSpaceStatus(
                        proposedWeek.weekSummary.capacity.protectedSpaceStatus
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Panel 2: Carga planificada y viabilidad */}
              <div
                className="item-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  margin: 0,
                  padding: "14px",
                  background: "#ffffff",
                  border: "1px solid #e5e5e5",
                  borderRadius: "6px",
                }}
                data-testid="planning-workload-viability-card"
              >
                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#374151" }}>
                  Carga planificada y viabilidad
                </div>
                {(() => {
                  const hasZeroCommitted =
                    proposedWeek.foci.length === 0 && proposedWeek.obligations.length === 0;
                  const flexibleHours = proposedWeek.flexibleOptions.reduce(
                    (acc, o) => acc + (o.estimatedHours ?? 0),
                    0
                  );

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                          Horas planificadas:
                        </span>
                        <strong data-testid="planning-planned-hours">
                          {hasZeroCommitted && flexibleHours > 0
                            ? `0h fijas (~${flexibleHours}h flexibles)`
                            : formatHours(
                                proposedWeek.weekSummary.capacity.plannedHours,
                                proposedWeek.weekSummary.capacity.knownEstimatedHours !== null
                                  ? `~${proposedWeek.weekSummary.capacity.knownEstimatedHours}h parcial`
                                  : "Sin estimar"
                              )}
                        </strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                        <span className="calm-muted" style={{ fontSize: "0.85rem" }}>
                          Completitud de estimaciones:
                        </span>
                        <span className="badge badge-muted" data-testid="planning-estimation-badge">
                          {hasZeroCommitted && flexibleHours > 0
                            ? `Opciones flexibles (${proposedWeek.flexibleOptions.length})`
                            : formatEstimationCompleteness(
                                proposedWeek.weekSummary.capacity.estimationCompleteness
                              )}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: "4px",
                          paddingTop: "6px",
                          borderTop: "1px solid #f0f0f0",
                        }}
                      >
                        <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
                          Estado de viabilidad:
                        </span>
                        <span
                          className={`badge ${
                            proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity" ||
                            (hasZeroCommitted &&
                              proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                              flexibleHours <=
                                (proposedWeek.weekSummary.capacity.plannableHours ?? 0))
                              ? "badge-success"
                              : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                              ? "badge-error"
                              : proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                                proposedWeek.weekSummary.capacity.estimationCompleteness !== "complete"
                              ? "badge-warning"
                              : "badge-task"
                          }`}
                          data-testid="planning-capacity-status-badge"
                        >
                          {proposedWeek.weekSummary.capacity.totalAvailableHours == null
                            ? "Capacidad desconocida · Viabilidad no verificada"
                            : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity"
                            ? "Por encima de la capacidad"
                            : hasZeroCommitted && flexibleHours > 0
                            ? `Capacidad disponible (${flexibleHours}h flexibles)`
                            : proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                            ? "Dentro de la capacidad"
                            : proposedWeek.weekSummary.capacity.estimationCompleteness !== "complete"
                            ? "Estimaciones incompletas · Viabilidad no confirmada"
                            : formatCapacityStatus(proposedWeek.weekSummary.capacity.capacityStatus)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Panel de registro y calibración de capacidad */}
            {(() => {
              const isCapacityConfigured =
                proposedWeek.weekSummary.capacity.totalAvailableHours != null;

              return (
                <div
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "6px",
                    padding: "12px 14px",
                    marginTop: "8px",
                  }}
                  data-testid="capacity-calibration-box"
                >
                  {isCapacityConfigured && !isEditingCapacity ? (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                      }}
                      data-testid="capacity-validated-summary"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <strong style={{ fontSize: "0.88rem", color: "#1f2937" }}>
                          ✓ Capacidad configurada y validada ({proposedWeek.weekSummary.capacity.totalAvailableHours}h disponibles)
                        </strong>
                        {proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity" ||
                        (proposedWeek.foci.length === 0 &&
                          proposedWeek.obligations.length === 0 &&
                          proposedWeek.weekSummary.capacity.totalAvailableHours != null &&
                          proposedWeek.flexibleOptions.reduce((acc, o) => acc + (o.estimatedHours ?? 0), 0) <=
                            (proposedWeek.weekSummary.capacity.plannableHours ?? 0)) ? (
                          <span
                            className="badge badge-success"
                            data-testid="viability-confirmed-badge"
                          >
                            ✓ Viabilidad confirmada
                          </span>
                        ) : proposedWeek.weekSummary.capacity.capacityStatus === "over_capacity" ? (
                          <span
                            className="badge badge-error"
                            data-testid="over-capacity-badge"
                          >
                            ⚠️ Sobrecarga detectada ({formatHours(proposedWeek.weekSummary.capacity.knownEstimatedHours)} estimadas)
                          </span>
                        ) : (
                          <span
                            className="badge badge-warning"
                            data-testid="incomplete-estimations-badge"
                          >
                            ℹ️ Viabilidad no confirmada: estimaciones incompletas
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={handleStartEditCapacity}
                        data-testid="modify-capacity-button"
                      >
                        Modificar capacidad
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          flexWrap: "wrap",
                          gap: "8px",
                          marginBottom: "8px",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: "0.9rem", color: "#1f2937" }}>
                            {isCapacityConfigured
                              ? "Modificar límites de capacidad y espacio protegido"
                              : "Registrar o calibrar capacidad para verificar viabilidad"}
                          </strong>
                          <span className="calm-muted" style={{ fontSize: "0.8rem", display: "block" }}>
                            {isCapacityConfigured
                              ? "Ajusta las horas disponibles o el margen para recalcular la viabilidad"
                              : "Ingresa tus horas reales para evaluar si la semana es viable"}
                          </span>
                        </div>
                        {isCapacityConfigured && (
                          <button
                            type="button"
                            className="secondary small"
                            onClick={handleCancelEditCapacity}
                            data-testid="cancel-modify-capacity-button"
                            aria-label="Volver sin cambios"
                          >
                            Volver sin cambios
                          </button>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "12px",
                          alignItems: "flex-end",
                        }}
                      >
                        <div style={{ flex: "1 1 180px" }}>
                          <label
                            htmlFor="proposal-available-hours"
                            style={{
                              display: "block",
                              fontSize: "0.82rem",
                              fontWeight: 500,
                              marginBottom: "4px",
                              color: "#4b5563",
                            }}
                          >
                            Horas realmente disponibles:
                          </label>
                          <input
                            id="proposal-available-hours"
                            type="number"
                            min="0"
                            step="0.5"
                            value={availableHoursInput}
                            onChange={(e) => setAvailableHoursInput(e.target.value)}
                            placeholder="Ej: 20"
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              fontSize: "0.88rem",
                              boxSizing: "border-box",
                            }}
                            data-testid="available-hours-proposal-input"
                          />
                        </div>
                        <div style={{ flex: "1 1 180px" }}>
                          <label
                            htmlFor="proposal-protected-space-ratio"
                            style={{
                              display: "block",
                              fontSize: "0.82rem",
                              fontWeight: 500,
                              marginBottom: "4px",
                              color: "#4b5563",
                            }}
                          >
                            Espacio a proteger (% margen):
                          </label>
                          <input
                            id="proposal-protected-space-ratio"
                            type="number"
                            min="0"
                            max="100"
                            step="5"
                            value={protectedSpacePercentInput}
                            onChange={(e) => setProtectedSpacePercentInput(e.target.value)}
                            placeholder="25"
                            style={{
                              width: "100%",
                              padding: "6px 10px",
                              fontSize: "0.88rem",
                              boxSizing: "border-box",
                            }}
                            data-testid="protected-space-proposal-input"
                          />
                        </div>
                        <button
                          type="button"
                          className="primary small"
                          onClick={() => {
                            handleVerifyCapacity();
                            setIsEditingCapacity(false);
                          }}
                          style={{ height: "36px", whiteSpace: "nowrap" }}
                          data-testid="verify-viability-button"
                        >
                          {isCapacityConfigured ? "Guardar y recalcular" : "Verificar viabilidad"}
                        </button>
                      </div>
                    </>
                  )}

                  {capacityFeedbackMessage && (
                    <div
                      className="status-message"
                      style={{
                        marginTop: "10px",
                        padding: "8px 12px",
                        fontSize: "0.85rem",
                        background:
                          proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                            ? "#ecfdf5"
                            : "#fff7ed",
                        border:
                          proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                            ? "1px solid #a7f3d0"
                            : "1px solid #ffedd5",
                        color:
                          proposedWeek.weekSummary.capacity.capacityStatus === "within_capacity"
                            ? "#065f46"
                            : "#9a3412",
                        borderRadius: "4px",
                      }}
                      data-testid="capacity-feedback-message"
                    >
                      {capacityFeedbackMessage}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Aviso de viabilidad no verificada cuando capacidad es desconocida y hay tareas de recuperación */}
            {proposedWeek.foci.some((f) => f.id.startsWith("focus-recovery-")) &&
              proposedWeek.weekSummary.capacity.capacityStatus === "unknown" && (
                <div
                  className="status-message status-warning"
                  style={{
                    marginTop: "12px",
                    background: "#fffbeb",
                    border: "1px solid #fef3c7",
                    borderRadius: "6px",
                    padding: "10px 14px",
                    color: "#92400e",
                    fontSize: "0.85rem",
                  }}
                  data-testid="unverified-capacity-warning"
                  role="status"
                >
                  ⚠️ <strong>Viabilidad no verificada:</strong> Se programó una tarea de recuperación (
                  {proposedWeek.foci
                    .filter((f) => f.id.startsWith("focus-recovery-"))
                    .reduce((acc, f) => acc + (f.estimatedHours ?? 0), 0)}h) con capacidad disponible desconocida. No se inventa capacidad disponible; la viabilidad no está confirmada hasta registrar tus horas reales disponibles.
                </div>
              )}
              </div>
            </details>
          </div>

          {/* Weekly Foci */}
          {proposedWeek.foci.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "4px" }}>
                <h4 style={{ margin: 0, display: "flex", alignItems: "center", gap: "8px", fontSize: "1.25rem" }}>
                  <span>🔖</span> Tus {proposedWeek.foci.length} Focos de Atención
                </h4>
                <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                  donde reside mi mente
                </span>
              </div>
              <span className="calm-muted" style={{ fontSize: "0.82rem", display: "block", marginBottom: "14px" }}>
                Focos principales ({proposedWeek.foci.length})
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                {proposedWeek.foci.map((focus, idx) => {
                  const isRecoveryFocus = focus.id.startsWith("focus-recovery-");
                  const focusItem = isRecoveryFocus
                    ? extractedItems?.find((i) => focus.contributingItemIds.includes(i.id))
                    : undefined;
                  const originalDueDate = focusItem?.deadline?.resolved;
                  const romanNumerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
                  const romanLabel = romanNumerals[idx] || String(idx + 1);

                  return (
                    <div
                      key={focus.id}
                      className="item-card"
                      style={{
                        padding: "18px 20px",
                        background: isRecoveryFocus ? "#fffdf5" : "var(--surface-color, #ffffff)",
                        borderColor: isRecoveryFocus ? "#fef08a" : "var(--border-color, #e6ded1)",
                      }}
                      data-testid={`proposed-focus-${focus.id}`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "6px" }}>
                        <span className="badge" style={{ background: "#edf3ee", color: "#2d4233", border: "1px solid #c8d9cc", fontWeight: 600 }}>
                          FOCO {romanLabel}{focus.estimatedHours !== null ? ` · ${focus.estimatedHours}H` : ""}
                        </span>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          {isRecoveryFocus && (
                            <span className="badge badge-warning" data-testid="recovery-focus-badge">
                              Prioridad de recuperación
                            </span>
                          )}
                          {focus.estimatedHours !== null && (
                            <span className="badge badge-muted">{focus.estimatedHours}h</span>
                          )}
                        </div>
                      </div>

                      <h4 style={{ margin: "2px 0 8px", fontSize: "1.2rem", lineHeight: 1.35 }}>
                        {focus.title}
                      </h4>

                      {isRecoveryFocus && originalDueDate && (
                        <div
                          className="calm-muted"
                          style={{ fontSize: "0.8rem", marginTop: "2px", color: "#b45309" }}
                          data-testid={`focus-original-deadline-${focus.id}`}
                        >
                          📅 Fecha límite original: <strong>{originalDueDate}</strong> (vencida antes del inicio de la semana)
                        </div>
                      )}

                      <div className="inner-note-box">
                        <div className="inner-note-label">
                          <span>✏️</span> PASO INMEDIATO:
                        </div>
                        <div style={{ fontSize: "0.95rem" }}>
                          <strong>Resultado deseado:</strong> {focus.desiredOutcome}
                        </div>
                      </div>

                      <div className="calm-muted" style={{ fontSize: "0.82rem", marginTop: "10px", fontStyle: "italic" }}>
                        <em>Fundamentación:</em> {focus.rationale}
                      </div>

                      {/* Actions on Focus */}
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => handleDemoteFocusToFlexible(focus.id)}
                          data-testid={`demote-focus-to-flexible-${focus.id}`}
                        >
                          ↩ Mover a opción flexible
                        </button>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => {
                            setEditingProposalItemId(focus.id);
                            setProposalItemHoursInput(focus.estimatedHours !== null ? String(focus.estimatedHours) : "");
                          }}
                          data-testid={`adjust-focus-hours-${focus.id}`}
                        >
                          ⏱️ Ajustar horas
                        </button>
                      </div>

                      {/* Inline Hours Editor */}
                      {editingProposalItemId === focus.id && (
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                            marginTop: "10px",
                            background: "#f0f4f8",
                            padding: "8px 12px",
                            borderRadius: "4px",
                            flexWrap: "wrap",
                          }}
                        >
                          <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                            Horas estimadas:
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={proposalItemHoursInput}
                            onChange={(e) => setProposalItemHoursInput(e.target.value)}
                            placeholder="Ej: 4"
                            style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                            data-testid={`input-hours-${focus.id}`}
                          />
                          <button
                            type="button"
                            className="primary small"
                            onClick={() => {
                              const val = proposalItemHoursInput.trim() !== "" ? Number(proposalItemHoursInput) : null;
                              handleSaveProposalItemHours(focus.id, val);
                            }}
                            data-testid={`save-hours-${focus.id}`}
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() => {
                              setEditingProposalItemId(null);
                              setProposalItemHoursInput("");
                            }}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Weekly Obligations */}
          {proposedWeek.obligations.length > 0 && (
            <div style={{ marginTop: "16px" }}>
              <h5 style={{ margin: "0 0 8px 0" }}>
                Obligaciones y compromisos ({proposedWeek.obligations.length})
              </h5>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {proposedWeek.obligations.map((ob) => (
                  <div
                    key={ob.itemId}
                    className="item-card"
                    style={{ padding: "8px 12px", background: "#fbfbfb" }}
                    data-testid={`proposed-obligation-${ob.itemId}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <strong>{ob.title}</strong>
                      <span className="badge badge-commitment">{ob.commitmentType}</span>
                    </div>
                    {ob.dueDate && (
                      <div className="calm-text" style={{ fontSize: "0.85rem", marginTop: "2px" }}>
                        📅 Fecha límite: {ob.dueDate}
                      </div>
                    )}
                    {ob.estimatedHours !== null && (
                      <div className="calm-muted" style={{ fontSize: "0.8rem" }}>
                        Estimado: {ob.estimatedHours}h
                      </div>
                    )}

                    {/* Actions on Obligation */}
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => {
                          setEditingProposalItemId(ob.itemId);
                          setProposalItemHoursInput(ob.estimatedHours !== null ? String(ob.estimatedHours) : "");
                        }}
                        data-testid={`adjust-obligation-hours-${ob.itemId}`}
                      >
                        ⏱️ Ajustar horas
                      </button>
                    </div>

                    {/* Inline Hours Editor */}
                    {editingProposalItemId === ob.itemId && (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                          marginTop: "8px",
                          background: "#f0f4f8",
                          padding: "8px 12px",
                          borderRadius: "4px",
                          flexWrap: "wrap",
                        }}
                      >
                        <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                          Horas estimadas:
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={proposalItemHoursInput}
                          onChange={(e) => setProposalItemHoursInput(e.target.value)}
                          placeholder="Ej: 2"
                          style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                          data-testid={`input-hours-${ob.itemId}`}
                        />
                        <button
                          type="button"
                          className="primary small"
                          onClick={() => {
                            const val = proposalItemHoursInput.trim() !== "" ? Number(proposalItemHoursInput) : null;
                            handleSaveProposalItemHours(ob.itemId, val);
                          }}
                          data-testid={`save-hours-${ob.itemId}`}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => {
                            setEditingProposalItemId(null);
                            setProposalItemHoursInput("");
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Weekly Flexible Options */}
          {proposedWeek.flexibleOptions.length > 0 && (
            <div style={{ marginTop: "16px" }} data-testid="proposed-flexible-options-section">
              <h5 style={{ margin: "0 0 8px 0" }}>
                Opciones flexibles ({proposedWeek.flexibleOptions.length})
              </h5>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {proposedWeek.flexibleOptions.map((opt) => (
                  <div
                    key={opt.itemId}
                    className="item-card"
                    style={{ padding: "8px 12px", background: "#fbfbfb" }}
                    data-testid={`proposed-flexible-item-${opt.itemId}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
                      <strong>{opt.title}</strong>
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <span className="badge badge-idea">Flexible</span>
                        {opt.estimatedHours !== null && (
                          <span className="badge badge-muted">{opt.estimatedHours}h</span>
                        )}
                      </div>
                    </div>
                    {opt.condition && (
                      <div className="calm-muted" style={{ fontSize: "0.8rem", marginTop: "2px" }}>
                        <em>Condición:</em> {opt.condition}
                      </div>
                    )}

                    {/* Actions on Flexible Option */}
                    <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => handlePromoteFlexibleToFocus(opt.itemId)}
                        data-testid={`promote-flexible-to-focus-${opt.itemId}`}
                        disabled={proposedWeek.foci.length >= 3}
                        title={proposedWeek.foci.length >= 3 ? "Límite máximo de 3 focos alcanzado" : "Elegir como foco principal de la semana"}
                      >
                        ⭐ Elegir como foco
                      </button>
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => {
                          setEditingProposalItemId(opt.itemId);
                          setProposalItemHoursInput(opt.estimatedHours !== null ? String(opt.estimatedHours) : "");
                        }}
                        data-testid={`adjust-flexible-hours-${opt.itemId}`}
                      >
                        ⏱️ Ajustar horas
                      </button>
                    </div>

                    {/* Inline Hours Editor */}
                    {editingProposalItemId === opt.itemId && (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          alignItems: "center",
                          marginTop: "8px",
                          background: "#f0f4f8",
                          padding: "8px 12px",
                          borderRadius: "4px",
                          flexWrap: "wrap",
                        }}
                      >
                        <label style={{ fontSize: "0.82rem", fontWeight: 500, color: "#374151" }}>
                          Horas estimadas:
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={proposalItemHoursInput}
                          onChange={(e) => setProposalItemHoursInput(e.target.value)}
                          placeholder="Ej: 2"
                          style={{ width: "80px", padding: "4px 8px", fontSize: "0.85rem" }}
                          data-testid={`input-hours-${opt.itemId}`}
                        />
                        <button
                          type="button"
                          className="primary small"
                          onClick={() => {
                            const val = proposalItemHoursInput.trim() !== "" ? Number(proposalItemHoursInput) : null;
                            handleSaveProposalItemHours(opt.itemId, val);
                          }}
                          data-testid={`save-hours-${opt.itemId}`}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => {
                            setEditingProposalItemId(null);
                            setProposalItemHoursInput("");
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Deferred / Unscheduled Items */}
          {proposedWeek.deferredItems.length > 0 && (
            <div
              className="permiso-no-hacer-box"
              style={{ marginTop: "24px" }}
              data-testid="proposed-deferred-items-section"
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
                <h4 style={{ margin: 0, fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>☕</span> Elementos no programados o diferidos ({proposedWeek.deferredItems.length})
                </h4>
                <span className="calm-muted" style={{ fontSize: "0.82rem" }}>
                  Dejar tareas fuera te permite enfocarte en lo prioritario
                </span>
              </div>

              {/* 1. Pendientes de decisión / Fuera de propuesta */}
              {(() => {
                const pendingItems = proposedWeek.deferredItems.filter(
                  (d) => d.reason !== "intentional_postponement"
                );
                if (pendingItems.length === 0) return null;
                return (
                  <div style={{ marginBottom: "12px" }} data-testid="pending-decision-items-group">
                    <span
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "#4b5563",
                        display: "block",
                        marginBottom: "6px",
                      }}
                    >
                      Pendientes de decisión ({pendingItems.length}):
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {pendingItems.map((def) => {
                        const sourceItem = extractedItems?.find((i) => i.id === def.itemId);
                        const originalDueDate = sourceItem?.deadline?.resolved;
                        const isOverdue =
                          originalDueDate &&
                          originalDueDate < proposedWeek.weekSummary.targetWeek.startDate;

                        return (
                          <div
                            key={def.itemId}
                            className="item-card"
                            style={{
                              padding: "10px 14px",
                              background: "#fffdf9",
                              borderColor: "#f0e6d6",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                            data-testid={`proposed-deferred-item-${def.itemId}`}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "baseline",
                                flexWrap: "wrap",
                                gap: "6px",
                              }}
                            >
                              <strong>{def.title}</strong>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                <span
                                  className={`badge ${formatUnscheduledCategory(def.reason, deferredDecisions[def.itemId]).badgeClass}`}
                                  data-testid={`unscheduled-category-badge-${def.itemId}`}
                                >
                                  {formatUnscheduledCategory(def.reason, deferredDecisions[def.itemId]).label}
                                </span>
                                <span className="badge badge-muted">
                                  {formatDeferredReason(def.reason)}
                                </span>
                              </div>
                            </div>
                            <div
                              className="calm-muted"
                              style={{ fontSize: "0.82rem" }}
                              data-testid={`proposed-deferred-rationale-${def.itemId}`}
                            >
                              {def.rationale}
                            </div>
                            {isOverdue && (
                              <div
                                className="calm-muted"
                                style={{ fontSize: "0.8rem", color: "#b45309" }}
                                data-testid={`deferred-original-deadline-${def.itemId}`}
                              >
                                📅 Fecha límite original: <strong>{originalDueDate}</strong> (vencida antes de la semana)
                              </div>
                            )}
                            <div
                              style={{
                                display: "flex",
                                gap: "8px",
                                marginTop: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleDeferredDecisionChange(def.itemId, "postpone")}
                                data-testid={`defer-item-postpone-button-${def.itemId}`}
                              >
                                Posponer
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleDeferredDecisionChange(def.itemId, "include_flexible")}
                                data-testid={`defer-item-include-button-${def.itemId}`}
                              >
                                Incluir en la semana
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleDeferredDecisionChange(def.itemId, "reconsider_unscheduled")}
                                data-testid={`defer-item-review-button-${def.itemId}`}
                              >
                                Dejar fuera
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 2. Postergados conscientemente para después */}
              {(() => {
                const postponedItems = proposedWeek.deferredItems.filter(
                  (d) => d.reason === "intentional_postponement"
                );
                if (postponedItems.length === 0) return null;
                return (
                  <div style={{ marginBottom: "12px" }} data-testid="postponed-items-group">
                    <span
                      style={{
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        color: "#6b7280",
                        display: "block",
                        marginBottom: "6px",
                      }}
                    >
                      Postergados conscientemente ({postponedItems.length}):
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {postponedItems.map((def) => {
                        const sourceItem = extractedItems?.find((i) => i.id === def.itemId);
                        const originalDueDate = sourceItem?.deadline?.resolved;

                        return (
                          <div
                            key={def.itemId}
                            className="item-card"
                            style={{
                              padding: "10px 14px",
                              background: "#f8fafc",
                              borderColor: "#e2e8f0",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                            data-testid={`proposed-deferred-item-${def.itemId}`}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "baseline",
                                flexWrap: "wrap",
                                gap: "6px",
                              }}
                            >
                              <strong>{def.title}</strong>
                              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                                <span
                                  className="badge badge-idea"
                                  data-testid={`postponed-category-badge-${def.itemId}`}
                                >
                                  {formatDeferredReason(def.reason)}
                                </span>
                              </div>
                            </div>
                            <div
                              className="calm-muted"
                              style={{ fontSize: "0.82rem" }}
                              data-testid={`proposed-deferred-rationale-${def.itemId}`}
                            >
                              {def.rationale}
                            </div>
                            {originalDueDate && (
                              <div
                                className="calm-muted"
                                style={{ fontSize: "0.8rem", color: "#64748b" }}
                                data-testid={`deferred-original-deadline-${def.itemId}`}
                              >
                                📅 Fecha límite original conservada: <strong>{originalDueDate}</strong>
                              </div>
                            )}
                            <div
                              style={{
                                display: "flex",
                                gap: "8px",
                                marginTop: "6px",
                                flexWrap: "wrap",
                              }}
                            >
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleDeferredDecisionChange(def.itemId, "reconsider_unscheduled")}
                                data-testid={`defer-item-unschedule-button-${def.itemId}`}
                              >
                                Volver a evaluar
                              </button>
                              <button
                                type="button"
                                className="secondary small"
                                onClick={() => handleDeferredDecisionChange(def.itemId, "include_flexible")}
                                data-testid={`defer-item-include-button-${def.itemId}`}
                              >
                                Incluir en la semana
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Decisiones sobre tareas con fecha límite vencida (Requirement 3 & 4) */}
          {(() => {
            const overdueList = (extractedItems || []).filter((item) => {
              const dl = item.deadline?.resolved;
              return Boolean(dl && dl < proposedWeek.weekSummary.targetWeek.startDate);
            });
            if (overdueList.length === 0) return null;

            return (
              <div style={{ marginTop: "16px" }} data-testid="overdue-items-decision-section">
                <h5 style={{ margin: "0 0 8px 0" }}>Decisiones sobre tareas con fecha límite vencida</h5>
                {overdueList.map((item) => {
                  const originalDueDate = item.deadline?.resolved;
                  const isRecovery =
                    proposedWeek.foci.some((f) => f.contributingItemIds.includes(item.id)) ||
                    proposedWeek.flexibleOptions.some((o) => o.itemId === item.id);
                  const deferredEntry = proposedWeek.deferredItems.find(
                    (d) => d.itemId === item.id
                  );
                  const isPostponed = deferredEntry?.reason === "intentional_postponement";
                  const isUnscheduled = !isRecovery && !isPostponed;

                  return (
                    <div
                      key={item.id}
                      className="calm-box"
                      style={{
                        marginTop: "8px",
                        background: "#fffdf0",
                        borderColor: "#f59e0b",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        borderRadius: "6px",
                        padding: "12px 16px",
                      }}
                      data-testid={`overdue-item-decision-card-${item.id}`}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          flexWrap: "wrap",
                          gap: "6px",
                        }}
                      >
                        <strong>⚠️ {item.title}</strong>
                        <span
                          className="badge badge-warning"
                          data-testid={`original-deadline-badge-${item.id}`}
                        >
                          Fecha límite original: {originalDueDate} (vencida)
                        </span>
                      </div>
                      <p
                        className="calm-text"
                        style={{ fontSize: "0.85rem", margin: "6px 0", color: "#78350f" }}
                      >
                        Esta tarea ({item.estimatedEffort?.value ?? 6}h) tenía fecha límite el{" "}
                        <strong>{originalDueDate}</strong>, anterior a la semana objetivo (
                        {proposedWeek.weekSummary.targetWeek.startDate} a{" "}
                        {proposedWeek.weekSummary.targetWeek.endDate}). La fecha límite original{" "}
                        <strong>no se altera silenciosamente</strong> ni se presenta falsamente como futura.
                      </p>
                      <div style={{ marginTop: "12px" }}>
                        <span
                          id={`overdue-decision-label-${item.id}`}
                          style={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            display: "block",
                            marginBottom: "8px",
                          }}
                        >
                          Decisión sobre esta tarea vencida:
                        </span>
                        <div
                          role="group"
                          aria-labelledby={`overdue-decision-label-${item.id}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                            gap: "10px",
                          }}
                        >
                          {/* Opción 1: Mantener sin programar */}
                          <button
                            type="button"
                            aria-pressed={isUnscheduled}
                            className={isUnscheduled ? "primary small" : "secondary small"}
                            data-testid={`decision-unscheduled-${item.id}`}
                            onClick={() => handleApplyOverdueDecision(item.id, "keep_unscheduled")}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              textAlign: "left",
                              padding: "10px 12px",
                              borderRadius: "6px",
                              cursor: "pointer",
                              background: isUnscheduled ? "#eff6ff" : "#ffffff",
                              borderColor: isUnscheduled ? "#2563eb" : "#d1d5db",
                              borderWidth: isUnscheduled ? "2px" : "1px",
                              borderStyle: "solid",
                              color: isUnscheduled ? "#1d4ed8" : "inherit",
                              boxShadow: isUnscheduled ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                              width: "100%",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.85rem" }}>
                                {isUnscheduled ? "✓ Mantener sin programar" : "Mantener sin programar"}
                              </strong>
                              {isUnscheduled && (
                                <span className="badge badge-primary" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                                  Seleccionada
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.78rem", color: "#4b5563", marginTop: "4px", fontWeight: "normal" }}>
                              Permanece en pendientes sin asignar a un foco. No consume capacidad planificable.
                            </span>
                          </button>

                          {/* Opción 2: Prioridad de recuperación */}
                          <button
                            type="button"
                            aria-pressed={isRecovery}
                            className={isRecovery ? "primary small" : "secondary small"}
                            data-testid={`decision-recovery-${item.id}`}
                            onClick={() => handleApplyOverdueDecision(item.id, "include_recovery")}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              textAlign: "left",
                              padding: "10px 12px",
                              borderRadius: "6px",
                              cursor: "pointer",
                              background: isRecovery ? "#eff6ff" : "#ffffff",
                              borderColor: isRecovery ? "#2563eb" : "#d1d5db",
                              borderWidth: isRecovery ? "2px" : "1px",
                              borderStyle: "solid",
                              color: isRecovery ? "#1d4ed8" : "inherit",
                              boxShadow: isRecovery ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                              width: "100%",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.85rem" }}>
                                {isRecovery
                                  ? "✓ Prioridad de recuperación"
                                  : `Prioridad de recuperación (${item.estimatedEffort?.value ?? 6}h)`}
                              </strong>
                              {isRecovery && (
                                <span className="badge badge-primary" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                                  Seleccionada
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.78rem", color: "#4b5563", marginTop: "4px", fontWeight: "normal" }}>
                              Se incorpora como foco principal de la semana consumiendo {item.estimatedEffort?.value ?? 6}h planificables.
                            </span>
                          </button>

                          {/* Opción 3: Reprogramar a otra semana */}
                          <button
                            type="button"
                            aria-pressed={isPostponed}
                            className={isPostponed ? "primary small" : "secondary small"}
                            data-testid={`decision-postpone-${item.id}`}
                            onClick={() => handleApplyOverdueDecision(item.id, "reschedule_future")}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-start",
                              textAlign: "left",
                              padding: "10px 12px",
                              borderRadius: "6px",
                              cursor: "pointer",
                              background: isPostponed ? "#eff6ff" : "#ffffff",
                              borderColor: isPostponed ? "#2563eb" : "#d1d5db",
                              borderWidth: isPostponed ? "2px" : "1px",
                              borderStyle: "solid",
                              color: isPostponed ? "#1d4ed8" : "inherit",
                              boxShadow: isPostponed ? "0 1px 3px rgba(37,99,235,0.15)" : "none",
                              width: "100%",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.85rem" }}>
                                {isPostponed ? "✓ Reprogramar a otra semana" : "Reprogramar a otra semana"}
                              </strong>
                              {isPostponed && (
                                <span className="badge badge-primary" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                                  Seleccionada
                                </span>
                              )}
                            </div>
                            <span style={{ fontSize: "0.78rem", color: "#4b5563", marginTop: "4px", fontWeight: "normal" }}>
                              Se posterga conscientemente a una semana posterior sin consumir horas en este plan.
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Confirmation Prompt & Key Tradeoffs */}
          {proposedWeek.confirmationPrompt && (
            <div
              className="calm-box"
              style={{
                marginTop: "20px",
                padding: "16px 18px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span style={{ fontSize: "1.1rem" }}>💡</span>
                <h4 style={{ margin: 0, fontSize: "1.05rem" }}>Revisión del plan</h4>
              </div>
              <p className="calm-text" style={{ fontWeight: 500, margin: "4px 0" }}>
                {proposedWeek.confirmationPrompt.question}
              </p>
              {proposedWeek.confirmationPrompt.keyTradeoffs.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Puntos a tener en cuenta:</span>
                  <ul style={{ margin: "4px 0 0 16px", fontSize: "0.85rem", color: "#444" }}>
                    {proposedWeek.confirmationPrompt.keyTradeoffs.map((tradeoff, idx) => (
                      <li key={idx}>{tradeoff}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {(() => {
            const fallbackWarnings = diagnostics.filter((diag) => diag.status === "fallback_used");
            if (fallbackWarnings.length === 0) return null;
            return (
              <details
                className="status-message status-warning calm-details"
                style={{
                  marginTop: "16px",
                  background: "var(--color-bg-warning, #fffbeb)",
                  border: "1px solid var(--color-border-warning, #fef3c7)",
                  padding: "10px 14px",
                  borderRadius: "6px",
                  color: "var(--color-text-warning, #92400e)",
                }}
                role="status"
                aria-label="Avisos sobre la propuesta semanal"
              >
                <summary style={{ fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Avisos en la preparación de la propuesta ({fallbackWarnings.length})
                </summary>
                <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px", fontSize: "0.85rem" }}>
                  {fallbackWarnings.map((diag, idx) => (
                    <li key={idx}>
                      <strong>{diag.stage}:</strong> {diag.fallbackRationale || diag.sanitizedError || "Fallback aplicado"}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })()}

          {activePlanConflict && (
            <div
              className="calm-box"
              style={{
                marginTop: "16px",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: "8px",
                padding: "16px",
              }}
              data-testid="active-plan-conflict-transition"
            >
              <h4 style={{ margin: "0 0 8px 0", color: "#1e40af" }}>
                🗓️ Propuesta guardada como borrador futuro
              </h4>
              <p style={{ margin: "0 0 8px 0", fontSize: "0.9rem", color: "#1e3a8a" }}>
                Ya tienes una semana activa en curso (<code>{activePlanConflict.existingActivePlanId}</code>). Para proteger tu claridad mental y no saturar tu atención con múltiples agendas simultáneas, <strong>solo puede haber una semana activa a la vez</strong>.
              </p>
              <p style={{ margin: "0 0 12px 0", fontSize: "0.85rem", color: "#2563eb" }}>
                Tu planificación para la semana del <strong>{activePlanConflict.targetWeek.startDate}</strong> al <strong>{activePlanConflict.targetWeek.endDate}</strong> está guardada de forma segura como borrador en tu cuaderno local (almacenamiento en este dispositivo). Podés volver a verla y ajustarla en cualquier momento desde esta pestaña (<strong>2. Preparar semana</strong>). En cuanto completes el cierre reflexivo de tu semana actual, podrás activarla directamente.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="primary small"
                  onClick={() => {
                    setActivePlanConflict(null);
                    if (onPlanCreated) onPlanCreated();
                  }}
                  data-testid="dismiss-conflict-transition-button"
                >
                  Entendido, volver a la semana activa
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setActivePlanConflict(null)}
                  data-testid="keep-editing-draft-button"
                >
                  Seguir editando este borrador
                </button>
              </div>
            </div>
          )}

          {confirmationError && (
            <div
              className="status-message status-error"
              style={{ marginTop: "16px" }}
              role="alert"
            >
              <strong>No se pudo activar la semana:</strong> {confirmationError}
            </div>
          )}

          {/* Apunte a lápiz / intuición (como en el diseño) */}
          <div
            style={{
              marginTop: "20px",
              padding: "14px 16px",
              background: "var(--surface-warm, #fcfbf8)",
              border: "1px dashed var(--border-color, #e6ded1)",
              borderRadius: "10px",
            }}
          >
            <div style={{ marginBottom: "6px" }}>
              <label
                htmlFor="apunte-lapiz-input"
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  color: "var(--text-main)",
                }}
              >
                ✏️ Notas o ajustes libres para esta semana (opcional):
              </label>
            </div>
            <textarea
              id="apunte-lapiz-input"
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: "0.9rem",
                fontFamily: "var(--font-serif)",
                background: "#ffffff",
                border: "1px solid var(--border-color)",
                borderRadius: "6px",
                boxSizing: "border-box",
                minHeight: "60px",
              }}
              placeholder="Escribe aquí si necesitas más tiempo o aligerar algo..."
              value={userIntent}
              onChange={(e) => setUserIntent(e.target.value)}
            />
          </div>

          {/* Confirmation Actions */}
          <div
            style={{
              marginTop: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                aria-label="Volver a revisar la selección de elementos"
                disabled={isConfirming}
                onClick={handleAdjustElements}
                data-testid="adjust-elements-button"
              >
                ✏️ Ajustar elementos
              </button>
              <button
                type="button"
                className="secondary"
                aria-label="Añadir más ideas o tareas a esta propuesta"
                disabled={isConfirming}
                onClick={() => setIsReviewingSelection(true)}
                data-testid="add-more-ideas-button"
              >
                ➕ Añadir más ideas
              </button>
              <button
                type="button"
                className="secondary"
                style={{ color: "#8c8273" }}
                aria-label="Comenzar otra semana desde cero"
                disabled={isConfirming}
                onClick={handleStartFreshWeek}
                data-testid="start-fresh-week-button"
              >
                ✨ Planificar otra semana
              </button>
            </div>

            <button
              type="button"
              className="primary"
              aria-label="Confirmar y activar semana"
              disabled={isConfirming}
              onClick={handleConfirmPlan}
              data-testid="confirm-plan-button"
            >
              {isConfirming ? "Guardando semana..." : "✓ Confirmar y activar semana"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
