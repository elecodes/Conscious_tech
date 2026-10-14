# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.14.0] - 2026-10-14

### Added
- **Closed Week Detailed Inspection (`ClosedWeekSummary`)**:
  - Expandable accordion in `WeeklySessionView` («Ver detalle de la semana» / «Ocultar detalle») allowing full audit of closed week contents without mutating state:
    - Planned foci with desired outcomes and estimated hours.
    - Fixed obligations and commitments with due dates.
    - Flexible options and execution conditions.
    - Granular item-by-item breakdown with disposition badges (*Completada*, *Postergada*, *En progreso*, *Descartada*, *Sin reportar*), actual hours vs. estimated hours, notes, and postponement rationales.
    - Retrospective reflection summary including capacity analysis, consolidated accomplishments, and open questions for the next cycle.
- **Sovereignty & Atomic Reopening (`reopenWeek`)**:
  - Implemented `WeeklySessionService.reopenWeek(planId)` and `WeeklySessionController.reopenWeek(planId)`:
    - Restores a closed weekly plan back to `active` status while enforcing single-active-plan invariants.
    - Atomically removes premature `close_reports` in an IndexedDB `readwrite` transaction to maintain clean session state.
    - Resilient prototype delegation in `WeeklySessionController` guarding against stale service instances during Vite HMR / React Fast Refresh cycles.
- **Timestamp Resilience**:
  - Preprocessed `YYYY-MM-DD` date strings in `ClosedAtTimestampSchema` into full Gregorian ISO-8601 UTC timestamps (`${val}T23:59:59.000Z`), resolving `InvalidRecordDataError` deserialization issues for stored IndexedDB records.
- **Testing & Verification**:
  - Added unit test suite for `reopenWeek` in `tests/weekly-session-service.test.ts` covering non-existent plans, non-closed plans, active plan conflict guards, and transactional reopening.
  - Added component and controller tests in `tests/weekly-session-closed-week-view.test.tsx`.
  - All 49 test suites (732 tests) passing cleanly with zero token consumption.

---

## [0.13.0] - 2026-10-13

### Added
- **Local Persistence Architecture with IndexedDB (`LocalPersistence`)**:
  - IndexedDB storage layer across 4 canonical object stores: `plans`, `schedules`, `close_reports`, and `memories`.
  - Storage envelopes: `StoredWeeklyPlan` with canonical UUIDs and lifecycle status (`draft`, `active`, `closed`), `StoredCloseWeekReport`, and versioned `WeeklySchedule`.
  - `WeeklySessionService` and `WeeklySessionController` managing session hydration, active plan recovery, concurrency conflict detection, and referential integrity guards.
  - ADR 0013 (`docs/adr/0013-local-persistence-architecture-contract.md`).

---

## [0.12.0] - 2026-10-12

### Added
- **Weekly Schedule Continuity & Real-Time Adjustments**:
  - `WeeklySchedule` domain entity with optimistic concurrency versioning.
  - Deterministic schedule adjustment engine (`applyAdjustmentToSchedule`).
  - Active plan and schedule synchronizer preserving micro-allocations and protected time space.
  - ADR 0012 (`docs/adr/0012-weekly-schedule-continuity-contract.md`).

---

## [0.11.0] - 2026-10-12

### Added
- **Weekly Close Engine (`close_week`)**:
  - Deterministic evaluation of completed, postponed, and dropped items.
  - Reflective summary generator and candidate memory extractor requiring explicit human sovereignty.
  - ADR 0011 (`docs/adr/0011-close-week-contract.md`).

---

## [0.10.0] - 2026-10-12

### Added
- **Domain Modeling for Memory Management (`manage_memory`)**:
  - Zod schemas and TypeScript types in `src/domain/memory.ts`:
    - Strict Gregorian ISO-8601 UTC timestamp validator (`isValidIsoUtcTimestamp`, `IsoUtcTimestampSchema`) guarding against `Date.UTC()` year mapping and out-of-bounds clock/calendar values.
    - Universal epistemic invariants: `isValidEpistemicState()`, `containsHesitationMarkers()`, and strict prohibition of `confirmed` status on automated sources (`conversation_inference`, `system`) or hypotheses (`working_hypothesis`).
    - Discriminated union candidate models: `StoreCandidate`, `UpdateCandidate`, `ForgetCandidate`.
    - Typed proposed operations with human confirmation: `AddMemoryOp`, `UpdateMemoryOp`, `MergeMemoriesOp`, `ArchiveMemoryOp`, `ForgetMemoryOp`, `KeepMemoryOp`, `RequestClarificationOp`.
    - Conservative merge provenance tracking (`SourceMemoryProvenanceSchema`) decoupling epistemic certainty from temporal status and preventing unearned confirmation or active states from expired/inferred sources.
- **Skill 10 (`manage_memory`)**:
  - Implemented `ManageMemoryService` and 100% deterministic engine in `src/skills/manage-memory/deterministic.ts`:
    - Absolute priority of explicit forget requests (`forget`), suppressing concurrent conflicting operations and isolating memory IDs in `suppressedContextMemoryIds`.
    - Inclusive temporal expiration checking ($\text{referenceDate} > \text{validUntil}$) generating `archive` proposals without autonomous store mutations.
    - Per-candidate error isolation: malformed candidates are safely isolated into `warnings` and activate `invalid_request` without polluting `invalidReferences` or dropping independent valid operations.
    - Lexical normalization preserving operators and technical symbols (`+`, `#`, `@`, `/`, `-`, `_`, `.`, `:`) avoiding false collisions between terms like `C++` vs `C`.
    - Divergent concurrent updates/merges suppressed into `request_clarification` to eliminate arbitrary selection.
    - Canonical deterministic sorting producing deeply equal outputs across candidate input permutations.
- **Architectural Documentation**:
  - ADR 0010 (`docs/adr/0010-manage-memory-contract.md`): formalizes non-persistence, user sovereignty, epistemic invariants, forget priority, and conservative merge rules.
- **Testing & Verification**:
  - Added 52 new tests across 2 suites:
    - `tests/memory-domain.test.ts`: 19 unit tests covering timestamp bounds, hesitation markers, epistemic invariants, and candidate schema validations.
    - `tests/manage-memory-fixtures.test.ts`: 33 tests covering the canonical `mem-01` through `mem-28` fixtures plus audit regression cases (`mem-29` to `mem-33`).
  - Entire test suite now at 450 tests passing cleanly with zero token consumption and zero regressions.

---

## [0.9.0] - 2026-10-11

### Added
- **Domain Modeling for Adjustment Proposals (`propose_adjustment`)**:
  - Zod schemas and TypeScript types in `src/domain/adjustment.ts`:
    - Typed actions via discriminated union: `PostponeItemAction`, `ReassignTimeBlockAction`, `ReallocateDayWorkAction`, `UnblockDependencyAction`, `AcceptRiskAction`, `RequestInformationAction`.
    - Proposal structure: `AdjustmentProposal`, `UnresolvedConflictsBreakdown`, `ProposeAdjustmentInput`, `ProposeAdjustmentOutput`.
    - Exact 100% item conservation helper `getAllPlanItemIds()` and comprehensive invariant validator `validateProposalInvariants()`.
- **Skill 09 (`propose_adjustment`)**:
  - Implemented `ProposeAdjustmentService` and 100% deterministic engine in `src/skills/propose-adjustment/deterministic.ts`:
    - Strict mathematical balance checks without `max(0, ...)` masking.
    - Exact duration preservation for reassigned time blocks (supporting 60, 90, 120+ minute blocks without truncation).
    - Intra-item collision detection correctly excluding only the source `currentBlock`.
    - Strict referential integrity for `dependentItemId` and `prerequisiteItemId` against $S_{\text{total}}$.
    - Partial conditional proposals when postponable tasks are smaller than total deficit.
    - Prioritized output status: `adjustments_proposed`, `no_adjustment_needed`, `clarification_required`, `no_viable_alternatives`.
- **Architectural Documentation**:
  - ADR 0009 (`docs/adr/0009-propose-adjustment-contract.md`): formalizes proposal invariants, item partition conservation, and deterministic viability rules.
- **Testing & Verification**:
  - Added 34 new tests across 2 suites:
    - `tests/adjustment-domain.test.ts`: 20 unit tests covering schema validations, intra-item collisions, raw balances, and referential integrity.
    - `tests/propose-adjustment-fixtures.test.ts`: 14 tests covering the canonical `adj-01` through `adj-10` suite plus audit regression cases.
  - Test suite now at 398 tests passing cleanly with zero token consumption.

---

## [0.8.0] - 2026-10-11

### Added
- **Domain Modeling for Conflict Detection (`detect_conflict`)**:
  - Zod schemas and TypeScript types in `src/domain/conflict.ts`: `ConflictType`, `ConflictCertainty`, `ConflictScope`, `ConflictEvidence`, `DetectedConflict`, `UnconflictedAreaVerification`, `TimeBlock`, `DailyWorkAllocation`, `DetectConflictInput`, and `DetectConflictOutput`.
  - Canonical 4-type taxonomy: `capacity_deficit`, `blocked_by_dependency`, `deadline_incompatibility`, and `schedule_overlap`.
  - Safe day-scoped interval validation enforcing `startTime < endTime` in `TimeBlockSchema`.
- **Skill 08 (`detect_conflict`)**:
  - Implemented `DetectConflictService` providing a 100% deterministic analysis engine of objective plan incompatibilities without taking over user decisions or altering the active plan.
  - Deterministic engine in `src/skills/detect-conflict/deterministic.ts`:
    - Strict capacity deficit checks for weekly totals and explicit daily allocations (`DailyWorkAllocation` vs `DayConstraint`).
    - Fixed schedule overlap detection for concurrent daily time blocks (`TimeBlock`).
    - Causal dependency blocking strictly honoring `depends_on` (excluding `part_of`, `related_to`, and `same_project`).
    - Deterministic derivation: `hasBlockingConflicts: true` only triggers for confirmed conflicts with verifiable metrics.
    - Positive isolation verification for `unconflictedAreas`, refusing to certify unknown capacity plans falsely.
- **Provider Layer Updates**:
  - Added `detectConflict` to `AIProvider` interface in `src/providers/ai-provider.ts`.
  - Added zero-token deterministic mock implementation and custom handler support in `src/providers/mock-provider.ts`.
- **Architectural Documentation**:
  - ADR 0008 (`docs/adr/0008-detect-conflict-contract.md`): formalizes the contract, boundary rules, daily vs weekly distinctions, and uncertain risk principles.
- **Testing & Verification**:
  - Added 16 new tests across 2 suites:
    - `tests/conflict-domain.test.ts`: Zod schema boundaries, strict regex, and time block ordering rules.
    - `tests/detect-conflict-fixtures.test.ts`: 10 canonical fixtures covering confirmed conflicts, daily allocations, schedule overlaps, potential risks, missing data, and unconflicted balanced plans.
  - Total test suite now at 364 tests passing deterministically in < 1.4s with zero token expenditure.

---

## [0.7.0] - 2026-10-11

### Added
- **Domain Modeling for Impact & Change Analysis (`analyze_change`)**:
  - Zod schemas and TypeScript types in `src/domain/change.ts`: `ChangeType`, `IncomingChangeDelta`, `AffectedElement`, `CapacityImpactAnalysis`, `UnaffectedAreaVerification`, `ValidationError`, `AnalyzeChangeInput`, and `AnalyzeChangeOutput`.
  - Orthogonal taxonomy of change types: `new_item`, `drop_item`, `modified_item`, `deadline_change`, `dependency_change`, `capacity_change`, `mixed_change`, and `none_detected`.
- **Skill 07 (`analyze_change`)**:
  - Implemented `AnalyzeChangeService` to evaluate the impact of mid-week changes, unexpected inputs, and trade-offs against an active weekly plan (`ProposedWeek`) with a strict read-only analytical scope.
  - Deterministic engine in `src/skills/analyze-change/deterministic.ts`:
    - Strict capacity arithmetic: avoids fabricating numbers (`unknown_capacity` when totals are unknown; `indeterminate` with partial estimates; `deficit_known` when known hours exceed available capacity; `surplus_known` only when complete estimates fit within plannable space).
    - Unambiguous relationship removal (`sourceItemId`, `targetItemId`, `type`).
    - Reference validation: captures non-existent elements safely in `validationErrors` with `status: "invalid_references"`.
    - Positive isolation proofs for `unaffectedAreas`.
    - Conservative intervention triggers: unblocking dependencies (`satisfied`) informs without requiring user intervention; past deadlines communicate risk without forcing plan re-creation.
  - Conservative prompt in `src/skills/analyze-change/prompt.ts` with strict negative constraints ("Code before AI", no prescription, no plan mutation).
  - Robust JSON parser in `src/skills/analyze-change/parser.ts` with Markdown code-block stripping.
- **Provider Layer Updates**:
  - Added `analyzeChange` to `AIProvider` interface in `src/providers/ai-provider.ts`.
  - Added zero-token deterministic mock implementation and custom handler support in `src/providers/mock-provider.ts`.
- **Architectural Documentation**:
  - ADR 0007 (`docs/adr/0007-analyze-change-impact-contract.md`): records the contract, boundaries, and past deadline non-prescription principle.
- **Testing & Verification**:
  - Added 34 new tests across 3 suites:
    - `tests/change-domain.test.ts`: Zod schema boundaries and validation rules.
    - `tests/analyze-change-deterministic.test.ts`: Unit tests for delta operations, arithmetic balance, dependencies, and intervention triggers.
    - `tests/analyze-change-fixtures.test.ts`: Regression suite covering all 10 agreed change fixtures (`change-01` to `change-10`).
  - Total test suite now at 348 tests passing deterministically in < 1.2s with zero token expenditure.

---

## [0.6.0] - 2026-10-10

### Added
- **Domain Modeling for Weekly Planning (`build_week`)**:
  - Zod schemas and TypeScript types in `src/domain/week.ts`: `TargetWeek`, `ProposedWeek`, `WeeklyFocus`, `WeeklyObligation`, `FlexibleOption`, `DeferredItem`, `UnplannedSpace`, `ConfirmationPrompt`, `WeeklyCapacitySummary`, and `BuildWeekInput`.
  - Negative constraints enforcing human sovereignty: "AI proposes. The person decides."
- **Skill 06 (`build_week`)**:
  - Implemented `BuildWeekService` synthesizing evaluated context into a realistic, human-centered weekly focus proposal without over-scheduling or dictating calendars.
  - Semantic prompt in `src/skills/build-week/prompt.ts` with strict rules: never plan 100% capacity, keep protected space non-negotiable, preserve 100% items (no silent discards), distinguish urgency from contractual obligations, and propose 0 to 3 qualitative foci.
  - JSON parser in `src/skills/build-week/parser.ts` with Markdown code-block stripper and Zod validation.
  - Deterministic invariant engine in `src/skills/build-week/deterministic.ts`:
    - Strict 1:1 category mutual exclusivity and item conservation.
    - Capacity arithmetic: computes plannable and protected space; preserves `unknown` capacity status when user estimates are omitted or partial.
    - Safe rescue of omitted items to `deferredItems` (`not_scheduled`, `archived`, `waiting_dependency`).
    - False obligation safeguard: reclassifies high-importance items without strict deadlines or external promises.
    - Empty-input short circuit (0ms, 0 tokens).
- **Consolidation Engine & Persistence**:
  - Enhanced `scripts/eval-cases.ts` with `mergeConsolidatedWeekResults`: protects live external evaluations (Groq) against being overwritten by offline mock runs, with ISO timestamps and full execution history tracking.
- **Provider Support for Skill 06**:
  - `MockProvider`: Token-free reference plans across golden cases.
  - `GroqProvider`: Real LLM inference with `qwen/qwen3.8-27b`.
  - `GeminiProvider`: Google GenAI integration with `gemini-2.5-flash`.
- **Testing & Verification**:
  - Added 108 tests covering domain schemas, deterministic invariant engines, false obligation regressions, prompt parsing, and consolidation persistence.
  - Regression test for temporal discrepancies: preserves external commitments with dates prior to target week for explicit user reconciliation (`case-08`).
  - Total test suite now at 314 tests passing deterministically.
- **Calibration & Real Groq Evaluation**:
  - Evaluated all 25 calibration brain dumps with Groq (`qwen/qwen3.8-27b`):
    - **25/25 clean passes** (100%), 0 repairs, 0 failures.
    - 78.578 total tokens (3.143 avg tokens/case).
    - Semantic audit completed with product observations documented.

---

## [0.5.0] - 2026-10-09

### Added
- **Domain Modeling for Context Evaluation**: Zod schemas and TypeScript types in `src/domain/context.ts` for `ContextSignal`, `ContextAttentionLevel`, `GroupRelevanceLevel`, `ItemContextAssessment`, `GroupContextAssessment`, `OpenQuestion`, `EvaluateContextInput`, and `EvaluateContextOutput`.
- **Skill 05 (`evaluate_context`)**:
  - Implemented `EvaluateContextService` answering *"What context matters to understand the situation of each task and line of work?"* without building the weekly plan, deciding trade-offs, or dictating actions.
  - Semantic prompt in `src/skills/evaluate-context/prompt.ts` with strict rules: explain situation, never allocate hours or decide focus, treat unstated items as `unclear` instead of low importance, enforce grounded evidence, and restrict open questions to material uncertainties.
  - JSON parser with Markdown code fence extraction in `src/skills/evaluate-context/parser.ts`.
  - Deterministic invariant engine in `src/skills/evaluate-context/deterministic.ts`:
    - Strict 1:1 coverage conservation for all items and groups (0 missing, 0 duplicates, 0 phantoms).
    - Integrity guard for open questions (strips references to nonexistent item IDs).
    - "Code before AI" dependency guardrail: purges spurious `dependency` signals unless backed by explicit, valid `depends_on` relationships (strictly rejecting `part_of`, `related_to`, or `same_project`).
    - Objective `waiting` signal handling: tracks third-party blockers without automatically downgrading attention level.
    - Zero-token short-circuit for empty inputs.
- **Provider Support for Skill 05**:
  - `MockProvider`: Token-free reference assessments across golden dataset `cases/mock-extractions.json` through `cases/mock-deadlines.json`.
  - `GroqProvider`: Structured JSON inference with `qwen/qwen3.8-27b`.
  - `GeminiProvider`: Google GenAI structured output with `gemini-2.5-flash`.
- **Testing & Verification**:
  - Added 39 unit and behavioral tests across `tests/context-domain.test.ts` and `tests/evaluate-context.test.ts`.
  - Total test suite expanded to 169 tests passing deterministically in < 700ms with zero token expenditure.
- **Evaluation Pipeline & Calibration**:
  - Extended `scripts/eval-cases.ts` with `runSkill05Evaluation` and npm script `npm run eval:context`.
  - Completed validation and semantic microcalibration across all 25 calibration brain dumps in `cases/eval-context-results.json` using Groq (`qwen/qwen3.8-27b`):
    - 100% item coverage (63/63 items) and group coverage (7/7 groups) with 0 validation errors.
    - Verified proper handling of exploratory ideas (Case 03 in `LOW`), third-party waiting without propagation (Case 06), absence of clinical urgency alarms (Case 10), composition vs dependency isolation (Case 12, 17, 25), archived items (Case 18 in `LOW`), and optional activities with deadlines (Case 22 in `LOW`).
- **Architecture Documentation**:
  - Accepted ADR 0005: Functional Contract for Skill 05 (`evaluate_context`).

## [0.4.0] - 2026-10-09

### Added
- **Domain Modeling for Deadlines**: Zod schemas and TypeScript types in `src/domain/deadlines.ts` for `DeadlineKind`, `DetectedDeadline`, `DetectedDeadlines`, and `DetectDeadlinesInput`.
- **Skill 04 (`detect_deadlines`)**:
  - Implemented `DetectDeadlinesService` answering *"When does this need to happen according to what the person said?"* without prioritizing, scheduling, or estimating effort.
  - Semantic prompt in `src/skills/detect-deadlines/prompt.ts` with strict rules: never invent dates, anchor relative dates to explicit `currentDate`, treat intervals as single entities, and separate future deadlines from past narrative context.
  - JSON parser with Markdown fence extraction in `src/skills/detect-deadlines/parser.ts`.
  - Deterministic engine in `src/skills/detect-deadlines/deterministic.ts`:
    - Strict Gregorian calendar validation (`YYYY-MM-DD`).
    - Vague desire filter: purges non-actionable expressions ("cuando estemos más tranquilos", "algún día", "más adelante", "cuando pueda").
    - Pure UTC deterministic date calculation for relative anchors ("hoy", "mañana", "pasado mañana", "este fin de semana", weekdays).
    - Range integrity validation (`resolvedStart <= resolvedEnd`, auto-swapping if inverted).
    - Invariant validator and cleaner: drops phantom item IDs, empty raw strings, and duplicate entries.
    - Zero-token short-circuit for empty input items.
- **Provider Support for Skill 04**:
  - `MockProvider`: Token-free reference deadlines via golden dataset `cases/mock-deadlines.json` (cases 01–25).
  - `GroqProvider`: Structured JSON completions with `qwen/qwen3.8-27b`.
  - `GeminiProvider`: Google GenAI structured output with `gemini-2.5-flash`.
- **Semantic Microcalibration & Temporal Precision**:
  - Calibrated weekday resolution against explicit anchors: "este viernes" resolves to today when anchor is Friday; passed days like "el jueves" resolve to next Thursday (`confidence: "medium"`); "el próximo jueves" resolves to the following week (`confidence: "high"`).
  - Explicit terminal bounds: "antes del 20" resolves to `resolvedEnd: "YYYY-MM-20"` (`confidence: "medium"`); "antes de que venza el domingo" resolves to `resolvedEnd: "YYYY-MM-11"`.
  - Added 16 deterministic regression tests in `tests/deadlines-microcalibration.test.ts` covering month transitions, leap-year boundaries, intentions vs commitments, and vague expressions.
- **Testing & Verification**:
  - Added 42 unit and behavioral tests across `tests/deadlines-domain.test.ts`, `tests/detect-deadlines.test.ts`, and `tests/deadlines-microcalibration.test.ts`.
  - Total test suite expanded to 130 tests passing in < 500ms with zero token expenditure.
- **Evaluation Pipeline**:
  - Extended `scripts/eval-cases.ts` with `runSkill04Evaluation`, `--date=` anchor flag (defaulting to `2026-10-09`), and npm script `npm run eval:deadlines`.
  - Verified 100% invariant compliance (0 errors) across all 25 calibration brain dumps in `cases/eval-deadlines-results.json`.
- **Architecture Documentation**:
  - ADR 0004: Detect Deadlines — Temporal Reference Normalization without Prioritization (updated with Section 5: pending domain decisions and product conventions).

## [0.3.0] - 2026-10-08

### Added
- **Domain Modeling for Work Groups**: Zod schemas and TypeScript types in `src/domain/work-groups.ts` for `WorkGroup`, `GroupedWork`, and `GroupWorkInput`.
- **Skill 03 (`group_work`)**:
  - Implemented `GroupWorkService` answering *"What elements belong to the same coherent line of work?"* without prioritizing or weekly planning.
  - Semantic prompt in `src/skills/group-work/prompt.ts` with strict relationship weighting (`same_project`, `same_objective`, `part_of`, `depends_on`, `related_to`, `duplicate`) and isolation of emotional `concern` items.
  - Robust JSON parser with Markdown fence stripping in `src/skills/group-work/parser.ts`.
  - Deterministic invariant engine in `src/skills/group-work/deterministic.ts`:
    - Full conservation guarantee (no lost items, no phantom items).
    - Disjoint group guarantee (no items shared across groups; no items simultaneously in a group and ungrouped).
    - Threshold enforcement ($\ge 2$ items per group; degenerate 1-item groups disbanded to ungrouped).
    - Fast short-circuits (0 tokens, 0ms) for empty inputs, 1-item inputs, and items with zero relationships.
- **Provider Support for Skill 03**:
  - `MockProvider`: Token-free reference groupings via `cases/mock-groupings.json`.
  - `GroqProvider`: Structured JSON inference with `qwen/qwen3.8-27b`.
  - `GeminiProvider`: Google GenAI structured output with `gemini-2.5-flash`.
- **Testing & Invariant Verification**:
  - 24 unit and behavioral tests across `tests/work-groups-domain.test.ts` and `tests/group-work.test.ts` covering 15 specific edge-case scenarios.
  - Entire suite running 87 tests in < 400ms with zero token expenditure.
- **Evaluation Pipeline**:
  - Added Skill 03 pipeline evaluation in `scripts/eval-cases.ts` supporting `--skill=group_work` and comma-separated case filters.
  - Reference outputs logged to `cases/eval-group-work-results.json`.
- **Architecture Documentation**:
  - ADR 0003: Group Work — Coherent Lines of Attention and Deterministic Invariants.

## [0.2.0] - 2026-10-07

### Added
- **Domain Modeling for Relationships**: Strict Zod schemas and types in `src/domain/relationships.ts` covering `RelationshipType` (`same_project`, `same_objective`, `related_to`, `part_of`, `depends_on`, `duplicate`), `Relationship` (with `.refine` rejecting self-relations), `DetectedRelationships`, and `DetectRelationshipsInput`.
- **Skill 02 (`detect_relationships`)**:
  - Implemented `DetectRelationshipsService` adhering to "Detect relationships, don't group".
  - Structured prompt in `src/skills/detect-relationships/prompt.ts` enforcing conservative semantic relationship extraction.
  - Robust parser in `src/skills/detect-relationships/parser.ts` with error handling, retry mechanism, and normalization of any legacy `blocks` into `depends_on`.
  - Deterministic engine in `src/skills/detect-relationships/deterministic.ts`:
    - Short-circuits inputs with fewer than 2 items to empty array (0ms, 0 tokens).
    - Drops self-referencing relationships and unknown item IDs.
    - Deduplicates symmetric relationships (`same_project`, `same_objective`, `related_to`, `duplicate`) with canonical sorted direction.
- **Provider Support for Skill 02**:
  - `MockProvider`: Token-free relationship resolution using golden fixture `cases/mock-relationships.json`.
  - `GroqProvider`: Structured JSON inference with `qwen/qwen3.8-27b`.
  - `GeminiProvider`: Google GenAI structured output with `gemini-2.5-flash`.
- **Testing & Evaluation**:
  - 29 unit and behavioral tests across `tests/relationships-domain.test.ts` and `tests/detect-relationships.test.ts` (63 total suite tests).
  - CLI evaluation script `scripts/eval-cases.ts` with rate-limit backoff supporting `--provider=mock|groq|gemini` and `--case=case-XX`.
- **Architecture Documentation**:
  - ADR 0002: Detect Relationships — Conservative Semantic Links and Deterministic Post-Processing.

### Changed
- **Calibrated `detect_relationships` Semantic Prompt & Evaluation**:
  - Enforced strict isolation of `CONCERN` elements: emotional/cognitive load reflections remain excluded from task dependency graphs.
  - Hardened `related_to` boundaries (Rule 1): prohibited links driven merely by co-existence in the same dump/sprint or temporary workarounds ("mientras tanto").
  - Hardened `part_of` vs `depends_on` (Rule 2): clarified that prerequisites are not constituent parts; preconditions must map to `depends_on`.
  - Added mutual exclusion rule avoiding simultaneous `A depends_on B` and `B part_of A`.
  - Demoted chained brainstorming thoughts to `related_to` rather than artificial causal `depends_on`.
  - Refined `part_of` for constituent preparatory/delivery subtasks.
  - Enhanced unified evaluation pipeline (`scripts/eval-cases.ts`) with backoff rate-limit handling and real-time schema validation across 25 real dumps.
  - Expanded behavioral test suite to 63 deterministic tests passing in < 400ms.

## [0.1.0] - 2026-10-06

### Added
- **Domain Modeling & Validation**: Strict Zod schemas and TypeScript types in `src/domain/items.ts` covering `ItemType`, `ItemStatus`, `CommitmentType`, `DateReference`, `Effort`, `Importance`, and `ExtractedItem`.
- **Archived State Support**: Added `"archived"` to `ItemStatus` to faithfully capture consciously postponed or dismissed initiatives without forcing them into active or exploratory states.
- **Provider Abstraction Layer**: Decoupled domain from LLM vendors via `AIProvider` interface and factory in `src/providers/`.
  - `GroqProvider`: Fast inference using `qwen/qwen3.8-27b` with structured output mode and output token budgeting.
  - `GeminiProvider`: Google GenAI integration utilizing `gemini-2.5-flash`.
  - `MockProvider`: Deterministic, token-free provider for test suites and offline validation.
- **Skill 01 (`extract_items`)**:
  - Conservative semantic extraction service with single-retry recovery for schema violations.
  - Markdown code-fence stripping and robust JSON parsing in `parser.ts`.
  - System prompt enforcing "Extract, don't interpret".
- **Deterministic Testing Suite**:
  - 34 unit and behavioral tests covering 21 discrete scenarios (tasks, ideas, concerns, commitments, deadlines, edge cases).
  - 100% test pass rate with zero external token expenditure.
- **Evaluation & Calibration Dataset**:
  - 25 authentic Spanish brain dumps in `cases/real-dumps.json`.
  - Golden expected extraction fixtures in `cases/mock-extractions.json`.
  - Batch evaluation CLI tool in `scripts/eval-cases.ts` with rate-limit throttling.
- **Testing Web Interface**:
  - Minimal editorial-style UI in `src/web/` for interactive testing, provider switching, and full JSON payload inspection.
- **Architecture Documentation**:
  - ADR 0001: Conservative Semantic Extraction and AI Provider Abstraction in `docs/adr/0001-conservative-semantic-extraction-and-provider-architecture.md`.

### Changed
- Refined `extract_items` system prompt to eliminate over-inferences:
  - Restricted `commitment: "external"` solely to third-party agreements and deadlines.
  - Restricted `commitment: "personal"` strictly to explicit self-commitments.
  - Prevented conversion of fleeting ideas/doubts into actionable pending tasks.
  - Prohibited inventing specific calendar dates for broad temporal expressions (e.g. "in November").
  - Prohibited deriving task effort from friction complaints (e.g. "Gradle takes half a day").
  - Enforced atomic separation of independent actions without merging.
