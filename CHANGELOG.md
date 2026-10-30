# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Provider Layering & Hidden State

- **Decoupled Prompting & Parsing from Providers**:
  - Moved prompt-building and JSON parsing logic out of `GroqProvider` and `GeminiProvider` into the domain skills (`01` through `06`), keeping providers focused strictly on `completeJson`.
  - Removed hidden instance state (`lastParseResult` and `getLastParseResult()`) from `GroqProvider`.
  - Updated `BuildWeekService` and `buildWeek` to return `{ data, meta, parseResult }` directly with the proposed week.
  - Made deterministic engine imports in `mock-provider.ts` static, eliminating Vite circular/dynamic import build warnings.

## [0.20.1] - 2026-10-29

### Provider Parity & Architecture Refactoring

- **Provider Parity & Concurrency Hygiene**:
  - Implemented `buildWeek` for `GeminiProvider` using Gemini 2.5 Flash structured output, achieving parity across all skills (01-06).
  - Added generic `completeJson` method across all providers (`AIProvider`, `GroqProvider`, `GeminiProvider`, `MockProvider`, `RemoteAIProvider`).
  - Removed instance state leak (`lastRawResponse`) from `GroqProvider` to eliminate concurrency hazards across concurrent calls.
  - Eliminated `any` casts across provider consumers and parsers (`build-week/index.ts`, `evaluate-context/parser.ts`).
  - Suppressed noisy `versionchange` console warnings in `IndexedDbDatabase` during test runs (`NODE_ENV === "test"`).
  - Added provider parity unit test suite (`tests/ai-provider-parity.test.ts`, 6 tests).

### UI Modularization & Bundle Code-Splitting

- **Subcomponent Extraction**:
  - Extracted formatters, helpers, and plan item extractors into `src/web/components/weekly-session-formatters.tsx`.
  - Extracted confirmed memories view into `src/web/components/confirmed-active-memories-section.tsx`.
  - Extracted HUD and capacity details into `src/web/components/capacity-protected-space-section.tsx`.
  - Extracted carryover tasks selection into `src/web/components/carry-over-tasks-section.tsx`.
  - Dynamically resolved default target dates in `src/web/components/weekly-session-view.tsx` avoiding hardcoded date anchors.
- **Bundle Optimization**:
  - Configured Rollup `manualChunks` in `vite.config.ts` separating `vendor-react` and `vendor-zod`, ensuring all production bundle chunks stay well under the 500 kB threshold.

### Documentation & Security

- **ADR 0021 & ADR 0022**:
  - Added `docs/adr/0021-zod-advisory-mitigation-and-v4-migration-strategy.md` analyzing GHSA-mrhx-c7xc-m3w5 and outlining defensive perimeter limits and isolated v4 upgrade scheduling.
  - Added `docs/adr/0022-spanish-first-language-and-deferred-i18n.md` documenting Spanish-first native design, calm copy, and deferred i18n abstractions.
- **Evaluation & Tooling Cleanup**:
  - Added real-plan evaluation pipeline suite for deterministic skills 07–11 (`tests/skills-07-to-11-real-plans-eval.test.ts`, 25 tests), executing change analysis, conflict detection, adjustment proposals, and reflective closing on real benchmark outputs.
  - Removed obsolete duplicated script `scripts/eval-relationships.ts`.
  - Silenced test environment console noise in IndexedDB repositories and parser when `NODE_ENV === "test"`.
- **Server Proxies Security Hardening (`src/server/calendar-proxy-handler.ts`, `src/server/ai-proxy-handler.ts`)**:
  - Implemented deep asynchronous DNS resolution validating all resolved IPv4 and IPv6 addresses against private and reserved IP ranges (blocking loopback, RFC 1918, CGNAT `100.64.0.0/10`, link-local, multicast, documentation ranges, `0.0.0.0`, and `[::1]`).
  - Mitigated redirect bypass and bounce attacks via manual redirect handling (`redirect: "manual"`) re-validating every redirect target.
  - Added streaming body reader with strict 5 MB cutoff (`MAX_ICS_BYTES`) to prevent memory exhaustion.
  - Replaced `GET` query parameter with `POST` JSON body for calendar fetching, preventing private feed URL token leaks in web server logs.
  - Added in-memory sliding-window rate limiting (`SimpleRateLimiter`) for both AI and Calendar proxies.
  - Restricted CORS headers to local dev / matching host origins, removing wildcard `*`.
- **Infrastructure & Tooling**:
  - Added GitHub Actions CI workflow (`.github/workflows/ci.yml`) covering `npm ci`, `typecheck`, `test`, and `build`.
  - Added `LICENSE` (Private / UNLICENSED) and `package.json` engines requirement (`>=20`).
  - Included `scripts` and `vite.config.ts` in `tsconfig.json`.
  - Corrected Groq model label in UI to `Qwen 2.5 32B` (`qwen/qwen3.8-27b`).
  - Refreshed test documentation to reflect 829 passing tests across 60 test files.
- **Testing**:
  - Added dedicated security hardening test suite (`tests/server-proxies-hardening.test.ts`, 19 tests).

## [0.20.0] - 2026-10-23

### Added

- **Google Calendar iCal Integration & Committed Capacity Analysis**:
  - Implemented zero-cost, zero-dependency calendar integration supporting Google Calendar private iCal feeds and `.ics` file imports (`src/domain/calendar.ts`, `src/infrastructure/calendar/ical-parser.ts`).
  - RFC 5545 compliant parser handling line unfolding, UTC/local/all-day date-times, text unescaping, cancellation status filtering, and weekly recurrence rule (`RRULE:FREQ=WEEKLY`) expansion.
  - Automatic committed hours calculation (`calculateCalendarWeekSummary`) generating daily constraints (`DayConstraint[]`) and schedule time blocks (`TimeBlock[]`) for collision and overlap detection.
  - Local anti-CORS development proxy with strict SSRF protection (`src/server/calendar-proxy-handler.ts`, `vite.config.ts`), validating URLs and rejecting private IP / loopback requests.
  - Calm UI integration (`src/web/components/calendar-sync-card.tsx`) in the weekly planning workspace (`src/web/components/weekly-planning-from-notes.tsx`) with local URL persistence, event list preview, and automatic available capacity adjustment.
  - **1-Click Google Calendar Push & Week Export (`src/web/components/weekly-session-view.tsx`, `src/domain/calendar.ts`)**:
    - Added individual `📅 Google Cal` action button on each scheduled task in "Agenda y tareas de la semana", opening Google Calendar with date, time, duration, and notes pre-filled via `buildGoogleCalendarTemplateUrl`.
    - Added `📅 Exportar semana (.ics / Google Cal)` batch export button generating an RFC 5545 `.ics` file via `generateIcsCalendarExport` ready for 1-click drag/import into Google Calendar.
- **ADR 0020**:
  - Documented Google Calendar iCal integration architecture and capacity deduction rationale in `docs/adr/0020-google-calendar-ical-integration.md`.
- **Testing & Verification**:
  - Added unit test suites:
    - `tests/calendar-domain.test.ts` (5 tests).
    - `tests/calendar-ui-integration.test.tsx` (6 tests).

## [0.19.0] - 2026-10-23

### Added

- **Native Voice Dictation Mode (`src/web/hooks/use-speech-recognition.ts`, `src/web/components/voice-dictation-button.tsx`)**:
  - Implemented client-side voice dictation powered by the browser's native Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`), adhering strictly to the zero-cost (free-tier first) and zero-dependency architecture.
  - Streaming continuous voice recognition with real-time interim results and automatic stream drop recovery.
  - Multi-language support with instant toggle between Spanish (`es-ES`) and English (`en-US`).
  - Seamless text accumulation that preserves pre-existing user notes without destructive overwrite.
  - Integrated into:
    - Initial Brain Dump planning notes input (`src/web/components/weekly-planning-from-notes.tsx`).
    - Mid-planning additional notes textarea (`src/web/components/weekly-planning-from-notes.tsx`).
    - Active week Unforeseen Events Radar input (`src/web/components/weekly-session-view.tsx`).
  - Graceful fallback with calm indicator (`🎙️ (Voz no soportada)`) on browsers without native Web Speech API support.
- **ADR 0019**:
  - Documented native voice dictation architecture and MCP context integration roadmap in `docs/adr/0019-native-voice-dictation-and-mcp-integration-architecture.md`.
- **Testing & Verification**:
  - Added unit test suite `tests/voice-dictation.test.tsx` verifying API detection, fallback rendering, active button states, transcript preservation, language switching, and disabled attributes (8 tests).

## [0.18.0] - 2026-10-23

### Added

- **Unforeseen Events Radar Application Pipeline (`src/application/radar-pipeline.ts`)**:
  - Implemented end-to-end evaluation pipeline for mid-week unforeseen events (Sections 21-25 of `PROJECT_CONTEXT.md`).
  - Classifies incoming events into 4 distinct verdicts:
    - 🟢 `no_change`: Pure ideas or concerns without commitment do not alter the active plan.
    - 🟡 `flexible_option`: Uncommitted or optional tasks ("si me da tiempo") that can be executed if calm margin allows.
    - 🟢 `fits_available_space`: Commitments or tasks that fit within the remaining calm margin without moving weekly foci.
    - 🔴 `changes_balance`: Events that create temporal collisions or exceed plannable capacity, generating actionable trade-off alternatives via Skill 09 (`proposeAdjustment`).
- **Active Week Radar UI & Human Decision Actions (`src/web/components/weekly-session-view.tsx`)**:
  - Integrated radar intake card (`data-testid="radar-section"`) directly in "Mi semana" (active week space).
  - Added interactive decision buttons:
    - **"Añadir a mi semana"** (`radar-add-to-week-button`): Incorporates items atomically into the active plan (as obligations if external/hard deadline, or flexible options) and assigns daily allocations if deadline falls in the active week.
    - **"Añadir como opciones flexibles"** (`radar-add-as-flexible-button`): Incorporates all items into `flexibleOptions` without touching calm margin or primary foci.
    - **"Descartar"** (`radar-cancel-button` / `radar-dismiss-button`): Dismisses the radar notice cleanly with zero state mutation.
    - **"Aplicar este ajuste"** (`apply-radar-proposal-${prop.id}`): Applies AI-suggested adjustment proposals when balance changes.
  - Resolved synthetic ID collision bug by ensuring guaranteed unique IDs (`item-radar-...`) preventing newly incorporated items from being dropped by UI deduplication against pre-existing items.
  - Surfaced immediate inline persistence error feedback in the radar box.
- **Deterministic Extractor Hardening (`src/providers/mock-deterministic-extractor.ts`)**:
  - Added vocabulary for common English action verbs (`COMMON_ENGLISH_ACTION_VERBS`).
  - Expanded `splitCoordinatedActions` to decompose telegraphic lists in Spanish and English (e.g. `"Aws certification, apps update, job search open possibilities, think Manne substack"` → 4 distinct items).
  - Protected compound emotion/concern clauses (e.g. `"Me preocupa no llegar a tiempo con la entrega, siento mucho estrés"`) from erroneous fragmentation.
  - Automatically re-attaches trailing effort clauses (`", me llevará 2 horas"`) to the preceding task item rather than extracting them as isolated tasks.
  - Corrected Unicode boundary regexes (`(?:\s+|$)` instead of `\b`) for accented Spanish duration expressions.
- **ADR 0018**:
  - Documented in `docs/adr/0018-radar-unforeseen-intake-and-plan-incorporation.md`.
- **Testing & Verification**:
  - Added test suites:
    - `tests/radar-pipeline.test.ts` (6 tests).
    - `tests/radar-ui-integration.test.tsx` (5 tests).
    - Added English telegraphic and comma-separated task tests to `tests/mock-deterministic-extraction.test.ts`.
  - Reached 789 passing tests across 56 test files (100% green).

## [0.17.0] - 2026-10-21

### Added

- **Compensating Transaction Pattern in Persistence (`WeeklySessionService`)**:
  - Implemented rollback snapshots in `createOrSavePlanAndSchedule` ensuring pre-existing plans are safely restored if a schedule write fails, avoiding destructive plan deletion.
  - Added optimistic locking support via `expectedScheduleVersion` with automatic version incrementing for existing schedules.
- **Data Sovereignty & Local Backup Engine (`src/infrastructure/storage/indexeddb/backup.ts`)**:
  - Added schema-validated (`UserDataBackupSchema`, version 1) export and import across all 4 IndexedDB stores (`plans`, `schedules`, `closeReports`, and `memories`).
  - Implemented both `merge` (non-destructive union) and `replace` (clean wipe and restore) import modes.
  - Added memory archiving (`archiveMemory`) and hard deletion (`deleteMemory`) to support the user's right to be forgotten.
- **Session Resume Context Enhancement**:
  - `resumeSession()` now returns confirmed active memories when there is no active session (`no_active_session`), ensuring immediate access to personal context during week preparation.
  - Multi-draft cleanup now selectively removes drafts for the specific target week without affecting drafts of other weeks.
- **Dependency Upgrades with Context7 Audit**:
  - Safely upgraded `groq-sdk` from `^0.15.0` to `^1.6.0`, verified with Context7 documentation to ensure provider boundary isolation in `src/providers/groq-provider.ts`.
  - Applied safe minor and patch dependency updates via SemVer (`@google/genai`, `react`, `react-dom`, `vite`, `fake-indexeddb`).
- **ADR 0017**:
  - Documented in `docs/adr/0017-local-persistence-resilience-data-sovereignty-and-dependency-isolation.md`.
- **Testing & Quality Assurance**:
  - Added regression test suites:
    - `tests/phase1-stabilization-regression.test.ts`
    - `tests/phase2-sovereignty-and-resilience.test.tsx`
    - `tests/planning-clarity-and-item-adjustment.test.tsx`
  - Reached 776 passing tests across 54 test files (0 failures).

---

## [0.16.0] - 2026-10-15

### Added

- **Strict 3-Foci Limit & Full Item Conservation Invariant**:
  - Resolved `Array must contain at most 3 element(s)` Zod schema validation failure when activating weeks planned from 7 or more extracted items.
  - Enforced domain constraint of at most 3 primary weekly foci (`foci.length <= 3`) in `deterministic.ts`.
  - Automatically preserves excess focus candidate items into `deferredItems` (`reason: "out_of_capacity"`) without silent loss, duplication, or ID spoofing.
  - User manual inclusion of items when 3 foci already exist now routes to `flexibleOptions` with transparent explanation.
  - Added regression test suite `tests/seven-items-and-foci-limit-regression.test.ts` verifying end-to-end extraction, draft saving, reloading, and activation.
- **Top HUD Capacity Bar & Visual De-cluttering**:
  - Re-architected `CapacityProtectedSpaceSection` in `WeeklySessionView` into a sleek horizontal HUD bar showing available, planned, plannable, protected, and remaining hours alongside the capacity status badge.
  - Slim 6px visual cognitive budget progress bar.
  - Nested extended formulas, philosophical quotes, and metric calculation cards into an accessible progressive disclosure accordion (`<details className="calm-details">`).
- **Calm Task Adjustment & Auto-closing Feedback**:
  - Converted task adjustment section (`adjustment-proposal-box`) into a collapsible panel.
  - Unified hour estimation and daily assignment into a single "Guardar cambios" action that persists to both plan and schedule in IndexedDB.
  - The adjustment panel automatically collapses upon save, displaying a calm green confirmation notice with quick access to adjust further tasks.
  - Added explicit "Cerrar" button to cancel editing without saving.
- **Visual Design Clean-up**:
  - Removed artificial washi tape pseudo-element motif (`.washi-card::before`) in `style.css` to eliminate visual noise ("pegote").
  - Normalized task and focus cards across `WeeklySessionView` and `WeeklyPlanningFromNotes` to clean `.item-card` styling.
  - Simplified first navigation tab label from `1. Capturar (Volcado & Extracción)` to **`1. Capturar ideas`** in `App.tsx`.
- **ADR 0016**:
  - Documented in `docs/adr/0016-focus-capacity-conservation-and-calm-adjustment-experience.md`.

---

## [0.15.0] - 2026-10-14

### Added

- **Guided 4-Space Navigation Architecture**:
  - Reorganized application navigation into four conscious spaces (_Capturar_, _Preparar semana_, _Mi semana_, _Revisar y aprender_).
  - Clear primary actions per view with progressive disclosure of secondary options.
  - Independent session state: drafting a new week no longer forces closing or mutating the currently active week.
  - "Comenzar semana desde cero" action cleanly clearing stored drafts in IndexedDB.
- **Progressive Disclosure & Human-Centered Capacity Language**:
  - Replaced repetitive formula cards with a compact summary strip and collapsible calculation breakdown (`<details className="calm-details">`), closed by default.
  - Humanized capacity labels:
    - _«Resumen de viabilidad y capacidad»_ $\to$ **Balance de tu semana**.
    - _«Presupuesto de energía cognitiva»_ $\to$ **Tu tiempo de un vistazo**.
    - _«Espacio protegido»_ accompanied by the subtitle **Margen de calma**.
    - _«Capacidad desconocida»_ $\to$ **Tareas sin estimar** when items lack explicit hours.
    - Remaining hours indicator shows `Hasta Xh` instead of the alarming `"Desconocido"`.
- **Deterministic Coordinated Action Decomposition**:
  - Introduced `normalizeFusedWords` in `mock-deterministic-extractor.ts` to separate fused fast-typing words (e.g. `"quieroavanzar"` $\to$ `"quiero avanzar"`).
  - Introduced `splitCoordinatedActions` to decompose compound natural language clauses into separate tasks when subsequent parts start with action verbs (_"avanzar X, estudiar Y y seguir con Z"_ $\to$ 3 separate items), while preserving noun lists (_"Comprar manzanas, peras y plátanos"_).
  - Enhanced `cleanTitle` and `extractProject` to strip conversational prefixes and automatically associate project contexts.
- **ADR 0015**:
  - Documented in `docs/adr/0015-progressive-disclosure-guided-navigation-and-human-capacity-language.md`.
- **Testing & Quality Assurance**:
  - Added full navigation flow tests in `tests/ux-navigation-flow.test.tsx`.
  - Added unit and regression tests for coordinated actions in `tests/mock-deterministic-extraction.test.ts`.
  - 50 test files, 746 tests passing with 0 errors.

---

## [0.14.0] - 2026-10-14

### Added

- **Closed Week Detailed Inspection (`ClosedWeekSummary`)**:
  - Expandable accordion in `WeeklySessionView` («Ver detalle de la semana» / «Ocultar detalle») allowing full audit of closed week contents without mutating state:
    - Planned foci with desired outcomes and estimated hours.
    - Fixed obligations and commitments with due dates.
    - Flexible options and execution conditions.
    - Granular item-by-item breakdown with disposition badges (_Completada_, _Postergada_, _En progreso_, _Descartada_, _Sin reportar_), actual hours vs. estimated hours, notes, and postponement rationales.
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
  - Implemented `EvaluateContextService` answering _"What context matters to understand the situation of each task and line of work?"_ without building the weekly plan, deciding trade-offs, or dictating actions.
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
  - Implemented `DetectDeadlinesService` answering _"When does this need to happen according to what the person said?"_ without prioritizing, scheduling, or estimating effort.
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
  - Implemented `GroupWorkService` answering _"What elements belong to the same coherent line of work?"_ without prioritizing or weekly planning.
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
  - 25 sample Spanish brain dumps in `cases/sample-dumps.json`.
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
