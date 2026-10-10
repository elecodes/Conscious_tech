import { z } from "zod";
import { ExtractedItemSchema } from "./items";
import { RelationshipSchema } from "./relationships";
import { GroupedWorkSchema } from "./work-groups";
import { DetectedDeadlinesSchema } from "./deadlines";
import { EvaluateContextOutputSchema } from "./context";

export type { ExtractedItem } from "./items";
export type { Relationship } from "./relationships";
export type { GroupedWork, WorkGroup } from "./work-groups";
export type { DetectedDeadlines, DetectedDeadline } from "./deadlines";
export type {
  EvaluateContextOutput,
  ItemContextAssessment,
  GroupContextAssessment,
  OpenQuestion,
} from "./context";

// ============================================================================
// Date & Calendar Validation Utilities
// ============================================================================

/**
 * Validates that a string is a real Gregorian calendar date in ISO YYYY-MM-DD format.
 * Rejects invalid leap years, out-of-bounds days (e.g., February 30th), and invalid months.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function formatUtcIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const CalendarDateSchema = z
  .string()
  .refine(isValidCalendarDate, {
    message: "Must be a valid real ISO calendar date (YYYY-MM-DD)",
  });

export const TargetWeekSchema = z
  .object({
    startDate: CalendarDateSchema,
    endDate: CalendarDateSchema,
  })
  .refine((val) => val.startDate <= val.endDate, {
    message: "startDate must be before or equal to endDate",
  });
export type TargetWeek = z.infer<typeof TargetWeekSchema>;

/**
 * Resolves the default target week as the following natural week (Monday to Sunday)
 * calculated from currentDate.
 *
 * Examples:
 * - Friday 2026-10-09 -> Monday 2026-10-12 to Sunday 2026-10-18
 * - Sunday 2026-10-11 -> Monday 2026-10-12 to Sunday 2026-10-18
 * - Monday 2026-10-12 -> Monday 2026-10-19 to Sunday 2026-10-25
 * - Month transition: Thursday 2026-10-29 -> Monday 2026-11-02 to Sunday 2026-11-08
 * - Year transition: Friday 2026-12-25 -> Monday 2026-12-28 to Sunday 2027-01-03
 */
export function resolveDefaultTargetWeek(currentDate: string): TargetWeek {
  if (!isValidCalendarDate(currentDate)) {
    throw new Error(`Invalid currentDate: "${currentDate}"`);
  }
  const [y, m, d] = currentDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysToNextMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;

  const nextMonday = new Date(Date.UTC(y, m - 1, d + daysToNextMonday));
  const nextSunday = new Date(Date.UTC(y, m - 1, d + daysToNextMonday + 6));

  return {
    startDate: formatUtcIso(nextMonday),
    endDate: formatUtcIso(nextSunday),
  };
}

// ============================================================================
// Input Contract
// ============================================================================

export const DayConstraintSchema = z.object({
  day: z.string().min(1),
  availableHours: z.number().finite().nonnegative(),
  note: z.string().optional(),
});
export type DayConstraint = z.infer<typeof DayConstraintSchema>;

export const WeeklyCapacityConfigSchema = z.object({
  totalAvailableHours: z.number().finite().nonnegative().optional(),
  minProtectedSpaceRatio: z.number().finite().min(0).max(1).optional(),
  daysWithConstraints: z.array(DayConstraintSchema).optional(),
});
export type WeeklyCapacityConfig = z.infer<typeof WeeklyCapacityConfigSchema>;

export const BuildWeekInputSchema = z.object({
  currentDate: CalendarDateSchema,
  targetWeek: TargetWeekSchema.optional(),
  userIntent: z.string().optional(),
  items: z.array(ExtractedItemSchema),
  relationships: z.array(RelationshipSchema),
  groupedWork: GroupedWorkSchema,
  deadlines: DetectedDeadlinesSchema,
  context: EvaluateContextOutputSchema,
  capacity: WeeklyCapacityConfigSchema.optional(),
});
export type BuildWeekInput = z.infer<typeof BuildWeekInputSchema>;

// ============================================================================
// Output Contract: ProposedWeek
// ============================================================================

export const CapacityStatusSchema = z.enum(["within_capacity", "over_capacity", "unknown"]);
export type CapacityStatus = z.infer<typeof CapacityStatusSchema>;

export const ProtectedSpaceStatusSchema = z.enum(["respected", "compromised", "unknown"]);
export type ProtectedSpaceStatus = z.infer<typeof ProtectedSpaceStatusSchema>;

export const EstimationCompletenessSchema = z.enum(["complete", "partial", "none"]);
export type EstimationCompleteness = z.infer<typeof EstimationCompletenessSchema>;

export const WeeklyCapacitySummarySchema = z.object({
  totalAvailableHours: z.number().finite().nonnegative().nullable(),
  plannableHours: z.number().finite().nonnegative().nullable(),
  plannedHours: z.number().finite().nonnegative().nullable(),
  knownEstimatedHours: z.number().finite().nonnegative().nullable(),
  estimationCompleteness: EstimationCompletenessSchema,
  protectedSpaceHours: z.number().finite().nonnegative().nullable(),
  capacityStatus: CapacityStatusSchema,
  protectedSpaceStatus: ProtectedSpaceStatusSchema,
}).strict();
export type WeeklyCapacitySummary = z.infer<typeof WeeklyCapacitySummarySchema>;

export const WeekSummarySchema = z.object({
  targetWeek: TargetWeekSchema,
  intent: z.string().optional(),
  capacity: WeeklyCapacitySummarySchema,
}).strict();
export type WeekSummary = z.infer<typeof WeekSummarySchema>;

export const WeeklyFocusSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  groupId: z.string().min(1).optional(),
  desiredOutcome: z.string().min(1),
  rationale: z.string().min(1),
  contributingItemIds: z.array(z.string().min(1)).min(1),
  estimatedHours: z.number().finite().nonnegative().nullable(),
}).strict();
export type WeeklyFocus = z.infer<typeof WeeklyFocusSchema>;

export const ObligationCommitmentTypeSchema = z.enum(["external", "strict_deadline"]);
export type ObligationCommitmentType = z.infer<typeof ObligationCommitmentTypeSchema>;

export const WeeklyObligationSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  dueDate: z.string().min(1).optional(),
  commitmentType: ObligationCommitmentTypeSchema,
  rationale: z.string().min(1),
  estimatedHours: z.number().finite().nonnegative().nullable(),
}).strict();
export type WeeklyObligation = z.infer<typeof WeeklyObligationSchema>;

export const WeeklyFlexibleOptionSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  condition: z.string().min(1).optional(),
  estimatedHours: z.number().finite().nonnegative().nullable(),
}).strict();
export type WeeklyFlexibleOption = z.infer<typeof WeeklyFlexibleOptionSchema>;

export const DeferredReasonSchema = z.enum([
  "out_of_capacity",
  "low_attention",
  "waiting_dependency",
  "archived",
  "intentional_postponement",
  "not_scheduled",
]);
export type DeferredReason = z.infer<typeof DeferredReasonSchema>;

export const DeferredItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1),
  reason: DeferredReasonSchema,
  rationale: z.string().min(1),
}).strict();
export type DeferredItem = z.infer<typeof DeferredItemSchema>;

export const UnplannedSpaceSchema = z.object({
  rationale: z.string().min(1),
  recommendedHours: z.number().finite().nonnegative().nullable(),
}).strict();
export type UnplannedSpace = z.infer<typeof UnplannedSpaceSchema>;

export const ConfirmationPromptSchema = z.object({
  question: z.string().min(1),
  keyTradeoffs: z.array(z.string().min(1)),
  pendingQuestions: z.array(z.string().min(1)).max(2),
}).strict();
export type ConfirmationPrompt = z.infer<typeof ConfirmationPromptSchema>;

export const ProposedWeekSchema = z.object({
  weekSummary: WeekSummarySchema,
  foci: z.array(WeeklyFocusSchema).max(3),
  obligations: z.array(WeeklyObligationSchema),
  flexibleOptions: z.array(WeeklyFlexibleOptionSchema),
  deferredItems: z.array(DeferredItemSchema),
  unplannedSpace: UnplannedSpaceSchema,
  confirmationPrompt: ConfirmationPromptSchema,
}).strict();
export type ProposedWeek = z.infer<typeof ProposedWeekSchema>;

// ============================================================================
// Invariant Cross-Validation Engine
// ============================================================================

export interface WeekInvariantValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates cross-domain structural and business invariants between input and proposed week:
 * 1. 100% Item Conservation: every input item must appear exactly once across foci, obligations, flexibleOptions, or deferredItems.
 * 2. Focus Limits: between 0 and 3 foci allowed.
 * 3. Group and Item Reference Integrity: no phantom item IDs or group IDs.
 * 4. Capacity and Protected Space sanity:
 *    - Plannable hours computation.
 *    - Over-capacity consistency.
 * 5. Category Exclusivity: an item cannot be assigned to multiple categories.
 * 6. Empty Input Guarantee: empty input yields a zero-item proposal without spurious content.
 */
export function validateProposedWeekInvariants(
  proposal: ProposedWeek,
  input: BuildWeekInput
): WeekInvariantValidationResult {
  const errors: string[] = [];

  const inputItemIds = new Set(input.items.map((i) => i.id));
  const inputGroupIds = new Set(input.groupedWork.groups.map((g) => g.id));

  // 1. Focus Count Rule (0 <= foci.length <= 3)
  if (proposal.foci.length > 3) {
    errors.push(`Maximum 3 foci allowed; received ${proposal.foci.length}`);
  }

  // 2. Group ID Reference Integrity in Foci
  for (const focus of proposal.foci) {
    if (focus.groupId && !inputGroupIds.has(focus.groupId)) {
      errors.push(`Focus "${focus.id}" references nonexistent groupId "${focus.groupId}"`);
    }
  }

  // 3. Item Conservation and Category Exclusivity Tracking
  const itemAssignments = new Map<string, string[]>();

  const registerAssignment = (itemId: string, category: string) => {
    if (!itemAssignments.has(itemId)) {
      itemAssignments.set(itemId, []);
    }
    itemAssignments.get(itemId)!.push(category);
  };

  // Track foci contributing items
  for (const focus of proposal.foci) {
    for (const itemId of focus.contributingItemIds) {
      registerAssignment(itemId, `focus:${focus.id}`);
    }
  }

  // Track obligations
  for (const ob of proposal.obligations) {
    registerAssignment(ob.itemId, "obligation");
  }

  // Track flexible options
  for (const opt of proposal.flexibleOptions) {
    registerAssignment(opt.itemId, "flexibleOption");
  }

  // Track deferred items
  for (const def of proposal.deferredItems) {
    registerAssignment(def.itemId, "deferredItem");
  }

  // A. Check for phantom items (items in proposal not present in input)
  for (const [itemId, categories] of itemAssignments.entries()) {
    if (!inputItemIds.has(itemId)) {
      errors.push(`Phantom itemId "${itemId}" found in categories: ${categories.join(", ")}`);
    }
  }

  // B. Check for duplicate/overlapping assignments
  for (const [itemId, categories] of itemAssignments.entries()) {
    if (categories.length > 1) {
      errors.push(`Item "${itemId}" is assigned to multiple categories: ${categories.join(", ")}`);
    }
  }

  // C. Check for lost items (items in input missing from proposal)
  for (const item of input.items) {
    if (!itemAssignments.has(item.id)) {
      errors.push(`Input item "${item.id}" (${item.title}) is not accounted for in any proposal category`);
    }
  }

  // 4. Capacity and Protected Space Checks
  const cap = input.capacity;
  const propCap = proposal.weekSummary.capacity;

  if (cap?.totalAvailableHours != null) {
    const total = cap.totalAvailableHours;
    const ratio = cap.minProtectedSpaceRatio ?? 0.25;
    const expectedPlannable = Math.round((total * (1 - ratio)) * 100) / 100;

    if (propCap.totalAvailableHours !== total) {
      errors.push(
        `Capacity totalAvailableHours mismatch: expected ${total}, received ${propCap.totalAvailableHours}`
      );
    }

    if (propCap.plannableHours != null) {
      const diff = Math.abs(propCap.plannableHours - expectedPlannable);
      if (diff > 0.05) {
        errors.push(
          `plannableHours mismatch: expected ~${expectedPlannable} (ratio ${ratio}), received ${propCap.plannableHours}`
        );
      }
    }

    // Rules for estimation completeness and honesty
    if (propCap.estimationCompleteness !== "complete") {
      if (propCap.plannedHours !== null) {
        errors.push(
          `plannedHours must be null when estimationCompleteness is "${propCap.estimationCompleteness}"; partial sums belong to knownEstimatedHours`
        );
      }
      if (propCap.capacityStatus === "within_capacity") {
        errors.push(
          `Cannot declare capacityStatus "within_capacity" when estimationCompleteness is "${propCap.estimationCompleteness}"`
        );
      }
      if (propCap.protectedSpaceStatus === "respected") {
        errors.push(
          `Cannot declare protectedSpaceStatus "respected" when estimationCompleteness is "${propCap.estimationCompleteness}"`
        );
      }
    } else {
      if (propCap.plannedHours !== propCap.knownEstimatedHours) {
        errors.push(
          `plannedHours (${propCap.plannedHours}) must match knownEstimatedHours (${propCap.knownEstimatedHours}) when estimationCompleteness is "complete"`
        );
      }
    }

    // Known estimated hours exceeding plannable capacity
    if (propCap.knownEstimatedHours != null && propCap.plannableHours != null) {
      if (propCap.knownEstimatedHours > propCap.plannableHours) {
        if (propCap.capacityStatus !== "over_capacity") {
          errors.push(
            `knownEstimatedHours (${propCap.knownEstimatedHours}) > plannableHours (${propCap.plannableHours}), capacityStatus must be "over_capacity"`
          );
        }
        if (propCap.protectedSpaceStatus !== "compromised") {
          errors.push(
            `knownEstimatedHours (${propCap.knownEstimatedHours}) > plannableHours (${propCap.plannableHours}), protectedSpaceStatus must be "compromised"`
          );
        }
      }
    }

    // Obligations alone overload check
    const obligationHours = proposal.obligations.reduce(
      (sum, ob) => sum + (ob.estimatedHours ?? 0),
      0
    );
    if (propCap.plannableHours != null && obligationHours > propCap.plannableHours) {
      if (propCap.capacityStatus !== "over_capacity") {
        errors.push(
          `Obligations alone (${obligationHours}h) exceed plannableHours (${propCap.plannableHours}h); capacityStatus must be "over_capacity"`
        );
      }
    }
  } else {
    // If no total available hours provided, capacityStatus cannot be "within_capacity" based on assumptions
    if (propCap.totalAvailableHours !== null) {
      errors.push(
        `Invented totalAvailableHours: input did not provide hours, but output has ${propCap.totalAvailableHours}`
      );
    }
    if (propCap.capacityStatus !== "unknown") {
      errors.push(
        `Inconsistent capacityStatus: totalAvailableHours is unknown, so status must be "unknown", received "${propCap.capacityStatus}"`
      );
    }
    if (propCap.protectedSpaceStatus !== "unknown") {
      errors.push(
        `Inconsistent protectedSpaceStatus: totalAvailableHours is unknown, so status must be "unknown", received "${propCap.protectedSpaceStatus}"`
      );
    }
  }

  // 5. Empty Input Contract Guarantee
  if (input.items.length === 0) {
    if (proposal.foci.length > 0) errors.push("Empty input must not yield foci");
    if (proposal.obligations.length > 0) errors.push("Empty input must not yield obligations");
    if (proposal.flexibleOptions.length > 0) errors.push("Empty input must not yield flexibleOptions");
    if (proposal.deferredItems.length > 0) errors.push("Empty input must not yield deferredItems");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Creates a deterministic canonical empty ProposedWeek contract for zero-item inputs.
 */
export function createEmptyProposedWeek(
  currentDate: string,
  targetWeek?: { startDate: string; endDate: string }
): ProposedWeek {
  const defaultWeek = targetWeek ?? resolveDefaultTargetWeek(currentDate);

  return {
    weekSummary: {
      targetWeek: defaultWeek,
      intent: undefined,
      capacity: {
        totalAvailableHours: null,
        plannableHours: null,
        plannedHours: null,
        knownEstimatedHours: null,
        estimationCompleteness: "none",
        protectedSpaceHours: null,
        capacityStatus: "unknown",
        protectedSpaceStatus: "unknown",
      },
    },
    foci: [],
    obligations: [],
    flexibleOptions: [],
    deferredItems: [],
    unplannedSpace: {
      rationale: "Semana sin elementos pendientes; todo el espacio está disponible y protegido.",
      recommendedHours: null,
    },
    confirmationPrompt: {
      question: "¿Querés agregar algún foco o volcar nuevas notas para esta semana?",
      keyTradeoffs: [],
      pendingQuestions: [],
    },
  };
}
