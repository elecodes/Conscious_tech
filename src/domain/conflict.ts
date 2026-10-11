import { z } from "zod";
import { ProposedWeekSchema, CalendarDateSchema, DayConstraintSchema } from "./week";
import { ExtractedItemSchema } from "./items";
import { RelationshipSchema } from "./relationships";
import { AnalyzeChangeOutputSchema } from "./change";

// ============================================================================
// Core Enums & Schemas
// ============================================================================

export const ConflictTypeSchema = z.enum([
  "capacity_deficit",        // Superávit imposible: horas requeridas > capacidad disponible (semanal o diaria)
  "blocked_by_dependency",   // Ítem activo depende de un prerrequisito postergado, archivado o no ejecutable
  "deadline_incompatibility",// Incompatibilidad temporal estricta demostrable en cadena o plazo vencido no ejecutable
  "schedule_overlap",        // Colisión horaria demostrable en la misma franja horaria
]);
export type ConflictType = z.infer<typeof ConflictTypeSchema>;

export const ConflictCertaintySchema = z.enum([
  "confirmed",               // Evidencia matemática, causal u horaria demostrada con datos completos
  "potential",               // Riesgo probable que depende de factores no formalizados o sin restricción dura
  "insufficient_information",// Tensión identificada pero faltan horas, fechas o estados para certificar colisión
]);
export type ConflictCertainty = z.infer<typeof ConflictCertaintySchema>;

export const ConflictScopeSchema = z.enum([
  "weekly",
  "daily",
  "task",
]);
export type ConflictScope = z.infer<typeof ConflictScopeSchema>;

export const ConflictEvidenceSchema = z.object({
  metric: z.enum([
    "hours_balance",
    "fixed_time_interval",
    "dependency_state",
    "calendar_dates",
  ]),
  description: z.string().min(1),
  availableOrRequired: z.string().or(z.number()),
  conflictingValue: z.string().or(z.number()),
}).strict();
export type ConflictEvidence = z.infer<typeof ConflictEvidenceSchema>;

export const DetectedConflictSchema = z.object({
  id: z.string().min(1),
  type: ConflictTypeSchema,
  certainty: ConflictCertaintySchema,
  scope: ConflictScopeSchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  involvedElementIds: z.array(z.string().min(1)).min(1),
  evidence: ConflictEvidenceSchema,
}).strict();
export type DetectedConflict = z.infer<typeof DetectedConflictSchema>;

export const UnconflictedAreaVerificationSchema = z.object({
  areaName: z.string().min(1),
  elementIds: z.array(z.string().min(1)),
  verificationReason: z.string().min(1),
}).strict();
export type UnconflictedAreaVerification = z.infer<typeof UnconflictedAreaVerificationSchema>;

// Context for explicit time blocks or event schedules (e.g., fixed interval meetings)
// Note: Intervals crossing midnight are outside the current day-scoped contract and not supported.
export const TimeBlockSchema = z
  .object({
    itemId: z.string().min(1),
    day: CalendarDateSchema,
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM format"),
    note: z.string().optional(),
  })
  .strict()
  .refine((val) => val.startTime < val.endTime, {
    message: "startTime must be strictly before endTime (intervals crossing midnight not supported)",
    path: ["endTime"],
  });
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

// Context for explicit day allocations (work explicitly scheduled for a specific day)
export const DailyWorkAllocationSchema = z.object({
  itemId: z.string().min(1),
  day: CalendarDateSchema,
  allocatedHours: z.number().finite().nonnegative(),
}).strict();
export type DailyWorkAllocation = z.infer<typeof DailyWorkAllocationSchema>;

// ============================================================================
// Input & Output Contracts
// ============================================================================

export const DetectConflictInputSchema = z.object({
  currentDate: CalendarDateSchema,
  activePlan: ProposedWeekSchema,
  changeAnalysis: AnalyzeChangeOutputSchema.optional(),
  items: z.array(ExtractedItemSchema).optional(),
  relationships: z.array(RelationshipSchema).optional(),
  dayConstraints: z.array(DayConstraintSchema).optional(),
  timeBlocks: z.array(TimeBlockSchema).optional(),
  dailyAllocations: z.array(DailyWorkAllocationSchema).optional(),
}).strict();
export type DetectConflictInput = z.infer<typeof DetectConflictInputSchema>;

export const DetectConflictOutputSchema = z.object({
  status: z.enum(["conflicts_detected", "no_conflicts", "potential_risks_only"]),
  summary: z.string().min(1),
  conflicts: z.array(DetectedConflictSchema),
  unconflictedAreas: z.array(UnconflictedAreaVerificationSchema),
  hasBlockingConflicts: z.boolean(),
}).strict();
export type DetectConflictOutput = z.infer<typeof DetectConflictOutputSchema>;
