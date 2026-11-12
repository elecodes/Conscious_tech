import { extractItemHours } from "../skills/build-week/deterministic";
import {
  WeeklySessionServiceDependencies,
  LatestClosedWeekResult,
  PendingCarryOverTask,
} from "./weekly-session-service-types";
import type { StoredCloseWeekReport, ClosedWeekSummary } from "../domain/repositories/types";
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

  return readClosedWeekSummary(deps, sortedReports[0]!);
}

async function readClosedWeekSummary(
  deps: WeeklySessionServiceDependencies,
  latestReport: StoredCloseWeekReport
): Promise<LatestClosedWeekResult> {
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

/** Read-only archive, independent of the current active session. */
export async function findClosedWeekHistory(deps: WeeklySessionServiceDependencies) {
  const [plans, reports] = await Promise.all([deps.plans.getAll(), deps.closeReports.getAll()]);
  const weeks: ClosedWeekSummary[] = [];
  const issues: { planId: string; week: TargetWeek; reason: string }[] = [];
  const closed = plans
    .filter((plan) => plan.status === "closed")
    .sort(
      (a, b) =>
        b.targetWeek.startDate.localeCompare(a.targetWeek.startDate) ||
        b.planId.localeCompare(a.planId)
    );
  for (const plan of closed) {
    const report = reports
      .filter((row) => row.planId === plan.planId)
      .sort(
        (a, b) => b.closedAt.localeCompare(a.closedAt) || b.reportId.localeCompare(a.reportId)
      )[0];
    if (
      !report ||
      report.output.status === "invalid_request" ||
      report.output.weekRange.startDate !== plan.targetWeek.startDate ||
      report.output.weekRange.endDate !== plan.targetWeek.endDate
    ) {
      issues.push({
        planId: plan.planId,
        week: plan.targetWeek,
        reason: report ? "inconsistent_close_report" : "missing_close_report",
      });
      continue;
    }
    const result = await readClosedWeekSummary(deps, report);
    if (result.status === "found" && result.summary.plan.status === "closed")
      weeks.push(result.summary);
    else
      issues.push({
        planId: plan.planId,
        week: plan.targetWeek,
        reason: result.status === "inconsistent" ? result.reason : "week_changed_during_read",
      });
  }
  return { weeks, issues };
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
            estimatedHours:
              fo.contributingItemIds.length === 1
                ? fo.estimatedHours
                : plan.draftContext?.extractedItems?.find((source) => source.id === id)
                  ? extractItemHours(
                      plan.draftContext.extractedItems.find((source) => source.id === id)!
                    )
                  : null,
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
  const resolvedActiveIds = new Set<string>();
  for (const activePlan of activePlans) {
    const activeSchedule = await deps.schedules.getByPlanId(activePlan.planId);
    if (!activeSchedule || !activeSchedule.appliedAdjustments) continue;
    for (const outcome of activeSchedule.itemActivity?.outcomes ?? []) {
      if (outcome.status === "completed" || outcome.status === "dropped")
        resolvedActiveIds.add(outcome.itemId);
    }

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
            title:
              activePlan.draftContext?.extractedItems?.find((source) => source.id === id)?.title ??
              fo.title,
            originCategory: "focus",
            estimatedHours:
              fo.contributingItemIds.length === 1
                ? fo.estimatedHours
                : activePlan.draftContext?.extractedItems?.find((source) => source.id === id)
                  ? extractItemHours(
                      activePlan.draftContext.extractedItems.find((source) => source.id === id)!
                    )
                  : null,
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
        const outcome = activeSchedule.itemActivity?.outcomes.find(
          (outcome) => outcome.itemId === itemId
        );
        if (outcome?.status === "completed" || outcome?.status === "dropped") continue;
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

  for (const itemId of resolvedActiveIds) resultsMap.delete(itemId);
  return Array.from(resultsMap.values());
}
