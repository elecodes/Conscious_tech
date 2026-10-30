# Conscious Tech

> A personal clarity notebook and conscious AI companion designed to reduce noise, protect attention, and help people choose what matters each week.

---

## Philosophy & Core Rules

1. **The AI proposes; the human decides.** The system never silently alters your plans or commits your time.
2. **Code over AI when deterministic.** If a problem can be solved deterministically with code (summing hours, checking capacity, validating dates), we do not use AI. Semantic understanding and interpretation are handled by compact, cost-effective models.
3. **Do not turn every thought into a task.** Thoughts, explorations, and doubts remain ideas or concerns—never forced into actionable pressure.
4. **Do not plan 100% capacity.** Available time is not fully plannable time; protected space for rest, overflow, and thinking is essential.

---

## Architecture & Current Status

This repository is built incrementally following clean architecture principles:

```text
docs/
└── adr/                     # Architectural Decision Records
    ├── 0001-conservative-semantic-extraction-and-provider-architecture.md
    ├── 0002-detect-relationships-conservative-semantic-links.md
    ├── 0003-group-work-coherent-lines-of-attention.md
    ├── 0004-detect-deadlines-temporal-normalization.md
    ├── 0005-evaluate-context-functional-contract.md
    ├── 0006-build-week-proposal-and-capacity-contract.md
    ├── 0007-analyze-change-impact-contract.md
    ├── 0008-detect-conflict-contract.md
    ├── 0009-propose-adjustment-contract.md
    ├── 0010-manage-memory-contract.md
    ├── 0011-close-week-contract.md
    ├── 0012-weekly-schedule-continuity-contract.md
    ├── 0013-local-persistence-architecture-contract.md
    ├── 0014-closed-week-inspection-and-reopen-sovereignty.md
    ├── 0015-progressive-disclosure-guided-navigation-and-human-capacity-language.md
    ├── 0016-focus-capacity-conservation-and-calm-adjustment-experience.md
    ├── 0017-local-persistence-resilience-data-sovereignty-and-dependency-isolation.md
    ├── 0018-radar-unforeseen-intake-and-plan-incorporation.md
    ├── 0019-native-voice-dictation-and-mcp-integration-architecture.md
    ├── 0020-google-calendar-ical-integration.md
    ├── 0021-zod-advisory-mitigation-and-v4-migration-strategy.md
    └── 0022-spanish-first-language-and-deferred-i18n.md
src/
├── domain/                  # Pure domain types & strict Zod schemas
│   ├── items.ts             # ItemType, ItemStatus (incl. archived), ExtractedItem
│   ├── relationships.ts     # RelationshipType, Relationship, DetectedRelationships
│   ├── work-groups.ts       # WorkGroup, GroupedWork, GroupWorkInput
│   ├── deadlines.ts         # DeadlineKind, DetectedDeadline, DetectedDeadlines
│   ├── context.ts           # ContextSignal, Item/GroupContextAssessment, OpenQuestion
│   ├── week.ts              # ProposedWeek, WeeklyFocus, Obligation, Capacity
│   ├── change.ts            # ChangeType, AffectedElement, IncomingChangeDelta
│   ├── conflict.ts          # ConflictType, DetectedConflict, TimeBlock, Evidence
│   ├── adjustment.ts        # AdjustmentProposal, SuggestedAdjustmentAction, Partitions
│   ├── memory.ts            # MemoryItem, MemoryOperation, CandidateMemoryInput, Invariants
│   └── calendar.ts          # CalendarEvent, CalendarWeekSummary, 1-click & ICS export
├── infrastructure/          # Storage, calendar parsing & backup
│   ├── calendar/            # RFC 5545 iCalendar parser (recurring, timezones, status)
│   └── storage/indexeddb/   # IndexedDB repositories (plans, schedules, memory, close, backup)
├── server/                  # Local development proxy middleware
│   ├── ai-proxy-handler.ts       # Rate-limited server AI proxy (API key redaction)
│   ├── calendar-proxy-handler.ts # SSRF-hardened iCal proxy (DNS resolution, streaming byte cap)
│   └── rate-limiter.ts           # In-memory sliding window rate limiter
├── providers/               # AI Provider abstraction layer
│   ├── ai-provider.ts       # AIProvider interface
│   ├── groq-provider.ts     # Groq implementation (qwen/qwen3.8-27b)
│   ├── gemini-provider.ts   # Google Gemini implementation (gemini-2.5-flash)
│   ├── mock-provider.ts     # Zero-token deterministic provider with golden cases
│   └── factory.ts           # Provider factory driven by env / options
├── skills/
│   ├── extract-items/       # Skill 01: Semantic brain dump extraction
│   │   ├── prompt.ts        # Conservative prompt (Extract, don't interpret)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   └── index.ts         # ExtractItemsService with structured retry
│   ├── detect-relationships/# Skill 02: Semantic relationship detection
│   │   ├── prompt.ts        # Conservative prompt (Detect relationships, don't group)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Canonicalization, deduplication, same_project inference
│   │   └── index.ts         # DetectRelationshipsService
│   ├── group-work/          # Skill 03: Coherent lines of attention
│   │   ├── prompt.ts        # Grouping prompt (lines of work, not planning)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Invariant engine: conservation, disjoint groups
│   │   └── index.ts         # GroupWorkService with short-circuits
│   ├── detect-deadlines/    # Skill 04: Temporal references & deadline normalization
│   │   ├── prompt.ts        # Strict prompt (Never invent dates, anchor to currentDate)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # UTC calendar resolver, vague filter, range validator
│   │   └── index.ts         # DetectDeadlinesService with short-circuits
│   ├── evaluate-context/    # Skill 05: Situational context & attention signals
│   │   ├── prompt.ts        # Contextual gravity prompt (Explain, don't plan)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Invariant engine: 1:1 coverage, phantom purger
│   │   └── index.ts         # EvaluateContextService with short-circuits
│   ├── build-week/          # Skill 06: Human-centered weekly focus proposal
│   │   ├── prompt.ts        # Semantic proposal prompt (AI proposes, person decides)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Invariant engine: 1:1 conservation, capacity math
│   │   └── index.ts         # BuildWeekService
│   ├── analyze-change/      # Skill 07: Impact and change analysis
│   │   ├── prompt.ts        # Read-only analytical prompt (Explain, don't re-plan)
│   │   ├── parser.ts        # Markdown stripping & Zod schema validation
│   │   ├── deterministic.ts # Invariant engine: capacity arithmetic, causal graph
│   │   └── index.ts         # AnalyzeChangeService
│   ├── detect-conflict/     # Skill 08: Objective conflict detection
│   │   ├── deterministic.ts # Invariant engine: capacity deficit, overlaps, deps
│   │   └── index.ts         # DetectConflictService
│   ├── propose-adjustment/  # Skill 09: Adjustment alternatives proposal
│   │   ├── deterministic.ts # Invariant engine: item partition, raw balance, slot duration
│   │   └── index.ts         # ProposeAdjustmentService
│   ├── manage-memory/       # Skill 10: Personal memory & context management
│   │   ├── deterministic.ts # Invariant engine: forget priority, expiration, canonical sorting
│   │   └── index.ts         # ManageMemoryService
│   └── close-week/          # Skill 11: Reflective weekly review and closure
│       ├── deterministic.ts # Invariant engine: honest disposition, non-punitive summary
│       └── index.ts         # CloseWeekService
├── application/             # Application orchestration layer
│   ├── weekly-session-service.ts # Core application service & persistence orchestration
│   └── radar-pipeline.ts        # Unforeseen events radar pipeline (Sections 21-25)
└── web/                     # React UI, conscious spaces & hooks
    ├── components/          # Calm UI components (session, planning, radar, calendar, voice)
    ├── hooks/               # useSpeechRecognition (Web Speech API)
    ├── App.tsx
    ├── main.tsx
    └── style.css
cases/
├── README.md                # Privacy & synthetic benchmark documentation
├── sample-dumps.json        # 25 synthetic/fictional Spanish brain dumps for calibration
├── mock-extractions.json    # Golden reference extractions for zero-token tests
├── mock-relationships.json  # Golden reference relationships for zero-token tests
├── mock-groupings.json      # Golden reference work groups for zero-token tests
├── mock-deadlines.json      # Golden reference deadlines for zero-token tests
├── eval-results.json        # Evaluation output logs (Skill 01)
├── eval-relationships-results.json # Evaluation output logs (Skill 02)
├── eval-group-work-results.json    # Evaluation output logs (Skill 03)
├── eval-deadlines-results.json     # Evaluation output logs (Skill 04)
├── eval-context-results.json       # Evaluation output logs (Skill 05)
└── eval-week-results.json          # Evaluation output logs (Skill 06)
```

### Skill 01: `extract_items`

Converts unstructured natural language (brain dumps) into structured, faithful items:

- **Types**: `task`, `project`, `idea`, `commitment`, `concern`
- **Statuses**: `pending`, `started`, `exploring`, `archived`
- **Commitments**: `external` (strict third-party commitments only), `personal` (explicit self-promises only), `none`
- **Deadlines**: Preserves raw text, resolves ISO dates only when completely unambiguous
- **Effort & Importance**: Extracted exclusively when explicitly declared by the user

### Skill 02: `detect_relationships`

Detects semantic links between items without grouping or prioritizing:

- **Relationship Types**: `same_project`, `same_objective`, `related_to`, `part_of`, `depends_on`, `blocks` (canonicalized to `depends_on`), `duplicate`
- **Strict Semantic Boundaries**: Concerns remain completely isolated, pre-conditions are strictly `depends_on` (not `part_of`), `related_to` rejects co-existence or "mientras tanto" workarounds, and mutual exclusion prevents redundant simultaneous `depends_on` and `part_of`.
- **Deterministic post-processing**: Short-circuits inputs < 2 items, strips self-relations and invalid IDs, deduplicates symmetric edges with canonical sorting.

### Skill 03: `group_work`

Synthesizes items into coherent lines of attention without deciding weekly priorities or capacities:

- **Output**: Disjoint `WorkGroup` entities (`title`, `itemIds`, `rationale`) and `ungroupedItemIds`.
- **Deterministic Invariant Engine**: Guarantees total item conservation (no lost items, no phantom items), disjoint partitions (no item in two groups), and group dissolution if $< 2$ items.
- **Short-circuits**: Returns in 0ms (0 tokens) for empty inputs, single items, or items with zero relationships.

### Skill 04: `detect_deadlines`

Detects and normalizes explicit and relative temporal constraints without prioritizing or scheduling:

- **Output**: Structured `DetectedDeadlines` (`itemId`, `raw`, `kind`, `resolvedStart`, `resolvedEnd`, `confidence`).
- **Core Principle**: Never invent a date. Distinguishes deadlines from past narrative context ("El viernes estuve hablando con Marta"). Discards vague desires ("algún día", "cuando estemos más tranquilos").
- **Deterministic Engine**: Pure UTC date math relative to `currentDate` ("hoy", "mañana", "este fin de semana", weekdays), calendar validity verification (`YYYY-MM-DD`), and range consistency (`resolvedStart <= resolvedEnd`).

### Skill 05: `evaluate_context`

Evaluates situational context, attention levels, and relevance for tasks and work groups without deciding weekly focus or schedules:

- **Output**: Structured `EvaluateContextOutput` (`itemAssessments`, `groupAssessments`, `openQuestions`).
- **Signal Taxonomy**: `external_commitment`, `approaching_deadline`, `overdue_deadline`, `explicit_importance`, `already_started`, `dependency`, `supports_declared_goal`, `waiting`, `insufficient_information`.
- **Core Principles**: Never plan or allocate hours; never invent unstated goals or deadlines; treat missing data as `unclear` instead of low importance; dependencies do not symmetrically clone deadline dates.
- **Deterministic Invariant Engine & "Code before AI"**:
  - Guarantees exact 1:1 item and group coverage (0 missing, 0 phantoms, 0 duplicates).
  - Purges phantom/duplicate IDs and validates open question references.
  - Strictly enforces that `dependency` requires an explicit, valid `depends_on` relationship (purging spurious signals inferred from `part_of`, `related_to`, or `same_project`).
  - Treats `waiting` as an objective situation descriptor that does not automatically penalize attention level.
  - Zero-token short-circuits for empty inputs.
- **Test Suite**: 169 passing unit and behavioral tests (historical Skill 05 count; now part of the global 870+ test suite) running in < 700ms with zero token expenditure.
- **Calibration**: Validated across all 25 calibration brain dumps with Mock and Groq (`qwen/qwen3.8-27b`) with 0 invariant violations.

### Skill 06: `build_week`

Synthesizes evaluated context and constraints into a realistic, calm, human-centered weekly focus proposal without taking over user decisions:

- **Output**: Structured `ProposedWeek` (`weekSummary` with plannable & protected space capacity, `foci` 0..3, `obligations`, `flexibleOptions`, `deferredItems`, `unplannedSpace`, `confirmationPrompt`).
- **Core Principles**: "AI proposes. The person decides." Never plan 100% capacity (minimum 25–30% protected space). Never invent hours or preferences (`unknown` status when unstated). 100% item conservation (0 dropped items, 0 phantom IDs, 0 duplicates). Urgent wording does not invent contractual obligations.
- **Deterministic Invariant Engine & "Code before AI"**:
  - Validates and repairs capacity math, category mutual exclusivity, and focus limits (0..3).
  - Rescues omitted items to `deferredItems` with ground-truth reasons (`not_scheduled`, `archived`, `waiting_dependency`).
  - Reclassifies false obligations (e.g. urgent tasks without deadlines or external promises) safely.
  - Zero-token deterministic planning context generator and validation.
- **Test Suite**: 108 unit, behavioral, and regression tests (including false obligations, strict TDD, and temporal discrepancy tests).
- **Calibration & Real Groq Evaluation**:
  - 25/25 sample brain dump fixtures evaluated with real Groq (`qwen/qwen3.8-27b`).
  - 25 clean passes, 0 repairs, 0 failures.
  - Validation semántica aprobada con observaciones de producto registradas (tareas puntuales pre-semana, seguimiento de delegación y diferenciación visual de compromisos futuros).
  - _Nota_: La cobertura de evaluación calibra el comportamiento pero no garantiza ausencia absoluta de errores en producción.

### Skill 07: `analyze_change`

Evaluates and explains the impact of mid-week changes, unexpected inputs, and trade-offs against an active weekly plan without taking over user decisions:

- **Output**: Structured `AnalyzeChangeOutput` (`status`, `changeType`, `summary`, `affectedElements`, `capacityImpact`, `unaffectedAreas`, `validationErrors`, `requiresUserIntervention`, `interventionReason`).
- **Change Taxonomy**: `new_item`, `drop_item`, `modified_item`, `deadline_change`, `dependency_change`, `capacity_change`, `mixed_change`, `none_detected`.
- **Core Principles**: Read-only analysis (the active plan is never modified, regenerated, or replaced). Explain what is affected without resolving conflicts or dictating priorities. Past deadlines communicate risk without forcing plan re-creation. Unblocking dependencies informs without requiring user intervention.
- **Deterministic Invariant Engine & "Code before AI"**:
  - Capacity arithmetic: computes projected balances (`unknown_capacity` when totals are unknown, `indeterminate` when estimates are incomplete, `deficit_known` when known hours exceed plannable space, `surplus_known` only when 100% of estimates fit).
  - Unambiguous relationship removal (`sourceItemId`, `targetItemId`, `type`).
  - Reference validator: captures non-existent element IDs safely in `validationErrors` with `status: "invalid_references"`.
  - Positive isolation proofs for `unaffectedAreas`.
- **Test Suite**: 34 unit and regression tests covering delta operations, capacity arithmetic, causal graphs, reference validation, and all 10 agreed change fixtures.

### Skill 08: `detect_conflict`

Detects objective and structural incompatibilities within the active plan or against incoming changes without modifying state or dictating solutions:

- **Output**: Structured `DetectConflictOutput` (`status`, `summary`, `conflicts`, `unconflictedAreas`, `hasBlockingConflicts`).
- **Conflict Taxonomy**: `capacity_deficit`, `blocked_by_dependency`, `deadline_incompatibility`, `schedule_overlap`.
- **Core Principles**: "Code before AI" (100% deterministic engine). Objective conflicts must be backed by verifiable metrics (`hours_balance`, `fixed_time_interval`, `dependency_state`, `calendar_dates`). `potential` and `insufficient_information` warnings never trigger `hasBlockingConflicts: true`.
- **Deterministic Invariant Engine**:
  - Differentiates daily capacity deficits from schedule overlaps: `schedule_overlap` strictly checks concurrent fixed intervals (`startTime < endTime`), whereas excessive daily work allocations trigger daily `capacity_deficit`.
  - Causal isolation: only `depends_on` relationships with deferred prerequisites produce blocking conflicts; thematic links (`related_to`, `same_project`) are ignored.
  - Positive isolation: only certifies `unconflictedAreas` when data and capacity are complete; never falsely certifies unknown capacity plans.
- **Test Suite**: 16 unit and canonical fixture tests covering confirmed conflicts, daily allocations, schedule overlaps, potential risks, missing data, and unconflicted plans.

---

## Quick Start

### Prerequisites

- Node.js `>= 20` (Node 22 recommended)
- npm

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment (Optional)

Create a `.env` file (see `.env.example`) or configure credentials directly in the web UI:

```bash
# Provider selection: groq | gemini | mock
AI_PROVIDER=groq

# Groq (Free tier friendly)
GROQ_API_KEY=gsk_...
GROQ_MODEL=qwen/qwen3.8-27b

# Gemini (Free tier friendly)
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.5-flash
```

### 3. Run Development UI

```bash
npm run dev
```

Open `http://localhost:5173` to test brain dumps interactively, select real-world cases, switch providers, and inspect raw JSON outputs.

### 4. Run Test Suite

Unit, behavioral, and security tests run deterministically with zero token consumption (860+ tests across 62 suites):

```bash
npm test
```

### 5. Development & Local Proxies

The web UI communicates with local Vite development middleware endpoints (`/api/ai` and `/api/calendar/fetch-ical`) configured in `vite.config.ts`:

- `/api/ai`: Forwards LLM requests while keeping `GROQ_API_KEY` and `GEMINI_API_KEY` secure on the server side, with in-memory sliding window rate limiting and credential redaction.
- `/api/calendar/fetch-ical`: Fetches external iCal calendars to calculate real committed hours without browser CORS restrictions. Protected with deep DNS-level SSRF validation (blocking loopback, RFC 1918, CGNAT, link-local, and reserved IP ranges), manual redirect hopping validation, and a strict 5 MB streaming body limit. Calendar URLs are transmitted via `POST` body to prevent credential leakage in server access logs.

> **Warning:** These proxies run exclusively as local Vite middleware (`vite` and `vite preview`) for local-first development. They are dev-only and must never be exposed to the local network or public internet using `vite --host`. Origin validation restricts requests to localhost or an explicit `ALLOWED_ORIGINS` allowlist, and an optional shared secret can be required via `AI_PROXY_TOKEN`.

### 6. Run Batch Evaluation

Evaluate the 25 calibration brain dumps through the CLI runner:

```bash
# Deterministic mock (0 tokens)
npm run eval -- --provider=mock

# Live Groq evaluation (requires GROQ_API_KEY)
npm run eval -- --provider=groq

# Specific case inspection
npm run eval -- --provider=groq --case=case-01
```

### 7. Typecheck & Build

```bash
npm run typecheck
npm run build
```

---

## Documentation & Decisions

- **Architectural Decisions:** See [ADR 0001: Conservative Semantic Extraction and AI Provider Abstraction](docs/adr/0001-conservative-semantic-extraction-and-provider-architecture.md).
- **Release History:** See [CHANGELOG.md](CHANGELOG.md).
- **Product Context:** See [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) and [MEMORY.md](MEMORY.md).

---

## Skills Roadmap

- [x] **01 extract_items** (Completed & calibrated with real LLM)
- [x] **02 detect_relationships** (Completed & calibrated with real LLM)
- [x] **03 group_work** (Completed & calibrated with real LLM)
- [x] **04 detect_deadlines** (Completed & calibrated with real LLM)
- [x] **05 evaluate_context** (Completed & calibrated with real LLM)
- [x] **06 build_week** (Completed & calibrated with real LLM)
- [x] **07 analyze_change** (Completed & verified deterministically with golden fixtures)
- [x] **08 detect_conflict** (Completed & verified deterministically with golden fixtures)
- [x] **09 propose_adjustment** (Completed & verified deterministically with golden fixtures)
- [x] **10 manage_memory** (Completed & verified deterministically with golden fixtures)
- [x] **11 close_week** (Completed & verified deterministically with golden fixtures)
- [x] **Local Persistence & Weekly Session (P1–P5)** (IndexedDB, UI integration, schedule continuity, closed week inspection & reopening)
- [x] **Radar de Imprevistos (Sections 21–25)** (Mid-week unforeseen intake, capacity recalculation, sovereign actions)
- [x] **Native Voice Dictation Mode** (Client-side Web Speech API, zero-cost, zero-dependency streaming dictation in Spanish and English)
- [x] **Google Calendar Integration (iCal & Capacity Bridge)** (Private feed sync, RFC 5545 parsing, committed hours & collision detection)
- [ ] **External Context Bridges (MCP)** (Read-only integration for Notion & Google Drive — Deferred post-v1)

---

## License

Private (UNLICENSED)
