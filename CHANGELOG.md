# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
