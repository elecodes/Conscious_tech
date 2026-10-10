# ADR 0006: Functional Contract and Domain Model for Skill 06 (`build_week`)

- **Status:** Approved
- **Date:** 2026-10-09
- **Context:** Functional contract, domain modeling, and deterministic invariant engine for Skill 06 (`build_week`) prior to implementation of LLM prompts and planning engines.

---

## 1. Context and Problem Statement

Following the incremental pipeline of **Conscious Tech**:
1. **Skill 01 (`extract_items`)**: Faithfully extracts structured items from unstructured natural language brain dumps.
2. **Skill 02 (`detect_relationships`)**: Detects pairwise semantic links (`same_project`, `same_objective`, `part_of`, `depends_on`, `related_to`, `duplicate`).
3. **Skill 03 (`group_work`)**: Synthesizes items into coherent lines of attention (`WorkGroup[]` and `ungroupedItemIds`).
4. **Skill 04 (`detect_deadlines`)**: Extracts and normalizes temporal anchors (`DetectedDeadlines`) relative to an explicit calendar anchor.
5. **Skill 05 (`evaluate_context`)**: Evaluates situational gravity, attention levels (`high`, `medium`, `low`, `unclear`), factual signals, and open questions without building plans.

**Skill 06 (`build_week`)** represents the core transformation of the product: turning an evaluated brain dump into a **realistic, calm, and human-centered weekly focus proposal**.

### The Core Risk: AI Overreach, Premature Calendaring, and Toxic Productivity

When systems attempt weekly planning, they frequently succumb to classic anti-patterns:
- **Dictating an agenda**: Assuming the AI knows best, assigning tasks to rigid hourly calendar slots, and creating an overwhelming to-do list.
- **Equating situational attention to priority**: Treating an item marked `HIGH` in `evaluate_context` (e.g. an urgent 15-minute administrative deadline) as if it were a major creative focus structuring the whole week.
- **Full capacity illusion (100% planning)**: Planning every single available hour, leaving zero space for reality, interruptions, creative thinking, or rest.
- **Inventing missing parameters**: Hallucinating available hours (e.g. assuming 40 hours), fabricating durations, or assuming undisclosed user preferences.
- **Silent discard / ghosting**: Silently omitting tasks that don't fit into the week, leaving the user with nagging anxiety about what was forgotten.
- **Unilateral sacrifice**: Deciding on behalf of the user which external promise or project to abandon when there is an overload.

In strict alignment with our North Star:
> **AI proposes. The person decides.**
> **Space is part of the plan.**

Skill 06 must **propose a realistic, balanced perspective of the week**, leaving the ultimate decision and confirmation completely in the hands of the human.

---

## 2. Functional Responsibilities & Boundaries

### 2.1 What Skill 06 DOES

1. **Synthesizes Evaluated Context into a Weekly Center of Gravity**:
   - Identifies **0 to 3 primary foci** (`foci`) that represent meaningful areas of attention and desired outcomes for the week.
2. **Isolates Inescapable Commitments (`obligations`)**:
   - Explicitly extracts tasks with binding deadlines or external third-party promises that demand delivery during the target week.
3. **Curates Contingent Opportunities (`flexibleOptions`)**:
   - Keeps optional, exploratory, or low-pressure tasks visible as options if free time emerges, without creating guilt or pressure.
4. **Transparently Accounts for Non-Scheduled Work (`deferredItems`)**:
   - Every input item that does not enter the active week is explicitly cataloged with an honest, objective reason (`out_of_capacity`, `low_attention`, `waiting_dependency`, `archived`, `intentional_postponement`).
5. **Declares Protected Unplanned Space (`unplannedSpace`)**:
   - Treats uncommitted space (minimum 25–30% of available capacity) as a non-negotiable structural element of the plan.
6. **Humility and Confirmation (`confirmationPrompt`)**:
   - Submits the proposal to human approval with a clear question, transparent trade-offs, and at most two non-blocking clarifying questions.

### 2.2 What Skill 06 DOES NOT DO (Negative Constraints)

1. **Does NOT confirm the plan**: The output is strictly a `ProposedWeek`; it is not active until the person accepts it.
2. **Does NOT schedule days or hours**: It does not assign tasks to specific days (e.g. Monday morning) or time slots. Detailed calendar scheduling is downstream.
3. **Does NOT plan 100% capacity**: It strictly rejects filling all available hours with tasks.
4. **Does NOT invent capacity, estimates, or preferences**: If the user didn't mention hours or effort, hours remain `null` and capacity status remains `unknown`.
5. **Does NOT discard or postpone items silently**: Every input item is accounted for (100% item conservation).
6. **Does NOT convert ideas into actionable pressure**: Ideas and concerns remain exploratory or options; they are not forced into obligations.
7. **Does NOT unilaterally sacrifice overloaded obligations**: When commitments exceed capacity, the overload is made visible and the decision of what to renegotiate is left to the person.

---

## 3. Domain Model Specification (`src/domain/week.ts`)

### 3.1 Input Contract (`BuildWeekInput`)

```typescript
export interface WeeklyCapacityConfig {
  totalAvailableHours?: number;       // Finite number >= 0. Never invented if absent.
  minProtectedSpaceRatio?: number;    // Float in [0, 1]. Default conceptual threshold: 0.25.
  daysWithConstraints?: Array<{
    day: string;                      // Non-empty string (e.g. "martes")
    availableHours: number;           // Finite number >= 0
    note?: string;
  }>;
}

export interface BuildWeekInput {
  currentDate: string;                // Valid real ISO YYYY-MM-DD
  targetWeek?: {                      // Valid real ISO dates where startDate <= endDate
    startDate: string;
    endDate: string;
  };
  userIntent?: string;                // Stated intention (e.g. "Cerrar lo empezado")
  items: ExtractedItem[];             // From Skill 01
  relationships: Relationship[];      // From Skill 02
  groupedWork: GroupedWork;           // From Skill 03
  deadlines: DetectedDeadlines;       // From Skill 04
  context: EvaluateContextOutput;     // From Skill 05
  capacity?: WeeklyCapacityConfig;    // User-declared capacity parameters
}
```

### 3.2 Output Contract (`ProposedWeek`)

```typescript
export type CapacityStatus = "within_capacity" | "over_capacity" | "unknown";
export type ProtectedSpaceStatus = "respected" | "compromised" | "unknown";
export type EstimationCompleteness = "complete" | "partial" | "none";

export interface WeeklyCapacitySummary {
  totalAvailableHours: number | null;
  plannableHours: number | null;       // totalAvailableHours * (1 - minProtectedSpaceRatio)
  plannedHours: number | null;         // Total workload planned; null if estimationCompleteness !== "complete"
  knownEstimatedHours: number | null;  // Sum of known estimates in foci + obligations
  estimationCompleteness: EstimationCompleteness;
  protectedSpaceHours: number | null;  // Recommended uncommitted space
  capacityStatus: CapacityStatus;
  protectedSpaceStatus: ProtectedSpaceStatus;
}

export interface WeeklyFocus {
  id: string;
  title: string;
  groupId?: string;                    // Backed by Skill 03 WorkGroup if applicable
  desiredOutcome: string;              // Concrete qualitative horizon
  rationale: string;                   // Why this structures the week
  contributingItemIds: string[];       // Concrete input item IDs that feed this focus
  estimatedHours: number | null;
}

export interface WeeklyObligation {
  itemId: string;
  title: string;
  dueDate?: string;
  commitmentType: "external" | "strict_deadline";
  rationale: string;
  estimatedHours: number | null;
}

export interface WeeklyFlexibleOption {
  itemId: string;
  title: string;
  condition?: string;                  // e.g. "Si queda tiempo el fin de semana"
  estimatedHours: number | null;
}

export type DeferredReason =
  | "out_of_capacity"
  | "low_attention"
  | "waiting_dependency"
  | "archived"
  | "intentional_postponement"
  | "not_scheduled";

export interface DeferredItem {
  itemId: string;
  title: string;
  reason: DeferredReason;
  rationale: string;
}

export interface UnplannedSpace {
  rationale: string;
  recommendedHours: number | null;
}

export interface ConfirmationPrompt {
  question: string;
  keyTradeoffs: string[];              // Transparent review of what is left out
  pendingQuestions: string[];          // At most 2 non-blocking questions
}

export interface ProposedWeek {
  weekSummary: {
    targetWeek: { startDate: string; endDate: string };
    intent?: string;
    capacity: WeeklyCapacitySummary;
  };
  foci: WeeklyFocus[];                 // 0 <= length <= 3
  obligations: WeeklyObligation[];
  flexibleOptions: WeeklyFlexibleOption[];
  deferredItems: DeferredItem[];
  unplannedSpace: UnplannedSpace;
  confirmationPrompt: ConfirmationPrompt;
}
```

---

## 4. Conceptual Taxonomy and Clarity

### 4.1 Contextual Assessment vs. Weekly Priority
- **Contextual Assessment (`evaluate_context`)** is an **objective description of situational gravity**:
  - `HIGH` means acute situational tension (an imminent deadline, an explicit client commitment).
  - It does **not** automatically dictate that the item is a primary weekly focus. A 30-minute urgent task belongs in `obligations`, freeing the user's primary mental focus for substantial project lines.
- **Weekly Foci** are **substantive lines of attention**:
  - Usually derived from `WorkGroup` clusters.
  - Represent what the person wants to nurture or advance, not just a reactive list of fire-fighting items.

### 4.2 Available Capacity vs. Plannable Hours vs. Protected Space
- $\text{Total Available Hours}$: declared ceiling of available time.
- $\text{Protected Space}$: intentional buffer $\ge 25\%$ (default) reserved for life, unforeseen delays, context switching, and rest.
- $\text{Plannable Capacity}$: $\text{Total} \times (1 - \text{Ratio})$.
- **Truth in Numbers**: If task hour estimates are missing or incomplete, the system **must not pretend** that planned hours are known. `capacityStatus` and `protectedSpaceStatus` are labeled `"unknown"`.

---

## 5. Deterministic Invariant Engine Rules

To uphold the *Code before AI* principle, the following invariants are enforced deterministically and validated via `validateProposedWeekInvariants(proposal, input)`:

1. **Exact 1:1 Item Conservation**:
   - Every input `item.id` must appear **exactly once** in one of these four exclusive categories:
     - `foci[].contributingItemIds`
     - `obligations[].itemId`
     - `flexibleOptions[].itemId`
     - `deferredItems[].itemId`
   - *Invariants:* 0 lost items, 0 duplicate assignments (within or across categories), 0 phantom item IDs.
2. **Focus Limits**:
   - $0 \le \text{foci.length} \le 3$.
   - Any `groupId` referenced by a focus must exist in `input.groupedWork.groups`.
3. **Category Exclusivity**:
   - An item cannot be both a focus contributing item and an obligation, flexible option, or deferred item.
4. **Capacity Honesty & Non-Contradiction**:
   - If `plannedHours > plannableHours`, `capacityStatus` cannot be `"within_capacity"`.
   - If `capacityStatus === "over_capacity"`, `protectedSpaceStatus` cannot be `"respected"`.
   - If input does not specify `totalAvailableHours`, proposal cannot invent a number.
5. **Question Throttling**:
   - At most 2 questions in `confirmationPrompt.pendingQuestions`.
6. **Canonical Zero-Token Short-Circuit**:
   - If `input.items.length === 0`: returns an empty proposal in 0ms without calling an AI model.

---

## 6. Edge Cases & Boundary Handling

1. **No declared capacity hours or task estimates**:
   - All hours in summary and items remain `null`. `capacityStatus` and `protectedSpaceStatus` are `"unknown"`. Foci and obligations are proposed qualitatively based on semantic groups and explicit deadlines.
2. **Known capacity with complete estimates**:
   - Full mathematical calculation of plannable and planned hours. Strict verification that protected space is preserved.
3. **Known capacity with partial estimates**:
   - `plannedHours` cannot be declared as an absolute truth (`plannedHours: null`).
   - The system registers `knownEstimatedHours` and tags `estimationCompleteness: "partial"`.
   - If `knownEstimatedHours <= plannableHours`, both `capacityStatus` and `protectedSpaceStatus` are strictly `"unknown"`. The system does not claim `within_capacity` or `respected` without full visibility.
   - If `knownEstimatedHours > plannableHours`, `capacityStatus` is deterministically marked `"over_capacity"` and `protectedSpaceStatus: "compromised"`, as known work alone already breaks the ceiling.
4. **Obligations exceed plannable capacity**:
   - All obligations are retained (no silent drops). Foci are minimized or set to zero. `capacityStatus: "over_capacity"` and `protectedSpaceStatus: "compromised"`. The `confirmationPrompt.keyTradeoffs` highlights that obligations alone exceed realistic time, prompting the user to renegotiate.
5. **Dump consists entirely of exploratory ideas**:
   - 0 obligations. 0 or 1 optional focus. Ideas placed in `flexibleOptions`. Large protected space.
6. **All items are archived**:
   - 0 foci, 0 obligations, 0 options. All items placed in `deferredItems` with `reason: "archived"`.
7. **Items blocked by third parties (`waiting`)**:
   - If blocked without immediate executable next steps, placed in `deferredItems` with `reason: "waiting_dependency"`.
8. **Blocked items with viable follow-up actions**:
   - The follow-up action (e.g. "Reclamar credenciales al cliente") is separated as a task and can become an active obligation or focus contributing item, while the blocked item remains pending.
9. **Approaching deadline on an explicitly optional item** (e.g. Case 22 "cambiar cuerdas si tengo un rato"):
   - Does NOT convert to an obligation. Placed in `flexibleOptions` with condition noted.
10. **Absence of coherent work groups**:
    - Foci can be derived from standalone projects or single major tasks, or foci can be 0 or 1.
11. **Empty input (`items.length === 0`)**:
    - Returns `createEmptyProposedWeek(...)` with 0 foci, 0 obligations, 0 options, 0 deferred items, 0 tokens consumed.
12. **Missing user intent**:
    - Handled gracefully with `intent: undefined`.
13. **Target week not specified**:
    - Defaults to the following natural calendar week (Monday to Sunday) calculated deterministically from `currentDate` via `resolveDefaultTargetWeek(currentDate)`.
    - Handles transitions across weekends (Friday, Sunday), start of week (Monday planning next week), month boundaries, and year boundaries.
14. **Contradictory data or phantom IDs**:
    - Deterministic invariant validator catches and rejects them.

---

## 7. Resolved Architectural Decisions

1. **Default Target Week Convention**:
   - **Resolution:** Deterministically resolves to the following natural calendar week (Monday 00:00 UTC through Sunday 23:59 UTC) via `resolveDefaultTargetWeek(currentDate)`.
   - If `currentDate` is Friday (e.g. `2026-10-09`) or Sunday (`2026-10-11`), it targets Monday `2026-10-12` to Sunday `2026-10-18`.
   - If `currentDate` is Monday (e.g. `2026-10-12`), planning applies to the upcoming week (Monday `2026-10-19` to Sunday `2026-10-25`).
   - If the user explicitly specifies `targetWeek`, that valid interval is respected directly.

2. **Partial Estimation Semantics & Capacity Honesty**:
   - **Resolution:** Explicit differentiation in `WeeklyCapacitySummary`:
     - `knownEstimatedHours`: sum of hours with known estimates across foci and obligations.
     - `plannedHours`: total workload; **must be `null`** unless `estimationCompleteness === "complete"`. Partial sums are never misrepresented as total workload.
     - `estimationCompleteness`: `"complete" | "partial" | "none"`.
   - When estimates are partial and $\text{knownEstimatedHours} \le \text{plannableHours}$, `capacityStatus` and `protectedSpaceStatus` remain strictly `"unknown"`.
   - If $\text{knownEstimatedHours} > \text{plannableHours}$, `capacityStatus` is deterministically `"over_capacity"`.
   - When obligations alone exceed plannable capacity, they are retained in full (no silent drops) and `capacityStatus` is `"over_capacity"`.

3. **Granularity & Double-Counting Prevention**:
   - **Resolution:** Foci hours represent the estimated dedication to the focus line. Contributing tasks feed the focus semantically; individual item hours must not be added on top of the focus in a way that double-counts effort. Invariant cross-validation enforces 1:1 category exclusivity for all input items.

4. **Handling of Omitted Tasks & The `not_scheduled` Deferral Reason**:
   - **Resolution:** Addition of `"not_scheduled"` to `DeferredReason`:
     - **Definition:** An item conserved outside the active weekly plan whose exclusion has no demonstrable reason in the available ground-truth data. It does **not** imply that the user made a conscious decision to postpone, nor that there is an objective overload or lack of capacity.
     - **Deterministic Preservation:** When a regular task or commitment is omitted by the planner and lacks sufficient ground-truth evidence to justify another specific reason (such as `archived` or `waiting_dependency`), the deterministic normalizer preserves it in `deferredItems` with `reason: "not_scheduled"`. This avoids rejecting valid proposals while adhering strictly to *Code before AI*.
     - **Auditability:** Every such preservation is tracked in `ProposalNormalizationResult.repairs` with `type: "rescued_omitted_to_not_scheduled"`.
     - **Non-Invention Guarantee:** The system never converts `not_scheduled` into `out_of_capacity` (even under high capacity), `low_attention`, or `intentional_postponement` without factual backing.
     - **Strict Invariant Guard:** Phantom item IDs, nonexistent group IDs, and contradictory cross-category assignments remain strictly rejected via `WeekValidationError`.

---

---

## 8. Implementation & Calibration Results

1. **Phase 1: Domain and Contract Validation (Complete)**:
   - Approved ADR 0006.
   - `src/domain/week.ts` with strict Zod schemas and cross-validation invariants.
   - Deterministic test suite in `tests/week-domain.test.ts`.
2. **Phase 2: Deterministic Pre/Post-Processing Engine (Complete)**:
   - `src/skills/build-week/deterministic.ts`:
     - Empty-input short circuit (0ms, 0 tokens).
     - Capacity and protected space arithmetic.
     - 100% item conservation normalizer.
     - Phantom item, phantom group, and duplicate purifier.
     - False obligation safeguard: reclassifies urgent wording (`importance: high`) lacking external commitments or deadlines to foci or deferred items.
3. **Phase 3: Semantic Prompt and Parser (Complete)**:
   - `src/skills/build-week/prompt.ts`: respectful, human-first system prompt with clear negative constraints and explicit distinction between urgency and contractual commitments.
   - `src/skills/build-week/parser.ts`: markdown code-block stripper and Zod validation.
4. **Phase 4: Provider Support & Fixtures (Complete)**:
   - Updated `AIProvider` interface with `buildWeek`.
   - Updated `MockProvider`, `GroqProvider` (`qwen/qwen3.8-27b`), and `GeminiProvider` (`gemini-2.5-flash`).
5. **Phase 5: Behavioral Testing & Evaluation Calibration (Complete)**:
   - 108 automated unit, behavioral, and regression tests in `tests/build-week*.test.ts`.
   - Evaluator in `scripts/eval-cases.ts` with consolidation merge engine protecting active live results against offline mock runs.
   - Real Groq evaluation across all 25 fixtures:
     - **25/25 clean passes** (100%), 0 repairs, 0 failures.
     - 78.578 total tokens (3.143 avg tokens/case).
     - Semantic audit passed with product observations recorded for future UI/domain refinement (handling sub-hour tasks prior to the week, delegation tracking vs active focus, and visual horizon separation for future milestones).
   - Temporal regression test in `tests/build-week-deterministic.test.ts` verifying external commitments with dates prior to the target week (`case-08`) remain visible for user reconciliation.

---

## 9. Status and Next Steps

- **Status:** **Approved & Stable Candidate**. Skill 06 is fully verified and calibrated.
- **Next Skill:** Proceed to **Skill 07 (`analyze_change`)** to handle mid-week adjustments and incoming brain dumps without disrupting established weekly focus.
