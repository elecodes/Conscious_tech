# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
  - 18 unit and behavioral tests across `tests/relationships-domain.test.ts` and `tests/detect-relationships.test.ts`.
  - CLI evaluation script `scripts/eval-relationships.ts` with `npm run eval:relationships`.
- **Architecture Documentation**:
  - ADR 0002: Detect Relationships — Conservative Semantic Links and Deterministic Post-Processing.

### Changed
- **Calibrated `detect_relationships` Semantic Prompt & Evaluation**:
  - Enforced strict isolation of `CONCERN` elements: emotional/cognitive load reflections remain excluded from task dependency graphs.
  - Explicit prerequisite capture: functional preconditions ("antes tengo que X para Y", "primero X para Y", "después de X") are declared as canonical `depends_on`.
  - Demoted chained brainstorming thoughts to `related_to` rather than artificial causal `depends_on`.
  - Refined `part_of` for constituent preparatory/delivery subtasks.
  - Enhanced unified evaluation pipeline (`scripts/eval-cases.ts`) with backoff rate-limit handling and real-time schema validation across 25 real dumps.
  - Expanded behavioral test suite to 61 deterministic tests.

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
