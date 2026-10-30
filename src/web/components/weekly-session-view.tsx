import { useState, useEffect } from "react";
import { AIProvider } from "../../providers/ai-provider";
import { MockProvider } from "../../providers/mock-provider";
import { useWeeklySession } from "../context/weekly-session-context";
import { StoredWeeklyPlan } from "../../domain/repositories/types";
import { ExtractedItem } from "../../domain/items";
import { WeeklySchedule, DailyWorkAllocation } from "../../domain/schedule";
import { EstimationCompleteness, resolveDefaultTargetWeek } from "../../domain/week";
import { calculateWeeklyCapacity, resolveTargetWeek } from "../../skills/build-week/deterministic";
import { WeeklyPlanningFromNotes } from "./weekly-planning-from-notes";
import { evaluateRadarInput, RadarEvaluationResult } from "../../application/radar-pipeline";
import { AdjustmentProposal } from "../../domain/adjustment";

export {
  getWeekDays,
  formatDeferredReason,
  type UnscheduledCategoryInfo,
  formatUnscheduledCategory,
  formatCapacityStatus,
  formatProtectedSpaceStatus,
  formatEstimationCompleteness,
  formatHours,
  formatAdjustmentActionType,
  getAdjustmentTargetItem,
  renderAdjustmentDetails,
  formatMemoryCategory,
  formatProvenanceSource,
  formatConfirmationStatus,
  type PlanItemDescriptor,
  extractPlanItems,
} from "./weekly-session-formatters";

export { ConfirmedActiveMemoriesSection } from "./confirmed-active-memories-section";
export { CapacityProtectedSpaceSection } from "./capacity-protected-space-section";

import { extractPlanItems } from "./weekly-session-formatters";
import { ConfirmedActiveMemoriesSection } from "./confirmed-active-memories-section";
import { CapacityProtectedSpaceSection } from "./capacity-protected-space-section";
import { ClosedWeekReviewCard } from "./closed-week-review-card";
import { UnforeseenRadarSection } from "./unforeseen-radar-section";
import { ActiveWeekScheduleSection } from "./active-week-schedule-section";
import { WeeklyReflectiveClosingSection } from "./weekly-reflective-closing-section";
import { ScheduleAdjustmentHistorySection } from "./schedule-adjustment-history-section";
import { ConfirmedCloseReportSection } from "./confirmed-close-report-section";
import { MemoryCandidatesSection } from "./memory-candidates-section";

export type ItemDispositionChoice =
  "unreviewed" | "completed" | "in_progress" | "not_started" | "consciously_postponed" | "dropped";

export interface ItemDispositionForm {
  status: ItemDispositionChoice;
  postponementReason: string;
}

export interface WeeklySessionViewProps {
  provider?: AIProvider;
  initialPlanningItems?: ExtractedItem[];
  onClearPlanningItems?: () => void;
  activeSpace?: "prepare" | "active" | "review";
  onNavigateSpace?: (space: "capture" | "prepare" | "active" | "review") => void;
}

export function WeeklySessionView({
  provider = new MockProvider(),
  initialPlanningItems,
  onClearPlanningItems,
  activeSpace,
  onNavigateSpace,
}: WeeklySessionViewProps = {}) {
  const {
    state,
    reloadSession,
    createOrSavePlan,
    applyAdjustment,
    closeWeek,
    reopenWeek,
    confirmMemoryCandidate,
    archiveMemory,
    deleteMemory,
    purgeSession,
    resolveAmbiguity,
  } = useWeeklySession();

  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [reflectionNotes, setReflectionNotes] = useState("");
  const [dispositions, setDispositions] = useState<Record<string, ItemDispositionForm>>({});
  const [isPurgeConfirming, setIsPurgeConfirming] = useState(false);
  const [isClosedWeekDetailsOpen, setIsClosedWeekDetailsOpen] = useState(false);
  const [reopenFeedback, setReopenFeedback] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [closeStep, setCloseStep] = useState<"dispositions" | "reflection">("dispositions");
  const [isEarlyCloseConfirmed, setIsEarlyCloseConfirmed] = useState(false);

  // Interactive Adjustment Proposal State
  const [selectedAdjustmentItemId, setSelectedAdjustmentItemId] = useState<string>("");
  const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
  const [lastSavedAdjustment, setLastSavedAdjustment] = useState<string | null>(null);
  const defaultTargetWeek =
    state.activePlan?.targetWeek ?? resolveDefaultTargetWeek(new Date().toISOString().slice(0, 10));
  const [targetWeekStart, setTargetWeekStart] = useState(defaultTargetWeek.startDate);
  const [targetWeekEnd, setTargetWeekEnd] = useState(defaultTargetWeek.endDate);
  const [deadlineInput, setDeadlineInput] = useState("");
  const [taskHoursInput, setTaskHoursInput] = useState<string>("");
  const [taskDayInput, setTaskDayInput] = useState<string>("");
  const [isAdjustmentPreviewOpen, setIsAdjustmentPreviewOpen] = useState(false);

  const plan = state.activePlan;
  const schedule = state.activeSchedule;
  const planItems = extractPlanItems(plan, schedule);
  const effectiveItemId = selectedAdjustmentItemId || planItems[0]?.itemId || "";
  const selectedItem = planItems.find((i) => i.itemId === effectiveItemId) || planItems[0];

  useEffect(() => {
    if (selectedItem) {
      setTaskHoursInput(
        selectedItem.estimatedHours != null ? String(selectedItem.estimatedHours) : ""
      );
      const alloc = schedule?.dailyAllocations.find((a) => a.itemId === selectedItem.itemId);
      setTaskDayInput(alloc?.day || "");
    }
  }, [selectedItem?.itemId, selectedItem?.estimatedHours, schedule]);

  // Radar de Imprevistos State (Sección 21-25)
  const [radarInput, setRadarInput] = useState("");
  const [radarEvaluating, setRadarEvaluating] = useState(false);
  const [radarResult, setRadarResult] = useState<RadarEvaluationResult | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);

  const handleEvaluateRadar = async () => {
    if (!radarInput.trim() || !plan) return;
    setRadarEvaluating(true);
    setRadarError(null);
    try {
      const today = new Date().toISOString().split("T")[0]!;
      const res = await evaluateRadarInput(provider, {
        changeDescription: radarInput,
        currentDate: today,
        activePlan: plan.proposal,
        timeBlocks: schedule?.timeBlocks,
        dailyAllocations: schedule?.dailyAllocations,
      });
      setRadarResult(res);
    } catch (err) {
      setRadarError(
        (err as Error).message || "Ocurrió un error al evaluar el imprevisto con el Radar."
      );
    } finally {
      setRadarEvaluating(false);
    }
  };

  const handleApplyRadarAdjustment = async (proposal: AdjustmentProposal) => {
    if (!schedule || !proposal.actions || proposal.actions.length === 0) return;
    const primaryAction = proposal.actions[0];
    if (!primaryAction) return;

    try {
      const res = await applyAdjustment({
        scheduleId: schedule.scheduleId,
        proposalId: proposal.id,
        adjustmentId: `adj-${Date.now()}`,
        action: primaryAction,
        expectedScheduleVersion: schedule.version,
        humanDecision: "accepted",
        decidedAt: new Date().toISOString(),
      });

      if (res.status === "success") {
        setFeedbackMessage("Ajuste del Radar aplicado con éxito a tu agenda.");
        setRadarResult(null);
        setRadarInput("");
      } else if (res.status === "concurrency_conflict") {
        setFeedbackMessage("Conflicto de versión al aplicar el ajuste. Recarga la agenda.");
      } else {
        setFeedbackMessage(`No se pudo aplicar el ajuste: ${res.status}`);
      }
    } catch (err) {
      setFeedbackMessage((err as Error).message || "Error al aplicar ajuste del Radar.");
    }
  };

  const handleIncorporateRadarItems = async (mode: "auto" | "flexible" = "auto") => {
    if (!plan || !radarResult || radarResult.extractedItems.length === 0) return;

    try {
      const currentProposal = plan.proposal;
      const newObligations = [...currentProposal.obligations];
      const newFlexible = [...currentProposal.flexibleOptions];
      let addedHours = 0;
      let hasUnestimated = false;

      // Collect all existing item IDs across all collections to guarantee complete uniqueness
      const existingItemIds = new Set<string>([
        ...currentProposal.foci.flatMap((f) => f.contributingItemIds),
        ...currentProposal.obligations.map((o) => o.itemId),
        ...currentProposal.flexibleOptions.map((f) => f.itemId),
        ...currentProposal.deferredItems.map((d) => d.itemId),
      ]);

      const allocatedScheduleItems: { id: string; day: string; hours: number }[] = [];
      let counter = 1;

      for (const item of radarResult.extractedItems) {
        const itemHours = item.estimatedEffort?.value ?? null;
        if (itemHours != null && itemHours > 0) {
          addedHours += itemHours;
        } else {
          hasUnestimated = true;
        }

        // Generate a guaranteed unique ID for each incorporated item
        let resolvedItemId = item.id;
        while (existingItemIds.has(resolvedItemId)) {
          resolvedItemId = `item-radar-${Date.now()}-${counter++}`;
        }
        existingItemIds.add(resolvedItemId);

        const isExternal = item.commitment === "external";
        const hasDeadline = Boolean(item.deadline?.resolved);

        if (mode === "auto" && (isExternal || hasDeadline)) {
          newObligations.push({
            itemId: resolvedItemId,
            title: item.title,
            ...(item.deadline?.resolved ? { dueDate: item.deadline.resolved } : {}),
            commitmentType: isExternal ? "external" : "strict_deadline",
            rationale: "Incorporado vía Radar de imprevistos",
            estimatedHours: itemHours,
          });
        } else {
          newFlexible.push({
            itemId: resolvedItemId,
            title: item.title,
            condition: item.type === "idea" ? "Exploración de idea" : "Si hay espacio",
            estimatedHours: itemHours,
          });
        }

        if (
          item.deadline?.resolved &&
          itemHours != null &&
          itemHours > 0 &&
          schedule &&
          item.deadline.resolved >= schedule.weekRange.startDate &&
          item.deadline.resolved <= schedule.weekRange.endDate
        ) {
          allocatedScheduleItems.push({
            id: resolvedItemId,
            day: item.deadline.resolved,
            hours: itemHours,
          });
        }
      }

      const prevPlanned = currentProposal.weekSummary.capacity.plannedHours ?? 0;
      const prevEstimated = currentProposal.weekSummary.capacity.knownEstimatedHours ?? 0;
      const prevCompleteness = currentProposal.weekSummary.capacity.estimationCompleteness;

      const updatedPlan: StoredWeeklyPlan = {
        ...plan,
        updatedAt: new Date().toISOString(),
        proposal: {
          ...currentProposal,
          obligations: newObligations,
          flexibleOptions: newFlexible,
          weekSummary: {
            ...currentProposal.weekSummary,
            capacity: {
              ...currentProposal.weekSummary.capacity,
              plannedHours: prevPlanned + addedHours,
              knownEstimatedHours: prevEstimated + addedHours,
              estimationCompleteness:
                hasUnestimated && prevCompleteness === "complete" ? "partial" : prevCompleteness,
            },
          },
        },
      };

      let updatedSchedule = schedule;
      if (schedule) {
        const newDailyAllocations = [...schedule.dailyAllocations];
        for (const alloc of allocatedScheduleItems) {
          newDailyAllocations.push({
            itemId: alloc.id,
            day: alloc.day,
            allocatedHours: alloc.hours,
          });
        }
        const now = new Date().toISOString();
        const resolvedUpdatedAt = now < schedule.createdAt ? schedule.createdAt : now;

        updatedSchedule = {
          ...schedule,
          dailyAllocations: newDailyAllocations,
          version: schedule.version + 1,
          updatedAt: resolvedUpdatedAt,
        };
      }

      const res = await createOrSavePlan(
        updatedPlan,
        updatedSchedule ?? undefined,
        schedule?.version
      );

      if (res.status === "success") {
        setFeedbackMessage(
          `Se incorporaron ${radarResult.extractedItems.length} elemento(s) del Radar a tu semana.`
        );
        setRadarResult(null);
        setRadarInput("");
      } else {
        const errorMsg = `No se pudieron incorporar los elementos: ${res.status}`;
        setFeedbackMessage(errorMsg);
        setRadarError(errorMsg);
      }
    } catch (err) {
      const errorMsg = (err as Error).message || "Error al incorporar elementos a la semana.";
      setFeedbackMessage(errorMsg);
      setRadarError(errorMsg);
    }
  };

  const handleSaveTaskAdjustment = async (
    itemId: string,
    itemTitle: string,
    options?: {
      overrideHours?: number | null;
      overrideDay?: string;
    }
  ) => {
    if (!plan) return;

    // 1. Resolve hours
    let hoursToApply: number | null = null;
    if (options && "overrideHours" in options) {
      hoursToApply = options.overrideHours ?? null;
    } else {
      const parsed = taskHoursInput.trim() ? parseFloat(taskHoursInput) : null;
      if (parsed !== null && !isNaN(parsed) && parsed >= 0) {
        hoursToApply = parsed;
      } else if (selectedItem?.estimatedHours != null) {
        hoursToApply = selectedItem.estimatedHours;
      } else {
        const alloc = schedule?.dailyAllocations.find((a) => a.itemId === itemId);
        if (alloc && alloc.allocatedHours > 0) {
          hoursToApply = alloc.allocatedHours;
        }
      }
    }

    // 2. Resolve day
    const dayToApply =
      options?.overrideDay !== undefined ? options.overrideDay : taskDayInput.trim();

    // 3. Update proposal collections
    const updatedObligations = plan.proposal.obligations.map((o) =>
      o.itemId === itemId ? { ...o, estimatedHours: hoursToApply } : o
    );
    const updatedFlexible = plan.proposal.flexibleOptions.map((f) =>
      f.itemId === itemId ? { ...f, estimatedHours: hoursToApply } : f
    );
    const updatedFoci = plan.proposal.foci.map((focus) =>
      focus.contributingItemIds.includes(itemId)
        ? { ...focus, estimatedHours: hoursToApply }
        : focus
    );
    let updatedDeferred = plan.proposal.deferredItems.map((d) =>
      d.itemId === itemId ? { ...d } : d
    );

    // If deferred item is given hours or day, promote it to flexibleOptions
    if (
      plan.proposal.deferredItems.some((d) => d.itemId === itemId) &&
      (hoursToApply !== null || dayToApply)
    ) {
      const deferredItem = plan.proposal.deferredItems.find((d) => d.itemId === itemId)!;
      updatedDeferred = plan.proposal.deferredItems.filter((d) => d.itemId !== itemId);
      if (!updatedFlexible.some((f) => f.itemId === itemId)) {
        updatedFlexible.push({
          itemId: deferredItem.itemId,
          title: deferredItem.title,
          estimatedHours: hoursToApply,
          condition: "Ajustada manualmente por la persona",
        });
      }
    }

    // 4. Calculate capacity
    const allPlannedEntries = [
      ...updatedFoci.map((f) => ({ estimatedHours: f.estimatedHours })),
      ...updatedObligations.map((o) => ({ estimatedHours: o.estimatedHours })),
      ...updatedFlexible.map((f) => ({ estimatedHours: f.estimatedHours })),
    ];
    let sum = 0;
    let nonNullCount = 0;
    for (const e of allPlannedEntries) {
      if (typeof e.estimatedHours === "number" && Number.isFinite(e.estimatedHours)) {
        sum += e.estimatedHours;
        nonNullCount++;
      }
    }
    const completeness: EstimationCompleteness =
      nonNullCount === allPlannedEntries.length && allPlannedEntries.length > 0
        ? "complete"
        : nonNullCount > 0
          ? "partial"
          : "none";
    const explicitKnownEstimatedHours = nonNullCount > 0 ? Math.round(sum * 100) / 100 : null;

    const updatedCapacity = calculateWeeklyCapacity({
      capacityConfig: {
        totalAvailableHours: plan.proposal.weekSummary.capacity.totalAvailableHours ?? undefined,
        minProtectedSpaceRatio:
          plan.proposal.weekSummary.capacity.totalAvailableHours &&
          plan.proposal.weekSummary.capacity.protectedSpaceHours
            ? plan.proposal.weekSummary.capacity.protectedSpaceHours /
              plan.proposal.weekSummary.capacity.totalAvailableHours
            : 0.25,
      },
      explicitKnownEstimatedHours,
      explicitCompleteness: completeness,
      foci: updatedFoci,
      obligations: updatedObligations,
      flexibleOptions: updatedFlexible,
    });

    const updatedPlan: StoredWeeklyPlan = {
      ...plan,
      proposal: {
        ...plan.proposal,
        obligations: updatedObligations,
        flexibleOptions: updatedFlexible,
        foci: updatedFoci.slice(0, 3),
        deferredItems: updatedDeferred,
        weekSummary: {
          ...plan.proposal.weekSummary,
          capacity: updatedCapacity,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    // 5. Update schedule allocations
    let updatedSchedule = schedule;
    if (schedule) {
      let newAllocations = [...schedule.dailyAllocations];
      const allocIdx = newAllocations.findIndex((a) => a.itemId === itemId);

      if (dayToApply) {
        const allocation: DailyWorkAllocation = {
          itemId,
          day: dayToApply,
          allocatedHours: hoursToApply ?? 1,
        };
        if (allocIdx >= 0) {
          newAllocations[allocIdx] = allocation;
        } else {
          newAllocations.push(allocation);
        }
      } else {
        newAllocations = newAllocations.filter((a) => a.itemId !== itemId);
      }

      updatedSchedule = {
        ...schedule,
        dailyAllocations: newAllocations,
        version: schedule.version + 1,
        updatedAt: new Date().toISOString(),
      };
    }

    const res = await createOrSavePlan(updatedPlan, updatedSchedule ?? undefined);
    setIsAdjustmentPreviewOpen(false);

    if (res.status === "success") {
      let desc = `Ajuste guardado para «${itemTitle}»: `;
      desc += hoursToApply != null ? `${hoursToApply}h` : "sin estimar";
      desc += dayToApply ? ` asignada al ${dayToApply}.` : " repartida en la semana.";
      setFeedbackMessage(desc);
      setLastSavedAdjustment(desc);
      setIsAdjustmentOpen(false);
      await reloadSession();
    } else {
      setFeedbackMessage(
        `No se pudo guardar el ajuste: ${res.status === "invalid_data" ? res.reason : res.status}`
      );
    }
  };

  const handleReopenWeek = async (planId: string) => {
    setIsReopening(true);
    setReopenFeedback(null);
    try {
      if (!reopenWeek) {
        throw new Error("La función para reabrir semanas no está disponible.");
      }
      const res = await reopenWeek(planId);
      if (res.status === "success") {
        setFeedbackMessage(
          "Semana reabierta exitosamente. Ahora puedes continuar planificando o modificando tus tareas."
        );
      } else if (res.status === "conflict_active_plan_exists") {
        setReopenFeedback(
          `No es posible reabrir esta semana porque ya existe otra semana activa (${res.existingActivePlanId}). Cierra o purga la semana activa antes de reabrir esta.`
        );
      } else {
        setReopenFeedback(
          `No se pudo reabrir la semana: ${res.status === "failed" ? res.reason : res.status}`
        );
      }
    } catch (err) {
      setReopenFeedback(
        (err as Error).message || "Ocurrió un error inesperado al reabrir la semana."
      );
    } finally {
      setIsReopening(false);
    }
  };

  const handleDispositionChange = (itemId: string, status: ItemDispositionChoice) => {
    setDispositions((prev) => ({
      ...prev,
      [itemId]: {
        status,
        postponementReason: prev[itemId]?.postponementReason || "",
      },
    }));
  };

  const handlePostponementReasonChange = (itemId: string, reason: string) => {
    setDispositions((prev) => ({
      ...prev,
      [itemId]: {
        status: prev[itemId]?.status || "consciously_postponed",
        postponementReason: reason,
      },
    }));
  };

  // --------------------------------------------------------------------------
  // Loading State
  // --------------------------------------------------------------------------
  if (state.status === "loading") {
    return (
      <div className="session-container calm-box" role="status" aria-live="polite">
        <p className="calm-text">Revisando tu cuaderno y agenda...</p>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Error State
  // --------------------------------------------------------------------------
  if (state.status === "error") {
    return (
      <div className="session-container status-message status-error" role="alert">
        <h3>Se produjo una interrupción en el almacenamiento</h3>
        <p>{state.errorMessage}</p>
        <button
          className="primary"
          aria-label="Reintentar conexión con la base de datos"
          onClick={() => reloadSession()}
        >
          Reintentar conexión
        </button>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Inconsistent References State
  // --------------------------------------------------------------------------
  if (state.status === "inconsistent_references") {
    return (
      <div className="session-container calm-box warning-box" role="alert">
        <h3>Incoherencia detectada en las referencias del plan</h3>
        <p className="calm-text">
          La agenda o informe guardado no coincide exactamente con el plan activo:
        </p>
        <blockquote className="raw-json-box">{state.inconsistencyReason}</blockquote>
        <p className="calm-muted">
          Para preservar la integridad de tus datos, no realizamos mutaciones automáticas.
        </p>
        <div className="actions">
          <button
            className="secondary"
            aria-label="Recargar sesión para verificar estado"
            onClick={() => reloadSession()}
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Ambiguous Active Plans State
  // --------------------------------------------------------------------------
  if (state.status === "ambiguous_active_plans") {
    return (
      <div className="session-container calm-box warning-box" role="alert">
        <h3>Múltiples planes activos detectados</h3>
        <p className="calm-text">
          Existen varios planes marcados simultáneamente como activos. Tú decides cuál conservar
          como el plan de esta semana:
        </p>
        <ul className="items-list" aria-label="Lista de planes activos ambiguos">
          {state.ambiguousPlanIds.map((id) => (
            <li
              key={id}
              className="item-card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>
                Plan ID: <strong>{id}</strong>
              </span>
              <button
                className="primary"
                aria-label={`Mantener plan ${id} como activo`}
                onClick={async () => {
                  await resolveAmbiguity(id);
                  setFeedbackMessage(`Se seleccionó el plan ${id} como activo.`);
                }}
              >
                Mantener este plan
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Helper: Latest Closed Week Section (Reused across views)
  // --------------------------------------------------------------------------
  const renderLatestClosedWeekSection = () => {
    if (!state.latestClosedWeek) return null;
    return (
      <ClosedWeekReviewCard
        latestClosedWeek={state.latestClosedWeek}
        isClosedWeekDetailsOpen={isClosedWeekDetailsOpen}
        setIsClosedWeekDetailsOpen={setIsClosedWeekDetailsOpen}
        isReopening={isReopening}
        handleReopenWeek={handleReopenWeek}
        reopenFeedback={reopenFeedback}
      />
    );
  };

  // --------------------------------------------------------------------------
  // Helper: Memory Candidates Section (Sovereignty Invariant)
  // --------------------------------------------------------------------------
  const renderMemoryCandidatesSection = () => (
    <MemoryCandidatesSection
      memoryCandidates={state.memoryCandidates}
      confirmMemoryCandidate={confirmMemoryCandidate}
      setFeedbackMessage={setFeedbackMessage}
    />
  );

  const renderDevOptions = () => (
    <div
      style={{
        marginTop: "24px",
        paddingTop: "12px",
        borderTop: "1px dashed var(--border-color, #ddd)",
      }}
      data-testid="dev-options-section"
    >
      <details className="calm-details">
        <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#666" }}>
          Opciones de desarrollo: Iniciar semana de ejemplo prefijada
        </summary>
        <div style={{ marginTop: "12px" }}>
          <button
            type="button"
            className="secondary"
            aria-label="Iniciar nueva semana de ejemplo"
            onClick={async () => {
              const today = new Date().toISOString().split("T")[0]!;
              const targetWeek = resolveTargetWeek(today);
              const monday = targetWeek.startDate;
              const tuesdayDate = new Date(`${monday}T00:00:00Z`);
              tuesdayDate.setUTCDate(tuesdayDate.getUTCDate() + 1);
              const tuesday = tuesdayDate.toISOString().split("T")[0]!;
              const planId = `plan-${today}`;
              const demoPlan: StoredWeeklyPlan = {
                planId,
                status: "active",
                targetWeek,
                proposal: {
                  weekSummary: {
                    targetWeek,
                    capacity: {
                      totalAvailableHours: 30,
                      plannableHours: 22.5,
                      plannedHours: 16,
                      knownEstimatedHours: 16,
                      estimationCompleteness: "complete",
                      protectedSpaceHours: 7.5,
                      capacityStatus: "within_capacity",
                      protectedSpaceStatus: "respected",
                    },
                    intent: "Semana de consolidación y respiro",
                  },
                  foci: [
                    {
                      id: "focus-1",
                      title: "Reporte estratégico",
                      desiredOutcome: "Borrador revisado",
                      rationale: "Foco principal de la semana",
                      contributingItemIds: ["task-reporte"],
                      estimatedHours: 12,
                    },
                  ],
                  obligations: [
                    {
                      itemId: "task-reunion",
                      title: "Reunión de equipo",
                      dueDate: tuesday,
                      commitmentType: "external",
                      rationale: "Compromiso de coordinación",
                      estimatedHours: 4,
                    },
                  ],
                  flexibleOptions: [],
                  deferredItems: [],
                  unplannedSpace: {
                    recommendedHours: 7.5,
                    rationale: "Espacio protegido para imprevistos",
                  },
                  confirmationPrompt: {
                    question: "¿Te representa este plan?",
                    keyTradeoffs: ["Foco en reporte estratégico vs otras tareas"],
                    pendingQuestions: [],
                  },
                },
                createdAt: today,
                updatedAt: today,
              };

              const demoSchedule: WeeklySchedule = {
                scheduleId: `sched-${planId}`,
                planId,
                weekRange: targetWeek,
                version: 1,
                timeBlocks: [
                  {
                    itemId: "task-reporte",
                    day: monday,
                    startTime: "09:00",
                    endTime: "11:00",
                  },
                ],
                dailyAllocations: [
                  { day: monday, allocatedHours: 5, itemId: "task-reporte" },
                  { day: tuesday, allocatedHours: 4, itemId: "task-reunion" },
                ],
                appliedAdjustments: [],
                createdAt: today,
                updatedAt: today,
              };

              const res = await createOrSavePlan(demoPlan, demoSchedule);
              if (res.status === "success") {
                setFeedbackMessage("Semana de ejemplo iniciada correctamente.");
                reloadSession();
                onNavigateSpace?.("active");
              }
            }}
          >
            Iniciar semana activa de ejemplo (12 al 18 Octubre)
          </button>
        </div>
      </details>
    </div>
  );

  // --------------------------------------------------------------------------
  // Space 2: Preparar semana (Dedicated space view)
  // --------------------------------------------------------------------------
  if (activeSpace === "prepare") {
    return (
      <div className="session-container calm-box">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de preparación de semana">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <h2>2. Preparar semana</h2>
            {state.status === "session_resumed" && state.activePlan && (
              <span className="badge badge-task">
                Semana activa: {state.activePlan.targetWeek.startDate} al{" "}
                {state.activePlan.targetWeek.endDate}
              </span>
            )}
          </div>
          <p className="calm-muted" style={{ marginTop: "6px" }}>
            {state.status === "session_resumed"
              ? "Tienes una semana activa en curso. Aquí puedes estructurar un borrador para la próxima semana e incorporar tareas postergadas sin alterar la semana activa."
              : "Configura tu semana objetivo, capacidad y foco a partir de tus notas o elementos extraídos."}
          </p>
          {onNavigateSpace && (
            <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                data-testid="nav-back-to-capture-button"
                onClick={() => onNavigateSpace("capture")}
              >
                ← Volver a Capturar
              </button>
              {state.status === "session_resumed" && (
                <button
                  type="button"
                  className="secondary"
                  data-testid="nav-to-active-from-prepare-button"
                  onClick={() => onNavigateSpace("active")}
                >
                  Ver Mi semana activa →
                </button>
              )}
            </div>
          )}
        </section>

        <div style={{ marginTop: "16px" }}>
          <WeeklyPlanningFromNotes
            provider={provider}
            initialItems={initialPlanningItems}
            hasActivePlan={state.status === "session_resumed"}
            onPlanCreated={() => {
              onClearPlanningItems?.();
              reloadSession();
              if (onNavigateSpace && state.status !== "session_resumed") {
                onNavigateSpace("active");
              }
            }}
          />
        </div>

        {state.latestClosedWeek && (
          <details className="calm-details" style={{ marginTop: "24px" }}>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--accent-color, #2b6cb0)",
                userSelect: "none",
              }}
            >
              Ver aprendizajes y tareas de la última semana cerrada
            </summary>
            <div style={{ marginTop: "12px" }}>{renderLatestClosedWeekSection()}</div>
          </details>
        )}

        {renderDevOptions()}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Space 3: Mi semana (Empty state when no active plan)
  // --------------------------------------------------------------------------
  if (activeSpace === "active" && state.status === "no_active_session") {
    return (
      <div className="session-container calm-box">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de mi semana activa">
          <h2>3. Mi semana</h2>
          <p className="calm-text" style={{ marginTop: "8px" }}>
            Tu cuaderno está despejado. No hay ninguna semana activa en este momento.
          </p>
          <div
            className="actions"
            style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}
          >
            <button
              className="primary"
              data-testid="nav-to-prepare-from-active-button"
              onClick={() => onNavigateSpace?.("prepare")}
            >
              🗓️ Preparar una semana
            </button>
            <button
              className="secondary"
              data-testid="nav-to-capture-from-active-button"
              onClick={() => onNavigateSpace?.("capture")}
            >
              ✍️ Capturar ideas
            </button>
          </div>
        </section>

        {/* Borradores guardados de semanas en preparación */}
        {state.draftPlans && state.draftPlans.length > 0 && (
          <div
            className="calm-box"
            style={{
              marginTop: "20px",
              padding: "16px",
              background: "var(--bg-card, #fcfbf9)",
              border: "1px solid var(--border-color, #e8e3d9)",
            }}
            data-testid="active-space-drafts-notice"
          >
            <h4 style={{ margin: "0 0 8px 0" }}>
              📂 Borradores de semana guardados ({state.draftPlans.length})
            </h4>
            <p className="calm-muted" style={{ fontSize: "0.88rem", marginBottom: "12px" }}>
              Tienes planificación guardada en tu cuaderno local. Puedes abrir el borrador para
              revisarlo o activarlo:
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {state.draftPlans.map((draft) => (
                <button
                  key={draft.planId}
                  className="secondary"
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  onClick={() => onNavigateSpace?.("prepare")}
                >
                  <span>
                    🗓️ Semana {draft.targetWeek.startDate} al {draft.targetWeek.endDate}
                  </span>
                  <span className="badge badge-muted">Continuar borrador →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {state.latestClosedWeek && (
          <div style={{ marginTop: "24px" }}>{renderLatestClosedWeekSection()}</div>
        )}

        <ConfirmedActiveMemoriesSection
          memories={state.memories}
          archiveMemory={archiveMemory}
          deleteMemory={deleteMemory}
        />

        {renderDevOptions()}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Space 4: Revisar y aprender (Empty state when no active plan)
  // --------------------------------------------------------------------------
  if (activeSpace === "review" && state.status === "no_active_session") {
    return (
      <div className="session-container">
        {feedbackMessage && (
          <div className="status-message status-info" role="status">
            {feedbackMessage}
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
              aria-label="Cerrar notificación"
              onClick={() => setFeedbackMessage(null)}
            >
              ×
            </button>
          </div>
        )}
        <section className="plan-summary-card" aria-label="Espacio de revisión y aprendizaje">
          <h2>4. Revisar y aprender</h2>
          <p className="calm-muted" style={{ marginTop: "6px" }}>
            Cierre de ciclo, evaluación honesta de tareas y aprendizaje para las próximas semanas.
            Nada se guarda en memoria sin tu confirmación explícita.
          </p>
        </section>

        {renderLatestClosedWeekSection()}

        {renderMemoryCandidatesSection()}

        {!state.latestClosedWeek && !state.latestCloseReport && (
          <div className="calm-box" style={{ marginTop: "20px" }}>
            <p className="calm-muted">
              No hay semanas cerradas ni activas para revisar en este momento.
            </p>
            <button
              className="primary"
              style={{ marginTop: "12px" }}
              onClick={() => onNavigateSpace?.("prepare")}
            >
              Ir a preparar semana
            </button>
          </div>
        )}

        <ConfirmedActiveMemoriesSection
          memories={state.memories}
          archiveMemory={archiveMemory}
          deleteMemory={deleteMemory}
        />
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // No Active Session State (With optional latest closed week recovery)
  // --------------------------------------------------------------------------
  if (state.status === "no_active_session") {
    return (
      <div className="session-container calm-box">
        <h2>Sin semana activa</h2>
        <p className="calm-text">
          Tu cuaderno está despejado. No hay ninguna semana activa en este momento.
        </p>

        {renderLatestClosedWeekSection()}

        <WeeklyPlanningFromNotes
          provider={provider}
          initialItems={initialPlanningItems}
          onPlanCreated={() => {
            onClearPlanningItems?.();
            reloadSession();
          }}
        />

        <div
          style={{
            marginTop: "24px",
            paddingTop: "12px",
            borderTop: "1px dashed var(--border-color, #ddd)",
          }}
        >
          <details>
            <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#666" }}>
              Opciones de desarrollo: Iniciar semana de ejemplo prefijada
            </summary>
            <div style={{ marginTop: "12px" }}>
              <button
                className="secondary"
                aria-label="Iniciar nueva semana de ejemplo"
                onClick={async () => {
                  const today = new Date().toISOString().split("T")[0]!;
                  const targetWeek = resolveTargetWeek(today);
                  const monday = targetWeek.startDate;
                  const tuesdayDate = new Date(`${monday}T00:00:00Z`);
                  tuesdayDate.setUTCDate(tuesdayDate.getUTCDate() + 1);
                  const tuesday = tuesdayDate.toISOString().split("T")[0]!;
                  const planId = `plan-${today}`;
                  const demoPlan: StoredWeeklyPlan = {
                    planId,
                    status: "active",
                    targetWeek,
                    proposal: {
                      weekSummary: {
                        targetWeek,
                        capacity: {
                          totalAvailableHours: 30,
                          plannableHours: 22.5,
                          plannedHours: 16,
                          knownEstimatedHours: 16,
                          estimationCompleteness: "complete",
                          protectedSpaceHours: 7.5,
                          capacityStatus: "within_capacity",
                          protectedSpaceStatus: "respected",
                        },
                        intent: "Semana de consolidación y respiro",
                      },
                      foci: [
                        {
                          id: "focus-1",
                          title: "Reporte estratégico",
                          desiredOutcome: "Borrador revisado",
                          rationale: "Foco principal de la semana",
                          contributingItemIds: ["task-reporte"],
                          estimatedHours: 12,
                        },
                      ],
                      obligations: [
                        {
                          itemId: "task-reunion",
                          title: "Reunión de equipo",
                          dueDate: tuesday,
                          commitmentType: "external",
                          rationale: "Compromiso de coordinación",
                          estimatedHours: 4,
                        },
                      ],
                      flexibleOptions: [],
                      deferredItems: [],
                      unplannedSpace: {
                        recommendedHours: 7.5,
                        rationale: "Espacio protegido para imprevistos",
                      },
                      confirmationPrompt: {
                        question: "¿Te representa este plan?",
                        keyTradeoffs: ["Foco en reporte estratégico vs otras tareas"],
                        pendingQuestions: [],
                      },
                    },
                    createdAt: today,
                    updatedAt: today,
                  };

                  const demoSchedule: WeeklySchedule = {
                    scheduleId: `sched-${planId}`,
                    planId,
                    weekRange: targetWeek,
                    version: 1,
                    timeBlocks: [
                      {
                        itemId: "task-reporte",
                        day: monday,
                        startTime: "09:00",
                        endTime: "11:00",
                      },
                    ],
                    dailyAllocations: [
                      { day: monday, allocatedHours: 5, itemId: "task-reporte" },
                      { day: tuesday, allocatedHours: 4, itemId: "task-reunion" },
                    ],
                    appliedAdjustments: [],
                    createdAt: today,
                    updatedAt: today,
                  };

                  await createOrSavePlan(demoPlan, demoSchedule);
                  setFeedbackMessage("Semana iniciada con éxito.");
                }}
              >
                Iniciar nueva semana de ejemplo
              </button>
            </div>
          </details>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // Active Session View (session_resumed)
  // --------------------------------------------------------------------------

  return (
    <div className="session-container">
      {feedbackMessage && (
        <div className="status-message status-info" role="status">
          {feedbackMessage}
          <button
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
            aria-label="Cerrar notificación"
            onClick={() => setFeedbackMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {state.concurrencyConflict && (
        <div
          className="status-message status-error"
          role="alert"
          style={{ display: "flex", flexDirection: "column", gap: "8px" }}
        >
          <div>
            <strong>Conflicto de versión detectado:</strong> La versión esperada era v
            {state.concurrencyConflict.expectedVersion}, pero la agenda se encuentra en v
            {state.concurrencyConflict.currentVersion} (posible cambio en otra pestaña o sesión). El
            ajuste <strong>no se ha aplicado</strong>.
          </div>
          <div>
            <button
              className="primary"
              aria-label="Recargar agenda para sincronizar versión"
              style={{ alignSelf: "flex-start" }}
              onClick={() => reloadSession()}
            >
              Recargar agenda para sincronizar
            </button>
          </div>
        </div>
      )}

      {/* Plan Header */}
      <section className="plan-summary-card" aria-label="Resumen de la semana">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <h2>
            {activeSpace === "active"
              ? "3. Mi semana"
              : activeSpace === "review"
                ? "4. Revisar y aprender"
                : plan?.status === "closed"
                  ? "Semana cerrada"
                  : "Semana en curso"}
          </h2>
          <span className="badge badge-task">
            {plan?.targetWeek.startDate} al {plan?.targetWeek.endDate}
          </span>
        </div>
        <p className="calm-text" style={{ marginTop: "8px" }}>
          {plan?.proposal.weekSummary.intent || "Plan semanal activo."}
        </p>

        <div
          className="config-row"
          style={{ marginTop: "12px", flexWrap: "wrap", gap: "8px", alignItems: "center" }}
        >
          <span className="badge badge-muted">Versión de agenda: v{schedule?.version ?? 0}</span>
          {onNavigateSpace ? (
            <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="secondary"
                data-testid="nav-to-prepare-button"
                aria-label="Preparar próxima semana"
                onClick={() => onNavigateSpace?.("prepare")}
              >
                🗓️ Preparar próxima semana
              </button>
              {activeSpace !== "review" && (
                <button
                  type="button"
                  className="primary"
                  data-testid="nav-to-review-button"
                  aria-label="Ir a revisar y cerrar semana"
                  onClick={() => onNavigateSpace?.("review")}
                >
                  Revisar y cerrar semana →
                </button>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* Capacidad y espacio protegido */}
      {plan?.proposal.weekSummary.capacity && (
        <CapacityProtectedSpaceSection capacity={plan.proposal.weekSummary.capacity} />
      )}

      {/* Schedule & Blocks */}
      {schedule && (activeSpace === undefined || activeSpace === "active") && (
        <ActiveWeekScheduleSection
          schedule={schedule}
          plan={plan}
          planItems={planItems}
          selectedAdjustmentItemId={selectedAdjustmentItemId}
          setSelectedAdjustmentItemId={setSelectedAdjustmentItemId}
          isAdjustmentOpen={isAdjustmentOpen}
          setIsAdjustmentOpen={setIsAdjustmentOpen}
          lastSavedAdjustment={lastSavedAdjustment}
          setLastSavedAdjustment={setLastSavedAdjustment}
          targetWeekStart={targetWeekStart}
          setTargetWeekStart={setTargetWeekStart}
          targetWeekEnd={targetWeekEnd}
          setTargetWeekEnd={setTargetWeekEnd}
          deadlineInput={deadlineInput}
          setDeadlineInput={setDeadlineInput}
          taskHoursInput={taskHoursInput}
          setTaskHoursInput={setTaskHoursInput}
          taskDayInput={taskDayInput}
          setTaskDayInput={setTaskDayInput}
          isAdjustmentPreviewOpen={isAdjustmentPreviewOpen}
          setIsAdjustmentPreviewOpen={setIsAdjustmentPreviewOpen}
          handleSaveTaskAdjustment={handleSaveTaskAdjustment}
          applyAdjustment={applyAdjustment}
          setFeedbackMessage={setFeedbackMessage}
        />
      )}

      {/* 📡 Radar de Imprevistos (Sección 21-25 PROJECT_CONTEXT) */}
      {plan && schedule && (activeSpace === undefined || activeSpace === "active") && (
        <UnforeseenRadarSection
          radarInput={radarInput}
          setRadarInput={setRadarInput}
          radarEvaluating={radarEvaluating}
          radarError={radarError}
          setRadarError={setRadarError}
          radarResult={radarResult}
          setRadarResult={setRadarResult}
          handleEvaluateRadar={handleEvaluateRadar}
          handleApplyRadarAdjustment={handleApplyRadarAdjustment}
          handleIncorporateRadarItems={handleIncorporateRadarItems}
          setFeedbackMessage={setFeedbackMessage}
        />
      )}

      {/* Schedule Adjustment History Section */}
      {schedule && (activeSpace === undefined || activeSpace === "active") && (
        <ScheduleAdjustmentHistorySection schedule={schedule} />
      )}

      {/* Review & Learning Sections (Review Space or Legacy Unified View) */}
      {(activeSpace === undefined || activeSpace === "review") && (
        <>
          {/* Close Week Section with Interactive Dispositions and Early Close Guard */}
          <WeeklyReflectiveClosingSection
            plan={plan}
            isEarlyCloseConfirmed={isEarlyCloseConfirmed}
            setIsEarlyCloseConfirmed={setIsEarlyCloseConfirmed}
            onNavigateSpace={onNavigateSpace}
            closeStep={closeStep}
            setCloseStep={setCloseStep}
            planItems={planItems}
            dispositions={dispositions}
            handleDispositionChange={handleDispositionChange}
            handlePostponementReasonChange={handlePostponementReasonChange}
            reflectionNotes={reflectionNotes}
            setReflectionNotes={setReflectionNotes}
            closeWeek={closeWeek}
            setFeedbackMessage={setFeedbackMessage}
          />

          {/* Confirmed Close Report Section (shown only after persistence) */}
          {state.latestCloseReport && (
            <ConfirmedCloseReportSection closeReport={state.latestCloseReport} />
          )}

          {/* Memory Candidates Review Section (Sovereignty Invariant) */}
          {renderMemoryCandidatesSection()}

          {/* Purge Week Option (Accessible in Review space or Legacy Unified View) */}
          <div
            style={{
              marginTop: "40px",
              borderTop: "1px solid var(--border-color)",
              paddingTop: "16px",
            }}
          >
            {isPurgeConfirming ? (
              <div
                className="status-message status-error"
                role="alert"
                aria-label="Confirmación para purgar semana"
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <p>
                  ¿Deseas purgar completamente esta semana y sus datos asociados? Esta acción
                  eliminará el plan, la agenda y reportes de la base de datos local y no se puede
                  deshacer.
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="primary"
                    style={{ backgroundColor: "#8c2a2a", borderColor: "#8c2a2a" }}
                    aria-label="Confirmar purga definitiva"
                    onClick={async () => {
                      if (plan) {
                        await purgeSession(plan.planId);
                        setIsPurgeConfirming(false);
                        setFeedbackMessage("Semana purgada.");
                      }
                    }}
                  >
                    Confirmar purga
                  </button>
                  <button
                    className="secondary"
                    aria-label="Cancelar purga"
                    onClick={() => setIsPurgeConfirming(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="secondary"
                style={{ color: "#8c2a2a", borderColor: "#f0d0d0" }}
                aria-label="Purgar semana actual"
                onClick={() => setIsPurgeConfirming(true)}
              >
                Purgar semana actual
              </button>
            )}
          </div>
        </>
      )}

      {/* Confirmed Active Memories (Visible in Active Week, Review, and Unified Spaces) */}
      {(activeSpace === "active" || activeSpace === "review" || activeSpace === undefined) && (
        <ConfirmedActiveMemoriesSection
          memories={state.memories}
          archiveMemory={archiveMemory}
          deleteMemory={deleteMemory}
        />
      )}

      {/* Plan New Week / Brain Dump (Accessible from active session in legacy unified view) */}
      {activeSpace === undefined && (
        <div
          style={{
            marginTop: "32px",
            borderTop: "1px solid var(--border-color)",
            paddingTop: "16px",
          }}
        >
          <details>
            <summary
              style={{
                cursor: "pointer",
                fontWeight: 600,
                color: "var(--text-color, #333)",
                fontSize: "1rem",
              }}
            >
              Capturar nuevas ideas o preparar la próxima semana
            </summary>
            <div style={{ marginTop: "12px" }}>
              <WeeklyPlanningFromNotes
                provider={provider}
                hasActivePlan={true}
                onPlanCreated={() => reloadSession()}
              />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
