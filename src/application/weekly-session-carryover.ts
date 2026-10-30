import {
  WeeklySessionServiceDependencies,
  LatestClosedWeekResult,
  PendingCarryOverTask,
} from "./weekly-session-service-types";
import { TargetWeek } from "../domain/week";
import { WeeklySchedule } from "../domain/schedule";

export async function findLatestClosedWeek(
  deps: WeeklySessionServiceDependencies
): Promise<LatestClosedWeekResult> {
  const allReports = await deps.closeReports.getAll();
  if (allReports.length === 0) {
    return { status: "none" };
  }

  // Deterministic ordering
  const sortedReports = [...allReports].sort((a, b) => {
    const timeCmp = b.closedAt.localeCompare(a.closedAt);
    if (timeCmp !== 0) return timeCmp;
    return b.reportId.localeCompare(a.reportId);
  });

  const latestReport = sortedReports[0]!;
  const plan = await deps.plans.getById(latestReport.planId);
  if (!plan) {
    return {
      status: "inconsistent",
      reason: `Close report "${latestReport.reportId}" references non-existent planId "${latestReport.planId}"`,
    };
  }

  if (latestReport.planId !== plan.planId) {
    return {
      status: "inconsistent",
      reason: `Close report planId "${latestReport.planId}" does not match plan "${plan.planId}"`,
    };
  }

  let schedule: WeeklySchedule | null = null;
  if (latestReport.scheduleId) {
    const foundSchedule = await deps.schedules.getById(latestReport.scheduleId);
    if (!foundSchedule) {
      return {
        status: "inconsistent",
        reason: `Close report references scheduleId "${latestReport.scheduleId}" which does not exist in storage`,
      };
    }
    if (foundSchedule.planId !== plan.planId) {
      return {
        status: "inconsistent",
        reason: `Schedule "${foundSchedule.scheduleId}" references planId "${foundSchedule.planId}", expected "${plan.planId}"`,
      };
    }
    if (
      foundSchedule.weekRange.startDate !== plan.targetWeek.startDate ||
      foundSchedule.weekRange.endDate !== plan.targetWeek.endDate
    ) {
      return {
        status: "inconsistent",
        reason: `Schedule weekRange (${foundSchedule.weekRange.startDate}..${foundSchedule.weekRange.endDate}) does not match plan targetWeek (${plan.targetWeek.startDate}..${plan.targetWeek.endDate})`,
      };
    }
    schedule = foundSchedule;
  } else {
    const foundSchedule = await deps.schedules.getByPlanId(plan.planId);
    if (foundSchedule) {
      if (foundSchedule.planId !== plan.planId) {
        return {
          status: "inconsistent",
          reason: `Schedule references planId "${foundSchedule.planId}", expected "${plan.planId}"`,
        };
      }
      if (
        foundSchedule.weekRange.startDate !== plan.targetWeek.startDate ||
        foundSchedule.weekRange.endDate !== plan.targetWeek.endDate
      ) {
        return {
          status: "inconsistent",
          reason: `Schedule weekRange does not match plan targetWeek`,
        };
      }
      schedule = foundSchedule;
    }
  }

  return {
    status: "found",
    summary: {
      plan,
      closeReport: latestReport,
      schedule,
    },
  };
}

export async function findPendingCarryOverTasks(
  deps: WeeklySessionServiceDependencies,
  targetWeek: TargetWeek
): Promise<PendingCarryOverTask[]> {
  const resultsMap = new Map<string, PendingCarryOverTask>();

  // --- Fuente 1: Informes de cierre persistidos ---
  const closedSummaryRes = await findLatestClosedWeek(deps);
  if (closedSummaryRes.status === "found") {
    const { plan, closeReport, schedule } = closedSummaryRes.summary;
    const carryOverCandidates = closeReport.output.itemDispositions.carryOverCandidates || [];

    // Index metadata from closed plan
    const closedPlanItemMap = new Map<
      string,
      { dueDate?: string; estimatedHours?: number | null }
    >();
    for (const ob of plan.proposal.obligations) {
      closedPlanItemMap.set(ob.itemId, {
        dueDate: ob.dueDate,
        estimatedHours: ob.estimatedHours,
      });
    }
    for (const fl of plan.proposal.flexibleOptions) {
      closedPlanItemMap.set(fl.itemId, {
        estimatedHours: fl.estimatedHours,
      });
    }
    for (const fo of plan.proposal.foci) {
      for (const id of fo.contributingItemIds) {
        if (!closedPlanItemMap.has(id)) {
          closedPlanItemMap.set(id, {
            estimatedHours: fo.estimatedHours,
          });
        }
      }
    }

    // Index schedule adjustments from closed week
    const closedAdjustmentMap = new Map<string, TargetWeek>();
    if (schedule && schedule.appliedAdjustments) {
      for (const adj of schedule.appliedAdjustments) {
        if (
          adj.action.type === "postpone_item" &&
          adj.humanDecision === "accepted" &&
          adj.applicationOutcome === "applied" &&
          adj.lifecycleStatus === "active" &&
          adj.action.targetWeek
        ) {
          closedAdjustmentMap.set(adj.action.itemId, adj.action.targetWeek);
        }
      }
    }

    for (const candidate of carryOverCandidates) {
      if (
        candidate.reason !== "consciously_postponed" &&
        candidate.reason !== "in_progress" &&
        candidate.reason !== "not_started" &&
        candidate.reason !== "not_scheduled"
      ) {
        continue;
      }

      const explicitTarget = closedAdjustmentMap.get(candidate.itemId);
      if (explicitTarget) {
        const matches =
          explicitTarget.startDate === targetWeek.startDate &&
          explicitTarget.endDate === targetWeek.endDate;
        if (!matches) {
          continue;
        }
      }

      const meta = closedPlanItemMap.get(candidate.itemId);
      resultsMap.set(candidate.itemId, {
        itemId: candidate.itemId,
        title: candidate.title,
        originCategory: candidate.originCategory,
        postponementReason: candidate.details,
        targetWeek: explicitTarget,
        dueDate: meta?.dueDate,
        estimatedHours: meta?.estimatedHours,
      });
    }
  }

  // --- Fuente 2: Postergaciones en agendas activas persistidas ---
  const activePlans = await deps.plans.getActivePlans();
  for (const activePlan of activePlans) {
    const activeSchedule = await deps.schedules.getByPlanId(activePlan.planId);
    if (!activeSchedule || !activeSchedule.appliedAdjustments) continue;

    // Index metadata from active plan
    const activePlanItemMap = new Map<
      string,
      { title: string; originCategory: string; dueDate?: string; estimatedHours?: number | null }
    >();
    for (const ob of activePlan.proposal.obligations) {
      activePlanItemMap.set(ob.itemId, {
        title: ob.title,
        originCategory: "obligation",
        dueDate: ob.dueDate,
        estimatedHours: ob.estimatedHours,
      });
    }
    for (const fl of activePlan.proposal.flexibleOptions) {
      activePlanItemMap.set(fl.itemId, {
        title: fl.title,
        originCategory: "flexible_option",
        estimatedHours: fl.estimatedHours,
      });
    }
    for (const fo of activePlan.proposal.foci) {
      for (const id of fo.contributingItemIds) {
        if (!activePlanItemMap.has(id)) {
          activePlanItemMap.set(id, {
            title: fo.title,
            originCategory: "focus",
            estimatedHours: fo.estimatedHours,
          });
        }
      }
    }
    for (const def of activePlan.proposal.deferredItems) {
      if (!activePlanItemMap.has(def.itemId)) {
        activePlanItemMap.set(def.itemId, {
          title: def.title,
          originCategory: "deferred",
        });
      }
    }

    for (const adj of activeSchedule.appliedAdjustments) {
      if (
        adj.action.type === "postpone_item" &&
        adj.humanDecision === "accepted" &&
        adj.applicationOutcome === "applied" &&
        adj.lifecycleStatus === "active"
      ) {
        const itemId = adj.action.itemId;
        const explicitTarget = adj.action.targetWeek;

        if (explicitTarget) {
          const matches =
            explicitTarget.startDate === targetWeek.startDate &&
            explicitTarget.endDate === targetWeek.endDate;
          if (!matches) {
            continue;
          }
        }

        const meta = activePlanItemMap.get(itemId);
        const title = meta?.title || `Tarea ${itemId}`;
        const originCategory = meta?.originCategory || "deferred";
        const postponementReason =
          adj.action.rationale ||
          `Postergación acordada para ${explicitTarget?.startDate ?? "siguiente ciclo"}`;

        resultsMap.set(itemId, {
          itemId,
          title,
          originCategory,
          postponementReason,
          targetWeek: explicitTarget,
          dueDate: meta?.dueDate,
          estimatedHours: meta?.estimatedHours,
        });
      }
    }
  }

  return Array.from(resultsMap.values());
}
