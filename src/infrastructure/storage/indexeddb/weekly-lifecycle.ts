import { ItemOutcomeInput } from "../../../domain/item-outcome";
import {
  StoredWeeklyPlanSchema,
  StoredCloseWeekReportSchema,
} from "../../../domain/repositories/types";
import { WeeklyScheduleSchema, validateWeeklyScheduleInvariants } from "../../../domain/schedule";
import { executeCloseWeekDeterministic } from "../../../skills/close-week/deterministic";
import type {
  CloseWeekParams,
  CloseWeekServiceResult,
  ReopenWeekResult,
} from "../../../application/weekly-session-service-types";
import { STORES, wrapRequest, waitForTransaction } from "./database";

export async function closeWeekAtomically(
  db: IDBDatabase,
  params: CloseWeekParams
): Promise<CloseWeekServiceResult> {
  const tx = db.transaction([STORES.PLANS, STORES.SCHEDULES, STORES.CLOSE_REPORTS], "readwrite");
  const done = waitForTransaction(tx);
  void done.catch(() => {});
  try {
    const plans = tx.objectStore(STORES.PLANS);
    const reports = tx.objectStore(STORES.CLOSE_REPORTS);
    const rawPlan = await wrapRequest(plans.get(params.planId));
    if (!rawPlan) {
      await done;
      return { status: "not_found", reason: "No se encontró la semana." };
    }
    const plan = StoredWeeklyPlanSchema.parse(rawPlan);
    const rawReport = await wrapRequest(reports.index("by_plan_id").get(params.planId));
    if (plan.status === "closed" && rawReport) {
      const report = StoredCloseWeekReportSchema.parse(rawReport);
      await done;
      return {
        status: "success",
        closeReport: report,
        memoryCandidates: report.output.memoryCandidates,
      };
    }
    if (plan.status !== "active") throw new Error("La semana ya no está activa.");
    const rawSchedule = await wrapRequest(
      tx.objectStore(STORES.SCHEDULES).index("by_plan_id").get(params.planId)
    );
    const schedule = rawSchedule ? WeeklyScheduleSchema.parse(rawSchedule) : undefined;
    if (schedule && !validateWeeklyScheduleInvariants(schedule).valid)
      throw new Error("La agenda guardada necesita revisión.");
    if (
      params.expectedScheduleVersion !== undefined &&
      schedule?.version !== params.expectedScheduleVersion
    )
      throw new Error(
        "La semana cambió mientras revisabas el cierre. Recarga y revisa los resultados antes de cerrar."
      );
    if (
      schedule &&
      (schedule.weekRange.startDate !== plan.targetWeek.startDate ||
        schedule.weekRange.endDate !== plan.targetWeek.endDate)
    )
      throw new Error("El rango de la agenda no coincide con la semana.");
    const explicit = new Set(params.itemOutcomes.map((outcome) => outcome.itemId));
    const unreviewed = new Set(params.unreviewedItemIds ?? []);
    const outcomes = [
      ...(schedule?.itemActivity?.outcomes ?? []).filter(
        (outcome) => !explicit.has(outcome.itemId) && !unreviewed.has(outcome.itemId)
      ),
      ...params.itemOutcomes,
    ];
    const postponedIds = new Set(
      schedule?.appliedAdjustments
        .filter(
          (record) =>
            record.action.type === "postpone_item" &&
            record.humanDecision === "accepted" &&
            record.applicationOutcome === "applied" &&
            record.lifecycleStatus === "active"
        )
        .map((record) => (record.action.type === "postpone_item" ? record.action.itemId : "")) ?? []
    );
    if (
      outcomes.some(
        (outcome) => postponedIds.has(outcome.itemId) && outcome.status !== "consciously_postponed"
      )
    )
      throw new Error(
        "Hay una postergación vigente que contradice el resultado. Revisa esa decisión antes de cerrar."
      );
    const output = executeCloseWeekDeterministic({
      closedAt: params.closedAt,
      activePlan: plan.proposal,
      schedule,
      itemOutcomes: outcomes,
      userReflection: params.userReflection,
    });
    const report = StoredCloseWeekReportSchema.parse({
      reportId: `close-${plan.planId}-${params.closedAt}`,
      planId: plan.planId,
      scheduleId: schedule?.scheduleId,
      closedAt: params.closedAt,
      output,
    });
    reports.put(report);
    plans.put({ ...plan, status: "closed", updatedAt: report.closedAt });
    await done;
    return { status: "success", closeReport: report, memoryCandidates: output.memoryCandidates };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already ended. */
    }
    await done.catch(() => {});
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "No se pudo guardar el cierre.",
    };
  }
}

export async function reopenWeekAtomically(
  db: IDBDatabase,
  planId: string
): Promise<ReopenWeekResult> {
  const tx = db.transaction([STORES.PLANS, STORES.SCHEDULES, STORES.CLOSE_REPORTS], "readwrite");
  const done = waitForTransaction(tx);
  void done.catch(() => {});
  try {
    const plans = tx.objectStore(STORES.PLANS);
    const reports = tx.objectStore(STORES.CLOSE_REPORTS);
    const schedules = tx.objectStore(STORES.SCHEDULES);
    const rawPlan = await wrapRequest(plans.get(planId));
    if (!rawPlan) {
      await done;
      return { status: "not_found", reason: "No se encontró la semana." };
    }
    const plan = StoredWeeklyPlanSchema.parse(rawPlan);
    if (plan.status !== "closed") {
      await done;
      return { status: "not_closed", reason: "La semana no está cerrada." };
    }
    const active = await wrapRequest(plans.index("by_status").getAll("active"));
    const other = active.find((candidate) => candidate.planId !== planId);
    if (other) {
      await done;
      return { status: "conflict_active_plan_exists", existingActivePlanId: other.planId };
    }
    const rawReport = await wrapRequest(reports.index("by_plan_id").get(planId));
    const rawSchedule = await wrapRequest(schedules.index("by_plan_id").get(planId));
    const now = new Date().toISOString();
    if (rawReport) {
      const report = StoredCloseWeekReportSchema.parse(rawReport);
      if (!rawSchedule && report.scheduleId)
        throw new Error("Falta la agenda referenciada por el cierre.");
      const restoredScheduleId = `reopened-schedule-${planId}`;
      if (!rawSchedule && (await wrapRequest(schedules.get(restoredScheduleId))))
        throw new Error("Ya existe otra agenda con ese identificador.");
      const schedule = WeeklyScheduleSchema.parse(
        rawSchedule ?? {
          scheduleId: restoredScheduleId,
          planId,
          weekRange: plan.targetWeek,
          timeBlocks: [],
          dailyAllocations: [],
          appliedAdjustments: [],
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
      );
      if (
        (report.scheduleId && report.scheduleId !== schedule.scheduleId) ||
        schedule.weekRange.startDate !== plan.targetWeek.startDate ||
        schedule.weekRange.endDate !== plan.targetWeek.endDate ||
        !validateWeeklyScheduleInvariants(schedule).valid
      )
        throw new Error("Los datos del cierre y la agenda no coinciden.");
      const outcomes: ItemOutcomeInput[] = report.output.classifiedItems.flatMap((item) =>
        item.finalDisposition === "unreported"
          ? []
          : [
              {
                itemId: item.itemId,
                status: item.finalDisposition,
                ...(item.actualHours != null ? { actualHours: item.actualHours } : {}),
                ...(item.userNotes ? { userNotes: item.userNotes } : {}),
                ...(item.postponementReason ? { postponementReason: item.postponementReason } : {}),
              },
            ]
      );
      const version = rawSchedule ? schedule.version + 1 : 1;
      const updated = WeeklyScheduleSchema.parse({
        ...schedule,
        version,
        updatedAt: now,
        itemActivity: {
          outcomes,
          history: schedule.itemActivity?.history ?? [],
          reviewCheckpoint: {
            reportId: report.reportId,
            appliedVersion: version,
            before: schedule.itemActivity?.outcomes ?? [],
            after: outcomes,
          },
        },
      });
      schedules.put(updated);
    }
    if (rawReport) reports.delete(rawReport.reportId);
    const updatedPlan = { ...plan, status: "active" as const, updatedAt: now };
    plans.put(updatedPlan);
    await done;
    return { status: "success", plan: updatedPlan };
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already ended. */
    }
    await done.catch(() => {});
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "No se pudo reabrir la semana.",
    };
  }
}
