# ADR 0004: Detect Deadlines — Temporal Reference Normalization without Prioritization

## Status

Accepted

## Context

Following Skill 01 (`extract_items`), Skill 02 (`detect_relationships`), and Skill 03 (`group_work`), the pipeline needs to extract and normalize temporal constraints from user input.

Before planning or scheduling work into a week (Skill 06 `build_week`) or evaluating personal context and energy (Skill 05 `evaluate_context`), the system must accurately understand *when* work is expected to happen according to what the person explicitly said:
- **Never invent dates**: If the user didn't mention a deadline, horizon, or date, the system must never hallucinate one (e.g. turning "Quiero preparar el examen AWS" into "este mes" or "antes de diciembre").
- **Strictly separate deadlines from priorities**: A deadline answers *"When does this need to happen according to the person?"*, never *"What should I do first?"*, *"What is more urgent?"*, or *"What should fit into this week?"*.
- **No transitive inheritance via dependencies**: If Task A depends on Task B, Task B does not inherit Task A's deadline in Skill 04. Skill 04 extracts only what was expressed for each item.
- **Differentiate future deadlines from past narrative context**: Mentions of past events ("El viernes estuve hablando con Marta") provide context, not deadlines.
- **Deterministic resolution anchored to `currentDate`**: Relative terms ("mañana", "este fin de semana", "el viernes") must be resolved deterministically relative to an explicit anchor date using UTC calendar calculations, preventing timezone drift.
- **Handle intervals as single units**: Ranges ("del 10 al 12", "entre lunes y miércoles") represent a single temporal horizon with `resolvedStart` and `resolvedEnd`, never two separate deadlines.
- **Filter vague desires**: Expressions like "cuando estemos más tranquilos", "algún día", or "cuando pueda" are not deadlines and must produce `deadlines: []`.

## Decisions

### 1. Domain Modeling (`src/domain/deadlines.ts`)

Defined explicit Zod schemas and TypeScript types:
- `DeadlineKind`: `"exact_date" | "relative_date" | "date_range" | "recurring" | "unspecified"`.
- `DetectedDeadline`:
  - `itemId`: Valid extracted item ID.
  - `raw`: Verbatim text segment expressing the temporal constraint.
  - `kind`: `DeadlineKind`.
  - `resolvedStart`: Normalized `YYYY-MM-DD` ISO date string or `null`.
  - `resolvedEnd`: Normalized `YYYY-MM-DD` ISO date string or `null`.
  - `confidence`: `"high" | "medium" | "low"`.
- `DetectedDeadlines`: `{ deadlines: DetectedDeadline[] }`.
- `DetectDeadlinesInput`: `{ items: ExtractedItem[], currentDate: string, locale?: string }`. Validates that `currentDate` is a valid calendar date in `YYYY-MM-DD`.

### 2. Deterministic Temporal Engine (`src/skills/detect-deadlines/deterministic.ts`)

Implemented pure UTC deterministic logic:
- **`isValidIsoDate`**: Rigorously verifies format and Gregorian calendar validity (rejecting leap year anomalies like Feb 29 in non-leap years, Feb 30, etc.).
- **`isVagueNonDeadline`**: Detects and purges non-actionable wishes ("algún día", "más adelante", "cuando estemos más tranquilos", "cuando pueda", "en algún momento", "no corre prisa").
- **`resolveDateDeterministically`**:
  - "hoy" $\rightarrow$ `currentDate`
  - "mañana" $\rightarrow$ `currentDate + 1` day
  - "pasado mañana" $\rightarrow$ `currentDate + 2` days
  - "este fin de semana" $\rightarrow$ Saturday .. Sunday range
  - Day-of-week terms (lunes a domingo) $\rightarrow$ calculates next occurrence without timezone ambiguity.
- **`cleanAndValidateDeadlines` & `validateDeadlinesInvariants`**:
  - Drops phantom item IDs.
  - Discards empty `raw` strings.
  - Eliminates vague entries.
  - Ensures ISO date validity and chronological consistency (`resolvedStart <= resolvedEnd`, auto-swapping if inverted).
  - Deduplicates identical raw references per item.

### 3. Service Layer & Provider Integration (`src/skills/detect-deadlines/index.ts`)

- Implemented `DetectDeadlinesService` and functional wrapper `detectDeadlines(provider, input, options)`.
- **Zero-Token Short-Circuit**: If `input.items.length === 0`, returns `{ deadlines: [] }` in 0ms without invoking AI.
- Updated `AIProvider` interface with `detectDeadlines`.
- Implemented `MockProvider.detectDeadlines` backed by golden mock dataset `cases/mock-deadlines.json` (cases 01–25).
- Implemented structured JSON completion in `GroqProvider` and `GeminiProvider`.

### 4. Testing & Evaluation Suite

- Added `tests/deadlines-domain.test.ts` (15 unit tests covering Zod schemas, ISO calendar validation, vague expression filters, deterministic date math, and chronological ordering).
- Added `tests/detect-deadlines.test.ts` (11 behavioral tests covering exact dates, relative anchors, ranges, weak horizons, past narrative context distinction, phantom stripping, and mock integration).
- Total test suite expanded to 113 tests passing in < 500ms.
- Integrated `runSkill04Evaluation` into `scripts/eval-cases.ts` with dedicated script `npm run eval:deadlines`.

## Consequences

- **Positive**: Clean temporal normalization contract ready for downstream consumption by Skill 05 (`evaluate_context`) and Skill 06 (`build_week`).
- **Positive**: Zero hallucinated deadlines: system remains faithful to user statements and respects calm AI principles.
- **Positive**: Full test coverage and offline reproducibility with `MockProvider`.
