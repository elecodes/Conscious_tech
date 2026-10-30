import {
  isValidCalendarDate,
  resolveDefaultTargetWeek,
  TargetWeek,
  TargetWeekSchema,
  WeeklyCapacityConfig,
  WeeklyCapacitySummary,
  EstimationCompleteness,
  ExtractedItem,
} from "../../../domain/week";

export class WeekValidationError extends Error {
  public issues: unknown[];

  constructor(message: string, issues: unknown[] = []) {
    super(message);
    this.name = "WeekValidationError";
    this.issues = issues;
  }
}

/**
 * Pure function to resolve the target planning week.
 */
export function resolveTargetWeek(
  currentDate: string,
  targetWeek?: TargetWeek
): TargetWeek {
  if (!isValidCalendarDate(currentDate)) {
    throw new WeekValidationError(
      `Invalid currentDate: "${currentDate}". Must be a valid ISO YYYY-MM-DD date.`
    );
  }

  if (targetWeek) {
    const parseResult = TargetWeekSchema.safeParse(targetWeek);
    if (!parseResult.success) {
      throw new WeekValidationError(
        `Invalid targetWeek: startDate must be <= endDate and both must be real ISO calendar dates.`,
        parseResult.error.issues
      );
    }
    return parseResult.data;
  }

  return resolveDefaultTargetWeek(currentDate);
}

export function extractItemHours(item: ExtractedItem): number | null {
  if (!item.estimatedEffort || typeof item.estimatedEffort.value !== "number") {
    return null;
  }
  const { value, unit } = item.estimatedEffort;
  if (value <= 0 || !Number.isFinite(value)) return null;
  if (unit === "hours") return value;
  if (unit === "minutes") return Math.round((value / 60) * 100) / 100;
  if (unit === "days") return value * 8;
  return null;
}

export function isDateInTargetWeek(dateStr: string | null | undefined, targetWeek: TargetWeek): boolean {
  if (!dateStr || !isValidCalendarDate(dateStr)) return false;
  return dateStr >= targetWeek.startDate && dateStr <= targetWeek.endDate;
}

export interface CalculateWeeklyCapacityParams {
  capacityConfig?: WeeklyCapacityConfig;
  foci?: Array<{ estimatedHours?: number | null }>;
  obligations?: Array<{ estimatedHours?: number | null }>;
  flexibleOptions?: Array<{ estimatedHours?: number | null }>;
  explicitKnownEstimatedHours?: number | null;
  explicitCompleteness?: EstimationCompleteness;
}

/**
 * Pure function to calculate weekly capacity and protected space summary.
 */
export function calculateWeeklyCapacity(
  params: CalculateWeeklyCapacityParams
): WeeklyCapacitySummary {
  const { capacityConfig, foci, obligations } = params;

  // 1. Resolve capacity boundaries
  const total = capacityConfig?.totalAvailableHours ?? null;
  const ratio = capacityConfig?.minProtectedSpaceRatio ?? 0.25;

  let plannableHours: number | null = null;
  let protectedSpaceHours: number | null = null;

  if (total != null) {
    protectedSpaceHours = Math.round(total * ratio * 100) / 100;
    plannableHours = Math.round(total * (1 - ratio) * 100) / 100;
  }

  // 2. Resolve estimated workload from foci, obligations, and flexible options
  let knownEstimatedHours: number | null = null;
  let estimationCompleteness: EstimationCompleteness = "none";

  if (params.explicitKnownEstimatedHours !== undefined) {
    knownEstimatedHours = params.explicitKnownEstimatedHours;
    estimationCompleteness = params.explicitCompleteness ?? "none";
  } else if (foci || obligations) {
    const plannedEntries = [...(foci ?? []), ...(obligations ?? [])];

    if (plannedEntries.length > 0) {
      let sum = 0;
      let nonNullCount = 0;

      for (const entry of plannedEntries) {
        if (typeof entry.estimatedHours === "number" && Number.isFinite(entry.estimatedHours)) {
          sum += entry.estimatedHours;
          nonNullCount++;
        }
      }

      if (nonNullCount === plannedEntries.length) {
        estimationCompleteness = "complete";
        knownEstimatedHours = Math.round(sum * 100) / 100;
      } else if (nonNullCount > 0) {
        estimationCompleteness = "partial";
        knownEstimatedHours = Math.round(sum * 100) / 100;
      } else {
        estimationCompleteness = "none";
        knownEstimatedHours = null;
      }
    }
  }

  // plannedHours is strictly null unless completeness is complete
  const plannedHours =
    estimationCompleteness === "complete" ? knownEstimatedHours : null;

  // 3. Resolve capacityStatus and protectedSpaceStatus
  if (total == null) {
    return {
      totalAvailableHours: null,
      plannableHours: null,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours: null,
      capacityStatus: "unknown",
      protectedSpaceStatus: "unknown",
    };
  }

  // Case: known estimated hours exceed plannable capacity
  if (
    knownEstimatedHours != null &&
    plannableHours != null &&
    knownEstimatedHours > plannableHours
  ) {
    return {
      totalAvailableHours: total,
      plannableHours,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours,
      capacityStatus: "over_capacity",
      protectedSpaceStatus: "compromised",
    };
  }

  // Case: complete estimations fitting within plannable capacity
  if (estimationCompleteness === "complete") {
    return {
      totalAvailableHours: total,
      plannableHours,
      plannedHours,
      knownEstimatedHours,
      estimationCompleteness,
      protectedSpaceHours,
      capacityStatus: "within_capacity",
      protectedSpaceStatus: "respected",
    };
  }

  // Case: incomplete or missing estimations fitting or unknown
  return {
    totalAvailableHours: total,
    plannableHours,
    plannedHours: null,
    knownEstimatedHours,
    estimationCompleteness,
    protectedSpaceHours,
    capacityStatus: "unknown",
    protectedSpaceStatus: "unknown",
  };
}
