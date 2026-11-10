import { TargetWeekSchema, WeeklyCapacityConfigSchema } from "../domain/week";

export interface PlanningContextInputs {
  targetWeekStart: string;
  targetWeekEnd: string;
  availableHoursInput: string;
  protectedSpacePercentInput: string;
}

export const STORAGE_KEY_PLANNING_CONTEXT = "conscious_tech_transient_planning_context";

export function parsePlanningContext(inputs: PlanningContextInputs) {
  const targetWeek = TargetWeekSchema.safeParse({
    startDate: inputs.targetWeekStart,
    endDate: inputs.targetWeekEnd,
  });
  if (!targetWeek.success) {
    throw new Error("Elige fechas válidas: el inicio debe ser anterior o igual al final.");
  }
  const capacity = WeeklyCapacityConfigSchema.safeParse({
    totalAvailableHours:
      inputs.availableHoursInput.trim() === "" ? undefined : Number(inputs.availableHoursInput),
    minProtectedSpaceRatio:
      inputs.protectedSpacePercentInput.trim() === ""
        ? 0.25
        : Number(inputs.protectedSpacePercentInput) / 100,
  });
  if (!capacity.success) {
    throw new Error("Indica horas válidas (0 o más) y un espacio protegido entre 0 y 100 %.");
  }
  return { targetWeek: targetWeek.data, capacity: capacity.data };
}

export function readPlanningContext(): PlanningContextInputs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PLANNING_CONTEXT);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const input = value as Record<string, unknown>;
    if (
      ![
        "targetWeekStart",
        "targetWeekEnd",
        "availableHoursInput",
        "protectedSpacePercentInput",
      ].every((key) => typeof input[key] === "string")
    )
      return null;
    const context = input as unknown as PlanningContextInputs;
    parsePlanningContext(context);
    return context;
  } catch {
    return null;
  }
}
