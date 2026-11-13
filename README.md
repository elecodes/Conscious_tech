# Conscious Tech

> A personal clarity notebook and conscious AI companion designed to reduce noise, protect attention, and help people choose what matters each week.

---

## Estado de la vista de prueba

Trabajo guardado en `codex/ux-step-by-step`; todavía no integrado en `main`.
El calendario permite repartir horas entre días, mover asignaciones y mostrar u
ocultar el panel de semanas. Las tareas aplazadas o fuera de semana aparecen en
una bandeja encima de los días: arrástralas o usa «Añadir a un día» y confirma día
y horas. Las tarjetas de un solo día ofrecen «Ajustar horas» en formato compacto. Las
instrucciones y la leyenda se consultan desde desplegables de ayuda.

El dictado de tareas permite decir «siguiente» para empezar otra línea;
«siguiente tarea» sigue siendo válido.
Por ejemplo: «Comprar pan, siguiente, estudiar Python». Se puede desactivar
«Separar tareas por voz» en las opciones para dictar texto libre. No se usan las
pausas ni los números como separadores. La persona ha confirmado que la repetición
de frases en Chrome ya está corregida; queda probar el nuevo comando con voz real.

Cada tarjeta del borrador permite «Editar tarea». «Más acciones → Editar intención
o elementos» abre un editor visible; guardar conserva identidad, horas y días.
«Añadir más ideas» abre directamente el campo de notas y conserva las tareas previas.

Las tareas ya incluidas sin día aparecen encima del calendario en «Por asignar a
un día». Puedes arrastrarlas o usar «Elegir día» y confirmar día/horas. Asignar un
día conserva su inclusión, recuento y estimación semanal; las horas compartidas
siguen protegidas. El dictado sigue dependiendo de la precisión del navegador y
puedes corregir sus resultados con «Editar tarea». Las completadas permanecen
visibles en el calendario; puedes completar en la tarjeta o abrir su panel local.

Última verificación: consulta el registro de la rama y las secciones de cada funcionalidad;
las pruebas incluyen tipos, lint, compilación y recorrido de navegador.
El recorrido completo del navegador pasó en preview y desarrollo, incluida captura,
edición, recarga y anexado. Las pruebas de voz usan eventos simulados del servicio.
No se ha publicado una nueva versión.

Seguimiento: [plan UX](docs/ux-improvement-plan.md) y
[ADR 0029](docs/adr/0029-calendar-first-planning-and-task-recovery.md).

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
    ├── 0022-spanish-first-language-and-deferred-i18n.md
    ├── 0023-proxy-hardening-and-provider-decoupling.md
    ├── 0024-domain-decoupling-browser-smoke-tests-and-privacy-hardening.md
    ├── 0025-ui-simplification-and-progressive-disclosure.md
    ├── 0026-reminders-and-email-summary.md
    ├── 0027-guided-flow-and-card-simplification.md
    └── 0028-calendar-bridge-and-email-summary-polish.md
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
│   ├── calendar.ts          # CalendarEvent, CalendarWeekSummary, 1-click & RFC 5545 ICS export
│   ├── reminders.ts         # Local reminder preferences & VALARM offsets
│   ├── email-summary.ts     # Client-side plain-text summary & mail compose URLs
│   ├── schedule.ts          # WeeklySchedule re-export facade
│   ├── schedule-types.ts    # Schedule types & schemas (no circular dependencies)
│   ├── schedule-invariants.ts # Schedule invariant validators
│   └── schedule-adjustment-applier.ts # Plan & schedule adjustment applier
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
│   │   ├── deterministic/   # Submodules: capacity-math, planning-context, validation, repair
│   │   ├── deterministic.ts # Re-export facade
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
    ├── labels.ts            # Localized Spanish labels for domain enums
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

Run the command inside this repository on your own computer, then open the URL
printed by Vite (normally `http://localhost:5173`). A server running in a remote
Codex environment is not your computer's localhost.

Start by writing notes, or expand **Probar con un ejemplo**. The default **Modo de
prueba** uses local mock processing; real AI providers are available in **Ajustes**
when server credentials are configured.

Before continuing, optionally enter your free hours after existing commitments,
review the target dates, and adjust protected space (25% by default). Choose
**No lo sé todavía** to receive a provisional proposal without a capacity claim.
Imported calendar commitments are a reference and are not deducted again.

Choose **Ver mis tareas en el calendario** to go directly from notes to an editable
weekly calendar. Each task lets you adjust hours, choose a day, include it in this
week or leave it for later. Deadlines remain separate from chosen days; unknown
hours stay unestimated. Changes are saved in the local draft, with a visible retry
if saving fails. Shared focus estimates are adjusted as a whole in advanced options.

Use **Repartir horas** on a draft or active task to distribute its effort across
multiple days: for example, 5 hours as 2 Monday + 2 Wednesday + 1 Friday. The form
shows allocated and remaining effort and rejects totals above the task's budget.
Partial distribution is allowed. Each calendar day shows only its portion; dragging
that portion moves only those hours. Pending counts and weekly estimates still
count one task. Fixed-time blocks retain their dedicated controls, and shared
focus estimates are never arbitrarily divided between their sources.

Draft distributions survive reload and become daily allocations on activation.
Active edits use expected schedule versions and preserve other tasks. Updating the
total effort alone keeps an existing distribution. Calendar, month/sidebar views,
ICS downloads and email summaries retain the distinct days and portions.

You can add free hours later with **Añadir horas disponibles**, directly above the
draft calendar or beside the active week's balance. **Guardar disponibilidad**
recalculates capacity without regenerating tasks or changing their assigned days.
Unknown hours mean **Por definir**; zero explicitly means no time is available.

Use **Guardar y activar semana** when ready. **Ver detalle del plan** is optional,
and **Opciones avanzadas** retains source corrections, capacity, focus controls and
imports. Returning to your notes without edits preserves the calendar decisions.
Calendar export and sharing are available from **Mi semana** after activation.

**Mi semana** starts with a task calendar showing its actual week range. The
**Pendientes** filter hides completed/dropped work; **Todas** restores it. Only
saved assignments or explicitly chosen days appear in day columns. Weekly work without a day stays in a
separate section, and deadlines are labeled without becoming calendar assignments.
Drag included draft tasks onto a day or back to **sin día elegido**; the date
field remains available for touch and keyboard. In the active week, simple daily
allocations or single fixed blocks can be dragged between days, or moved with
the compact **Cambiar día** menu inside that task's card. Every included task has
its own menu; complex assignments open their existing task controls. Saving keeps
neighbouring menus in place, and feedback names the task that changed. Fixed
blocks keep their start/end time; existing domain checks reject
collisions or excess capacity, and **Deshacer** remains available. Split assignments
keep their detailed movement controls.

Colour, text and symbols distinguish placement and progress: amber **Sin día**,
blue **Programada**, green **Completada**, purple **Aplazada**, and grey notes or
excluded work. The calendar opens with **Todas**, so completed tasks remain in
place with a check, green colour and a struck-through name. **Pendientes** is an
explicit optional filter. Complete directly on the card or click its name to open
a local task panel; the panel does not scroll to lower sections. Undo of the latest
completion remains available under the existing version rules.

The collapsible **Mis semanas** sidebar shows the active week, saved drafts and
explicitly rescheduled destinations with their tasks and separate availability.
On smaller screens it becomes a collapsible panel above the content. Choose
**Organizar esta semana** to open that exact week. Rescheduled tasks remain visible
as **Reprogramada · por incluir** until you choose them for the destination calendar;
they are never silently activated. Their source cards and individual effort are
retained after generating a draft and reloading. The reschedule preview's capacity
notice refers to the destination week, not the active week.

Open **Nueva semana → Mes y otras semanas** for a monthly overview of active work
and saved drafts. Choose a day or a saved week to open its weekly editor. Future
weeks are separate drafts, and undated tasks stay listed by week. Switching weeks
saves the current draft first; changed notes/general settings must be updated
before switching. Month navigation never activates another week automatically.
Select a task to open its existing management controls.

The active week also retains focus areas and commitments. Optional and deferred
entries remain under **Si queda espacio** and **Fuera de esta semana**. Open a focus
to inspect its contributing items. Agenda details and exports are secondary;
exports and weekly closing still include the complete inventory.

Open **Calendario y compartir** to choose reminders and **Descargar calendario
(.ics)**, then import the file in your calendar. Importing calendars is a one-time
reference, not a live connection. Email actions prepare a draft for you to review
and send; **Copiar resumen** copies the full text. In **Ajustes**, browser storage
and backups are separate from AI processing: Mock uses no external AI, while Groq
and Gemini receive your notes and required context when you generate.

Daily completion and last-compatible-action undo are available on individual plan
items in Mi semana. Results survive reload, prefill closing and retain corrections
on reopening. Open **Más → Mover una asignación** to select a fixed block or a
quantity of daily hours. Moving one preserves the other and the total duration or
hours; the latest compatible movement can also be undone after reload. A stale
closing requires a fresh review. **Más → Aplazar elemento** asks for a reason and
an optional future destination. Postponed work stays accessible under **Aplazados
durante la semana**; it becomes a candidate, not an automatic commitment in another
week. Undo restores its assignments while the version remains compatible. The persistence,
closing, reopening and carryover behavior, with incremental delivery gates, is
recorded in [the daily-actions design](docs/daily-actions-design.md).

### Tu cuaderno: guardado e historial

La semana activa, sus tareas, asignaciones, estados y los borradores se guardan en
IndexedDB del navegador. Al cerrar y volver a abrir la app con el **mismo perfil y
la misma dirección**, se recupera la semana activa, aunque su fecha ya haya pasado.
Cambiar de fecha no la borra ni la cierra automáticamente.

Al usar **Cerrar semana**, se conservan el plan, la agenda y el informe de cierre.
En **Mis semanas → Semanas anteriores** puedes consultar cualquier semana cerrada,
con sus tareas, resultados y reflexión. Consultarla no reactiva esa semana ni
sustituye la activa. Los registros incompletos se indican y no se eliminan.

El cuaderno es local: `http://localhost:5180` y `http://localhost:5181` tienen datos
separados, igual que distintos navegadores, perfiles o equipos. No hay sincronización
en la nube. Usar navegación privada o borrar los datos del sitio puede eliminar el
almacenamiento; conviene descargar copias periódicas desde **Ajustes → Tus datos**.
Los ajustes muestran la dirección exacta del cuaderno actual.

La copia JSON incluye semanas activas/cerradas, borradores, agendas, cierres y
recuerdos. **Restaurar reemplaza** los datos de la dirección actual y pide confirmación;
si hay información en dos puertos, descarga primero una copia de cada uno antes de
restaurar cualquiera. Cambiar de puerto por sí solo no traslada ni borra el otro cuaderno.

### 4. Run Test Suite

Unit, behavioral, and security tests run deterministically with zero token consumption (1,049 tests across 79 suites):

```bash
npm test
```

### 5. Development & Local Proxies

The web UI communicates with local Vite development middleware endpoints (`/api/ai` and `/api/calendar/fetch-ical`) configured in `vite.config.ts`:

- `/api/ai`: Forwards LLM requests while keeping `GROQ_API_KEY` and `GEMINI_API_KEY` secure on the server side, with in-memory sliding window rate limiting and credential redaction.
- `/api/calendar/fetch-ical`: Fetches external iCal calendars to calculate real committed hours without browser CORS restrictions. Protected with deep DNS-level SSRF validation (blocking loopback, RFC 1918, CGNAT, link-local, and reserved IP ranges), manual redirect hopping validation, and a strict 5 MB streaming body limit. Calendar URLs are transmitted via `POST` body to prevent credential leakage in server access logs.

> **Warning:** These proxies run exclusively as local Vite middleware (`vite` and `vite preview`) for local-first development. They are dev-only and must never be exposed to the local network or public internet using `vite --host`. The real protections against unauthorized access are strict Origin header validation (restricting requests to localhost or an explicit `ALLOWED_ORIGINS` allowlist) and binding exclusively to localhost. An optional dev guard token can be configured via `AI_PROXY_TOKEN` and `VITE_AI_PROXY_TOKEN` (acting as a dev guard, not a secret or security boundary for browser clients, since `VITE_*` variables are bundled into client code).

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

### 7. Typecheck, Lint & Build

```bash
npm run typecheck
npm run lint
npm run format:check
npm run check:cycles
npm test
npm run build
npm run test:smoke
```

---

## Verification Checklist

Manual checks for release verification:

- [ ] First CI run on the merged branch.
- [ ] Import the downloaded .ics into Google Calendar and confirm 09:00 for all-day items and 1 hour before for timed items.
- [ ] Usability test with 2-3 people who have not seen the app.

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

### Copia opcional para Notion

En «Mi semana», abre las opciones de calendario/exportación y pulsa **Exportar para Notion (.csv)**. También está disponible al consultar una semana del historial.

En Notion web o escritorio: **Ajustes → Importar → CSV**. Comprueba que `Fecha` sea una propiedad Fecha y crea una vista Calendario usando esa propiedad. El CSV usa mes/día/año, según el [importador de Notion](https://www.notion.com/help/import-data-into-notion).

Cada reparto diario o bloque tiene su propia fila y horas. Las tareas sin día y las horas pendientes de repartir siguen en la tabla; la fecha límite no asigna un día. Los horarios fijos se incluyen como texto en `Horario`.

Es una copia puntual, sin conexión de cuentas ni sincronización. Reimportar puede duplicar filas. No sustituye la copia JSON del cuaderno y no crea automáticamente la vista de calendario en Notion. Mantén `http://localhost:5181` para seguir usando el mismo guardado local.

### Conectar Notion y enviar directamente (vista de prueba local)

En «Mi semana → Calendario y compartir», o al consultar una semana cerrada:

1. Pulsa **Conectar Notion** y autoriza la conexión en la ventana de Notion. Autorizar por sí solo no crea el calendario.
2. Al volver se abre la revisión de las entradas y del espacio de destino. Si la cuenta ya estaba conectada, pulsa **Enviar calendario a Notion**.
3. Pulsa **Confirmar y enviar**. Cuando termine, usa **Abrir calendario en Notion**.

Se crea una base privada nueva con vista Calendario; las entradas sin día quedan en su tabla. Es un envío puntual, no sincronización. Una semana modificada genera otra copia. Si un envío queda incompleto, revisa su enlace: no se repite automáticamente. El CSV sigue disponible como alternativa. Las notas originales y el cuaderno completo no se envían.

La conexión utiliza el [MCP oficial de Notion con OAuth y PKCE](https://developers.notion.com/guides/mcp/build-mcp-client). No pide copiar claves. Los permisos efectivos se muestran al autorizar en Notion. **Desconectar** retira las credenciales de esta sesión de la app; no elimina las copias enviadas. También puedes revocar el permiso desde Notion.

**Configuración local:** mantener `http://localhost:5181`. Si eliges otro origen, configura `NOTION_APP_ORIGIN` en `.env.local` y reinicia el servidor. Las credenciales cifradas y su clave se guardan en `.notion-local/` (excluida de Git); opcionalmente configura `NOTION_STORAGE_DIR` con una ruta privada. No publiques ni compartas esa carpeta. La sesión dura siete días y sobrevive al reinicio del servidor; cambiar origen, borrar cookies o eliminar la carpeta requiere conectar de nuevo. Esto no modifica el almacenamiento local de tareas.

Disponible con el servidor Node de desarrollo y preview; un despliegue estático no incluye las rutas de conexión. Esta implementación es un piloto de un único proceso local, verificado con 1.120 pruebas y recorrido de navegador simulado, pendiente de validar con una cuenta real; no está preparada como servicio público con múltiples réplicas. Detalles en [ADR 0031](docs/adr/0031-direct-notion-mcp-calendar-delivery.md).

Si la autorización no termina, la ventana muestra un error legible y un enlace para volver. La app comprueba la conexión mientras esperas, aunque Notion separe ambas ventanas. Los códigos `NOTION_AUTH_HTTP_…`, `NOTION_AUTH_RESPONSE` y `NOTION_CALENDAR_TOOLS_UNAVAILABLE` permiten identificar el paso que falla sin compartir claves ni URLs de autorización. Una autorización correcta todavía requiere **Confirmar y enviar** para crear la copia.

#### Recuperar un envío que quedó incompleto

Pulsa **Comprobar este envío**. La app busca únicamente el título de esta semana y muestra las posibles copias; esta acción es de solo lectura. Elige una y pulsa **Completar esta copia → Confirmar y completar copia**. Antes de escribir, se verifican título, esquema y una única tabla inicial sin filtros, y que no haya tareas activas ni archivadas. Si alguna comprobación falla, se detiene. Se reutiliza la base seleccionada; las otras copias permanecen intactas.

El formato de respuesta de Notion puede incluir JSON, enlaces `https://app.notion.com/p/…` y marcadores `{{…}}`. La aplicación los acepta y consulta la base recién creada para obtener su fuente de datos. Los envíos nuevos conservan el paso del fallo y un código seguro; los registros antiguos mantienen la protección contra reintentos automáticos. La recuperación tampoco se repite automáticamente si se pierde una respuesta después de empezar a escribir.

### Conectar Google Calendar

En «Mi semana → Calendario y compartir» y en el historial aparece **Tu semana en Google Calendar**. La conexión directa usa OAuth y la API oficial; el lector iCal y las descargas anteriores siguen disponibles.

**Configuración de esta instalación (una vez):**

1. En [Google Cloud](https://console.cloud.google.com/), crea o elige un proyecto y habilita **Google Calendar API**.
2. En **Google Auth Platform**, configura la pantalla de consentimiento. Para pruebas externas, elige Testing y añade tu cuenta como usuario de prueba. En acceso a datos solicita `https://www.googleapis.com/auth/calendar.calendarlist.readonly` y `https://www.googleapis.com/auth/calendar.events.owned`.
3. Crea un cliente OAuth de tipo **Aplicación web** y registra exactamente esta URI de redirección: `http://localhost:5181/api/google-calendar/callback`.
4. Añade estas variables a tu `.env.local`, conservando las que ya tengas. Sustituye los valores de ejemplo con los del cliente creado. No uses el prefijo `VITE_`, no subas el archivo a Git ni compartas el secreto en el chat.

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=tu-cliente.apps.googleusercontent.com
GOOGLE_CALENDAR_CLIENT_SECRET=tu-secreto
GOOGLE_CALENDAR_APP_ORIGIN=http://localhost:5181
```

5. Detén el servidor actual con Ctrl+C y reinícialo en el mismo puerto: `npm run dev -- --port 5181 --strictPort --open`.
6. En la app: **Conectar Google Calendar → autorizar → elegir un calendario propio → Revisar envío → Confirmar cambios en Google Calendar**.

La revisión indica eventos nuevos, actualizaciones, eliminaciones de eventos previamente enviados por esta app y partes sin fecha. Estas últimas permanecen en el cuaderno. Los repartos sin reloj se muestran como eventos de día completo, con horas previstas en la descripción; los bloques con horario mantienen sus horas y zona horaria. No se sincronizan cambios en segundo plano.

Al repetir el envío se reutilizan los identificadores de los eventos. Las ediciones manuales detectadas en Google bloquean la actualización hasta revisarlas. Si se pierde una respuesta, pulsa **Revisar envío** de nuevo antes de confirmar: la app comprueba lo que ya existe. Solo muestra éxito tras verificar lo guardado.

**Desconectar** elimina las credenciales de la sesión, conservando eventos. La autorización también puede revocarse en la cuenta de Google. Las credenciales y la identidad de instalación se guardan cifradas en `.google-calendar-local/`; no publiques, compartas ni borres esa carpeta para reintentar un envío. El identificador no secreto del cuaderno se conserva en este navegador/origen. Cambiar de cuaderno/instalación no es una migración ni sincronización de eventos.

El modo Testing de Google puede hacer caducar los permisos a los siete días. Para distribuir la app puede ser necesaria la verificación de Google. Esta versión usa el servidor local de un solo proceso y todavía requiere probar la autorización y eventos con una cuenta real; no se ha desplegado un backend público. Consulta [ADR 0032](docs/adr/0032-direct-google-calendar-oauth.md) y la [guía oficial de OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).
