# UX improvement plan

Status: the three agreed follow-up steps are implemented. User confirms voice separation after updating; included undated tasks now support direct calendar placement.

Base: `main` at `11e2f95`. Working branch: `codex/ux-step-by-step`.

## Next session — agreed at the end of the walkthrough

Checkpoint: `d556170` on `codex/ux-step-by-step` (latest application change).
Documentation-only session close followed this checkpoint. Work resumed on 12 November.

1. **Less calendar text — completed, 12 November.** Draft instructions and active
   calendar instructions/colour legend now sit in collapsed help disclosures.
   Tasks, dates, daily hours and actions stay visible; empty-state and tray copy is
   shorter. Native disclosures support keyboard opening/closing.
2. **Voice dictation — repetition fixed and confirmed by user, 12 November.**
   User confirms Chrome repeats each growing phrase. Capture appended each full-field
   transcript snapshot instead of replacing it. Corrected that integration and rebuilt
   results without accumulating repeated finals. Startup/stop, service errors, manual
   edits and teardown are covered by browser service-event simulations. No real audio
   recognition was verified by the assistant; the user then confirmed the repetition
   is corrected. New explicit task-list commands are implemented with an opt-out;
   recognition of “siguiente tarea” itself still needs the user's spoken check.
3. **Included tasks without a day — completed, 12 November.** The undated tray is
   above the calendar. Dragging or Elegir día opens the existing day/hour dialog;
   cancellation writes nothing. Placement preserves inclusion, counts, estimates,
   source evidence and other tasks, with daily/shared-focus checks. Known shared
   effort is shown per member; no aggregate is copied or divided automatically.

The user confirmed the short voice separator works after updating the local app.
Browser recognition accuracy still varies; task names can be corrected directly.
All three agreed follow-up steps are implemented. Continue with user walkthroughs
and their next concrete feedback rather than introducing more features now.

## Goal

Make capture, weekly decisions, and daily use easier while preserving the product's
principle: AI proposes; the person decides. Keep the Spanish-first interface,
protected time, conservative extraction, and explicit plan activation.

## Working method

- Implement one numbered step at a time, with a separate commit for each completed
  step. Record what changed, checks run, and remaining limitations.
- Start each step from a clean, verified checkpoint. If checks fail, diagnose and
  resolve the failure before starting the next step.
- Prefer existing components and domain operations. Avoid new dependencies and
  changes to storage schemas, provider contracts, or planning rules in presentation
  steps.
- Verify relevant behavior tests and browser flows. Complete the repository's CI
  checks before calling a step finished.
- Keep existing browser data usable. Any necessary persistent-state changes need a
  separate design, compatibility tests, and a backup/restore check first.
- Revert individual commits if needed. Never reset or overwrite user work.
- Do not merge or deploy as part of this plan.

## Baseline observations

The existing application already provides two primary tabs and a three-stage
planning flow. These should be refined incrementally.

The local browser walkthrough used the mock provider. Real-provider output quality
and real calendar-account behavior were not evaluated.

- At 390 by 844 pixels, the initial writing area started around 1,056 pixels down
  the page. Introductory blocks and the example selector precede it.
- Continuing from capture generates a proposal before capacity is configured.
- Review displays both selected extracted items and a separate proposal list.
- In the first example, five selected ideas produced two planned/flexible entries
  and three deferred entries. Activation then displayed all five under active
  priorities, although the deferred entries retained an unscheduled label.
- Confirmation does not normally repeat a compact plan summary.
- Two active-week calendar buttons trigger the same download.
- The capture label targets a different ID from its textarea.
- The tested review and active views had no horizontal overflow at 390 pixels.

## Implementation sequence

### 0. Resolve baseline check failures

- Apply formatting only to the two existing failing files listed below, in a
  separate housekeeping commit. Confirm the diff has no behavior changes.
- Resolve browser certificate trust for external fonts in the test environment and
  rerun the unmodified smoke suite. Do not disable TLS verification to obtain a pass.
- Complete these checks before starting UI implementation.

### 1. Make capture easier to reach

Scope:

- Compact the mobile header and welcome guide.
- Hide redundant next-step guidance when it repeats the current capture action.
- Replace the prominent calibration-case selector with a secondary example control;
  retain examples without exposing fixture IDs as primary product language.
- Correct the capture label association and provide visible keyboard focus.
- Show a quiet, accurate demo-mode indicator when the mock provider is selected.

Acceptance:

- The empty writing area and its label are visible without scrolling at 390 by
  844 pixels, with the default welcome state.
- Capture, dictation, example selection, autosave, and welcome dismissal still work.
- Keyboard users can identify focus and activate the capture controls.
- Desktop and mobile views have no horizontal overflow.

### 2. Establish planning context before generating a proposal

Scope:

- Show the target week and an optional available-hours input before planning.
- Allow an explicit unknown-capacity path; describe its proposal as provisional.
- Explain the existing protected-space default without requiring customization.
- Reuse existing capacity validation and calendar arithmetic. Make clear whether
  hours are before or after imported calendar commitments to avoid double counting.
- Preserve notes and context on failures. Failed regeneration must not advance to
  confirmation with an outdated proposal.

Acceptance:

- Known, unknown, zero, invalid, and calendar-adjusted capacity behave consistently.
- Back navigation and reload preserve existing supported draft data.
- Dates, selected items, and time edits cannot silently activate a stale proposal.
- Existing capacity-conservation and protected-time behavior remains intact.

### 3. Make confirmation self-contained

Scope:

- Add a compact summary of intention, planned commitments, capacity or uncertainty,
  protected space, and saved-for-later items immediately above activation.
- Explain the effect of activation in one sentence.
- Move export out of the primary confirmation path while retaining access after
  activation.

Acceptance:

- Summary values come from the exact proposal being confirmed.
- Existing active-week conflict handling and double-submit protection still work.
- Back navigation preserves decisions; activation remains explicitly confirmed.

### 4. Simplify proposal review

Scope:

- Present one primary decision surface for this week, flexible options, and later.
- Preserve ideas and concerns without automatically converting them into tasks.
- Keep source wording, classification, and explanations available in details.
- Use existing promotion, demotion, selection, and deferral operations where they
  apply. Design unsupported moves separately instead of inventing domain behavior.

Acceptance:

- Every extracted item remains accounted for, including excluded and deferred items.
- Selection and placement have distinct, understandable meanings.
- Editing estimates or dates reliably updates the proposal before confirmation.
- Long notes, empty proposals, and concern-only captures remain usable.

### 5. Clarify the active week

Scope:

- Lead with the week's intention, focus areas, and commitments.
- Separate saved-for-later entries from active priorities using existing item
  membership; do not delete or change their persisted classification.
- Put schedule versions, empty history, and secondary exports behind details.
- Keep unexpected-event intake easy to discover.

Acceptance:

- Deferred work does not appear as an active commitment.
- Adjustments, history, closing, carryover, and reopening retain all items.
- Existing saved weeks render correctly without a migration.

### 6. Consolidate calendar, sharing, and trust language

Scope:

- Consolidate duplicate exports into a calendar-and-sharing section.
- Label downloads, calendar event creation, copying, and email composition literally.
- Preserve import guidance and explain that imported events are not live synced.
- Explain local storage separately from external AI processing, at the point of use.
- Replace technical deletion wording with plain Spanish while preserving safeguards.

Acceptance:

- ICS contents, reminders, email length limits, and complete clipboard copies remain
  correct.
- No account connection, upload, or live synchronization is implied.
- Mock mode remains local; real providers are not silently enabled.
- Backup, restoration, and deletion controls remain accessible.

### 7. Design daily actions before adding persistent behavior

Scope:

- Inspect how active task progress maps to closing dispositions and carryover.
- Define completion, moving, postponing, and undo behavior using existing domain
  operations where possible.
- Document whether persistent-state changes are required before implementation.
- Implement only once reload, undo, history, and closing semantics are explicit.

Acceptance:

- A daily action has a clear result, survives reload when appropriate, and can be
  undone without overwriting subsequent decisions.
- Closing accurately reflects progress; carryover does not duplicate or lose work.
- Old backups and existing weeks remain compatible.

## Verification for each step

Run meaningful behavior checks for the affected flow, then the existing CI commands:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run check:cycles
npm test
npm run build
npm run test:smoke
```

Manually inspect desktop and mobile, keyboard navigation, fresh use, and a restored
draft. For the affected flow, also check an active week, a closed week, error
recovery, and reload as applicable. Use mock AI for repeatable checks; live AI
validation is separate and must not transmit personal notes implicitly.

After the first presentation step, use a small usability check before restructuring
review: can someone start, explain what enters the week, locate deferred work, and
activate intentionally without help? Repeat the same tasks after later steps.

## First checkpoint

The initial checkpoint separated baseline cleanup from the first capture change.
The completed checkpoints below record subsequent implementation and verification.

Baseline results:

- Type checking, lint, dependency-cycle checks, and production build passed.
- All 953 tests passed across 70 test files.
- Repository formatting failed on two pre-existing files:
  `docs/adr/0028-calendar-bridge-and-email-summary-polish.md` and
  `src/web/components/active-week-schedule-section.tsx`. They remain unchanged in
  this planning checkpoint. The new plan itself passes formatting.
- The unmodified browser smoke suite completed its preview-flow assertions but
  failed its console-error gate with `ERR_CERT_AUTHORITY_INVALID`. A separate
  browser probe reproduced a failed request to `fonts.googleapis.com`. Dev-mode
  smoke checks were not reached. Browser smoke verification is not yet green.

## Completed checkpoints

### Step 0 — baseline cleanup

- Formatted only the two pre-existing failing files, without behavior changes.
- All seven CI checks now pass, including 953 tests and browser smoke tests in
  preview and dev modes.
- Browser verification required adding the environment's existing proxy CA to the
  browser NSS trust database in the same command sandbox as the smoke run. This is
  environment setup only; no TLS bypass or repository test change was needed.

### Step 1 — easier capture

- Shortened the header and first-use welcome. Removed duplicate next-step guidance
  on empty capture and hid the empty process badge there.
- Collapsed examples behind a keyboard-accessible control, retaining every example
  and its stable internal ID while removing fixture IDs from visible option text.
- Added a visible mock-mode indicator, corrected the textarea label, and added
  keyboard focus outlines. Provider switching controls the indicator correctly.
- At 390 by 844 pixels, the complete empty textarea is visible with the welcome
  open and real fonts loaded; no horizontal overflow is present.
- Browser checks cover label focus, keyboard focus, example selection, note
  preservation across reload, welcome dismissal, draft recovery, plan activation,
  calendar exports, and closing in preview and dev modes.
- No domain rules, storage schemas, AI contracts, or dependencies changed.
- Next: step 2, planning context before generating a proposal. Stop here for review
  of the capture screen before advancing.

### Step 2 — planning context before generation

- Added optional net free hours and the target week below the writing area, with
  editable dates and protected space. Unknown capacity stays provisional; zero is
  known capacity in both review and the active week.
- Reused the existing week and capacity schemas for input validation. Invalid
  dates, hours, or ratios are rejected before an AI request.
- Valid context survives reload in a transient localStorage key, removed after
  activation. No IndexedDB schema or provider contract changed. Older drafts
  without editable context restore their proposal capacity.
- Calendar import no longer assumes 40 available hours or subtracts commitments
  from already-net free hours. Calendar reference data resets when dates change.
- Failed regeneration stays in review. Confirmation checks current dates, items,
  selections, capacity, and notes; the progress indicator uses the same checks.
  Changing context alone preserves manual item corrections instead of re-extracting.
- Added validation tests and isolated synthetic browser scenarios for reload,
  legacy drafts, duplicate calendar import, unknown/zero capacity, item edits,
  context changes, provider failure, retry, and explicit activation.
- Verification: 969 tests across 71 files, type checking, lint, formatting,
  dependency-cycle checks, production build, and browser smoke tests in preview and
  dev modes pass. Mobile context controls also have no horizontal overflow.
- Next: step 3, a compact summary immediately before activation.

### Step 3 — self-contained confirmation

- Added a read-only summary of the exact proposal: intention, dates, focus areas,
  commitment/optional/deferred counts, stored time estimates, and protected space.
  Optional hours are explicitly separate from focus/commitment estimates.
- Unknown and partial capacity remain visibly unverified. Overload and compromised
  protected time stay visible; zero and empty proposals do not invent hours/tasks.
- Removed the editable intention field from confirmation; intention changes use
  review and regeneration so the displayed summary cannot lag behind an edit.
- Moved calendar downloads/reminder configuration out of confirmation. Existing
  calendar and sharing actions remain available in the active week.
- Explained activation, moved keyboard focus into the confirmation region, and
  added an immediate guard against repeated activation before state rerenders.
- Added summary boundary tests and browser checks for updated totals, mobile
  overflow, exact persisted proposal equality, rapid activation, and preservation
  of an existing active week when a future proposal conflicts.
- Verification: all 975 tests across 72 files pass, along with type checking,
  lint, formatting, dependency-cycle checks, production build, and browser smoke
  tests in preview and dev modes. Focus areas and up to three commitments are
  visible immediately; remaining items can be inspected without leaving the page.
- Next: step 4, one clear decision surface for proposal review.

### Step 4 — one primary proposal review

- Reused the existing proposal, promotion/demotion, deferral, and capacity components
  in one decision board: this week, if there is space, outside this week, and
  unscheduled ideas/concerns. The initial flat list is no longer a second primary
  view when a proposal exists.
- Attached source wording, type/status, selection, dates, and effort corrections
  to each matching entry. Grouped focuses retain access to every contributing
  source. Excluded and newly added sources remain inspectable during review.
- Clearly distinguished consideration during regeneration from placement in the
  proposal; bulk selection is secondary. Regeneration explicitly prompts another
  review of placements. Existing individual placement operations are reused.
- Captures without a proposal have an explicit first-generation action. Empty
  proposals and thought-only notes do not require creating tasks.
- Prevented unsafe focus/group moves and individual overdue moves that would
  discard other contributing IDs. Such controls explain their limitation; source
  corrections remain available. Recovery reapplication preserves an already-grouped
  focus rather than removing its other members.
- Reused the planner's existing effort normalization in source editing and manual
  inclusion/recovery: minutes/days are shown and consumed as the same planning
  hours. Unknown efforts are not presented as invented six-hour tasks.
- Added conservation fixtures and browser checks for grouped sources, existing
  moves, exclusions, reload, long source text on mobile, and first proposals from
  captured items. No IndexedDB schema, AI contract, or dependency changes.
- Group splitting and reassignment of aggregate effort remain a separate design
  task; this step does not invent a split or allocate group hours to members.
- Verification: 982 tests across 73 files pass, along with type checking, lint,
  formatting, dependency-cycle checks, production build, and browser smoke tests
  in preview and dev modes. Browser checks compare persisted item membership
  before/after moves and after regeneration and reload.
- Next: step 5, separate deferred items from active priorities in Mi semana.

### Step 5 — clarify the active week

- Active priorities show focus areas and commitments. Optional and deferred work
  remain accessible in separate, initially collapsed sections. Focus groups retain
  all contributing sources and identify their estimate as a group total.
- Presentation uses explicit proposal membership before residual agenda allocations;
  viewing a saved week never changes classification or requires a migration.
  Unclassified and schedule-only items remain accessible rather than disappearing.
- Schedule versions and empty adjustment history are behind agenda details; actual
  history remains visible. Unexpected-event intake precedes secondary schedule lists.
- Export controls are secondary. Their existing complete-plan scope is explicitly
  described; adjustments, exports, and closing still receive the full inventory.
  Consolidating duplicate export controls remains step 6.
- Added partition conservation/immutability tests and browser checks for keyboard
  disclosures, mobile overflow, complete ICS contents, explicit adjustment of a
  deferred item, reload, and closing every item.
- Verification: 987 tests across 74 files, type checking, lint, formatting,
  dependency-cycle checks, production build, and browser smoke tests in preview
  and dev modes pass.
- Next: step 6, calendar, sharing, and trust language.

### Step 6 — calendar, sharing, and trust language

- Consolidated three identical weekly downloads into one calendar/sharing section.
  Reminder settings precede the single download; complete-plan scope and payload
  remain unchanged. Import links and the download success instructions remain.
- Distinguished downloading an ICS file, preparing one Google Calendar event,
  composing an email, and copying the complete summary. None implies automatic
  sending, account connection, or ongoing calendar synchronization.
- Calendar import explains its one-time nature and the separate paths: a local
  file is read in the browser; a URL is fetched through the app server from the
  calendar service. The saved private URL remains removable.
- Settings distinguish browser storage from external AI processing. Mock remains
  the default; an external-provider indicator explains that generating sends
  notes. Backup and restore controls remain accessible and unchanged.
- Replaced technical purge wording with deletion language while preserving the
  confirmation, cancellation, and irreversible-action explanation.
- Browser regressions cover the single download on mobile, unchanged reminders
  and ICS inventory, bounded email URLs, full clipboard copying, the external-AI
  indicator, import, and cancellation/deletion with an actual storage check.
- Verification: 987 tests across 74 files, type checking, lint, formatting,
  dependency-cycle checks, production build, and browser smoke tests in preview
  and dev modes pass.
- Next: step 7, define daily-action persistence, undo, history, closing and carryover
  semantics before implementing new stateful controls.

### Step 7 — daily-action design checkpoint

- Investigated current progress, adjustment, closing, reopening, backup and
  carryover behavior. Findings and the proposed contract are in
  [daily-actions-design.md](daily-actions-design.md).
- Current closing selections are component state, not persisted daily progress.
  Existing adjustment history names a reverted lifecycle but supplies no public
  undo operation; postponement removes allocations without recording a full
  reversible before-state.
- Documented individual completion, movement and postponement, conservative
  version-checked undo, atomic writes, and preservation of grouped focus members.
- Explicitly addressed the existing conflict between a live postponement and a
  completed closing outcome. No silent precedence rule is introduced.
- Proposed an optional agenda activity field, backward data compatibility,
  integration with closing/reopening, candidate deduplication and a verification
  matrix. These are design decisions for future implementation, not shipped APIs.
- Split delivery into 7a persistence/contracts, 7b completion with closing and undo,
  7c movement, and 7d postponement. Functional acceptance remains pending.
- Verification: documentation formatting and diff checks pass. No runtime code,
  dependency, storage schema, or saved user data changed in this checkpoint.
- Next: 7a, implement and test the minimal persistence contract before adding UI.

### Step 7a — persistence foundation

- Added optional, validated activity outcomes and history to schedules. Extracted
  the existing item-outcome schema into a shared module without changing the
  close-week contract or existing import paths.
- Added pure individual completion/reversal with explicit IDs, idempotent retries,
  plan membership and version checks. Completion leaves proposal capacity and
  allocations unchanged; a live postponement blocks contradictory completion.
- Added an internal service operation using one IndexedDB transaction for plan
  state, schedule version, outcome and history. It rejects repository-only storage
  without atomic support rather than using an unsafe read/write fallback.
- Undo restores the prior outcome or its absence only at the compatible version.
  Historical data is retained; later changes cannot be overwritten by undo.
- Existing schedule writers preserve omitted activity. Old backups restore without
  invented progress, new backups retain it, and invalid activity is rejected.
- Added 21 domain/storage tests, including two connections, concurrent closure,
  duplicate requests, failed-write rollback, reload, existing adjustments and backup
  compatibility. No dependencies or IndexedDB store migration were added.
- No UI invokes these operations yet. Closing/reopening integration and functional
  acceptance of daily controls remain step 7b.
- Verification: 1,008 tests across 76 files, type checking, lint, formatting,
  dependency-cycle checks, production build and browser smoke tests in preview
  and dev modes pass.
- Next: 7b, complete the closing/reopening integration and expose individual
  completion with safe undo.

### Step 7b — individual completion through the weekly lifecycle

- Exposed individual completion and last-compatible-action undo with persistence,
  duplicate-activation protection, visible errors/reload and inspectable history.
  Notes remain notes; completing a source does not complete its whole focus.
- Closing prefills stored results, preserves explicit corrections/unreviewed
  choices and checks the reviewed schedule version inside the same transaction as
  report creation and plan closure. Conflicts require a fresh review.
- Reopening preserves reviewed outcomes in an optional, validated checkpoint before
  removing the report. It retains action history and blocks stale undo across the
  lifecycle boundary. The reopen control is accessible immediately after closing.
- Carryover excludes completed/dropped active outcomes and continues to respect
  existing report candidates, targets and item identity.
- Added nine service regressions for corrections, stale/concurrent close,
  concurrent reopen, postponement contradictions and transaction rollback. Extended
  browser checks through completion, reload, undo, correction, stale closing and
  reopening. No dependencies or store migration added.
- Verification: 1,017 tests across 76 files, type checking, lint, formatting,
  dependency-cycle checks, production build and browser smoke tests in preview and
  dev modes pass.
- Next: 7c, explicit assignment movement with safe reversal; postponement reversal
  remains 7d.

### Step 7c — scoped assignment movement and undo

- Added an explicit movement form under each eligible item's More actions. It
  distinguishes fixed blocks from daily hours, requires a selected source and
  explains which representation stays unchanged. Cancellation writes nothing.
- Reused deterministic adjustment operations, including collision, duration,
  capacity and week-range checks. Movement preserves item identity, proposal
  classification, estimates, deadlines and total allocated hours.
- Extended activity commands/history with optional scoped temporal evidence. Undo
  validates the inverse operation and restores affected rows and prior adjustment
  lifecycle only at the compatible version, preserving unrelated work and history.
- Existing atomic activity storage now commits movement plus both histories
  together. Old activity records remain valid without a store migration.
- Added nine domain and three storage tests, including backup/restore, two
  connections, tampered evidence and failed-write rollback. Browser checks cover
  partial hours, block duration, collision rejection, mobile, reload/undo and the
  complete weekly lifecycle.
- Verification: 1,029 tests across 77 files, type checking, lint, formatting,
  dependency-cycle checks, production build and browser smoke tests in preview and
  dev modes pass.
- Next: 7d, reversible postponement with explicit destination and carryover semantics.

### Step 7d — reversible conscious postponement

- Added explicit reason and optional future target range under each eligible
  item's More actions. No destination or hours freed are invented; no future plan
  is created automatically.
- Reused existing postponement, atomic activity storage and scoped temporal
  evidence. Undo restores this item's assignments, previous result and affected
  adjustment lifecycle at the compatible version, without replacing the agenda.
- Active postponements now render separately from priorities and original deferred
  entries. Grouped focus members remain individually accounted for; original
  proposal membership and aggregate estimates stay unchanged.
- Existing closing and carryover consume the explicit result and active decision.
  Verified target filtering, candidate deduplication, backup/restore and retention
  of an already-selected future draft when the original decision is undone.
- Added eight domain and four storage regressions. Browser checks cover the
  mobile form, empty-reason guard, removal from priorities, reason/destination,
  reload, exact restoration and completion after undo.
- Preserved the conservative last-compatible-version rule. Old postponements with
  insufficient evidence and actions followed by other decisions do not receive an
  unsafe reversal control. Exports still include the full inventory explicitly.
- Verification: 1,041 tests across 78 files, type checking, lint, formatting,
  dependency-cycle checks, production build and browser smoke tests in preview and
  dev modes pass. No dependencies or IndexedDB store migration added.
- The planned increments are complete. Next: a user walkthrough of capture,
  proposal review, activation, daily decisions and closing before further changes.

### User walkthrough — inclusion in the editing panel

- The user found inclusion confusing when decision buttons were separated from
  the hours/date panel. Attached inclusion and placement status to that same card.
- Inclusion reuses the existing placement operation. The panel stays open across
  category changes, with hours/date preserved and keyboard focus returned to the
  source. Status reflects actual focus/commitment/optional/deferred membership.
- Removed repeated decisions outside editable source cards; missing-source legacy
  entries retain their original controls. Selection still only controls eligibility
  for regeneration, and grouped focus safeguards are preserved.
- Added regression coverage for placement next to inputs, excluded-source guards,
  one inclusion control per source, panel continuity, date preservation, focus and
  mobile overflow. All 1,043 tests across 78 files and the standard code/build and
  preview/dev browser checks pass.

### User walkthrough — task calendar in Mi semana

- The user requested a faster visual overview and clarified the scope is only
  active-week tasks, leaving saved-week and draft lists unchanged.
- Added a read-only weekly calendar above the existing controls: explicit week
  dates, real day assignments, pending/all filters and unique task counts.
- Consolidated a task's blocks and daily hours within each day without adding
  them together. Repeated days do not multiply pending counts. Deadlines never
  become assigned days; unscheduled weekly work remains clearly separate.
- Deferred residual allocations and live postponements do not become priorities.
  Notes and postponed destinations stay inspectable in a secondary section.
- Task selection reveals the existing editor and focuses the matching item.
  Mobile uses compact day rows; longer ranges page through seven-day windows.
- Added six projection/rendering tests and browser checks for scope, deadline
  distinction, progress filters, read-only behavior, keyboard navigation, mobile
  overflow and live completion/postponement updates.
- Verification: 1,049 tests across 79 files, types, lint, formatting, dependency
  cycles, production build and preview/dev browser checks pass. No persistence,
  domain operation, dependency or external calendar integration changes.

### User walkthrough — direct editable preparation calendar

- Replaced the default three-stage flow with notes and an editable calendar.
  Activation is one explicit action from that calendar; the summary is optional
  and opens in place. The detailed board remains under advanced options.
- Hours, inclusion and chosen-day controls live on each task card. Direct hours
  edits update capacity without AI regeneration. Grouped focus estimates stay
  shared, obligations retain their safeguards and thoughts remain notes until
  explicitly included. Deadline and chosen day are distinct.
- Persistence design: optional validated `draftContext.plannedDays` keeps explicit
  day decisions without fabricated effort; known individual estimates become
  allocations on activation, and existing real assignments take precedence.
  Activation retains source context. Old backups remain valid, with new/old
  round-trip regression coverage. This intentionally extends the earlier read-only
  calendar scope in response to the user's follow-up request.
- Serial draft writes show progress and recoverable errors, blocking activation
  while unsaved. Returning to unchanged notes preserves manual decisions. Reused
  provider IDs cannot carry days into unrelated sources.
- Added behavior tests and browser coverage for direct edits, storage failure/retry,
  reload, mobile layout, one-click activation, unknown effort, grouped estimates,
  exact proposals and conflict protection. Verification: 1,056 tests across 80
  files, types, lint, formatting, dependency cycles, production build and browser
  checks in preview and development all pass. Build retains the existing bundle
  size warning; no dependencies were added.

### User walkthrough — drag/drop and monthly planning

- The user requested day-to-day drag/drop and explicitly selected a monthly view.
- Draft tasks already included in the week can be dragged to a day or back to the
  undated section. Date controls remain available for touch/keyboard. External
  drags and no-op drops do not change the calendar.
- Active simple allocations and individual fixed blocks use the existing atomic,
  version-checked movement command, preserving hours, conflict checks and undo.
  Mixed/split assignments retain their detailed controls; no partial move is guessed.
- Added a month projection of active/pending work and saved drafts, including
  truthful undated counts by week. Deadlines do not place tasks. Day/week selection
  opens the weekly editor, with independent future drafts and year/month boundaries.
- Week switching saves the current draft, refuses dirty capture/settings and failed
  persistence, clears obsolete editor state, and never replaces the active week.
  Draft saves now refresh session draft lists and surface invalid-data results.
- No schema/provider/dependency changes. Added model/domain regressions and browser
  coverage for actual dragging, keyboard movement, undo, separate future drafts,
  return to a previous week, reload and mobile overflow.
- Verification: 1,061 tests across 81 files; types, lint, formatting, dependency
  cycles, production build and browser smoke in preview/development pass. Focused
  browser checks also cover dirty-note protection and navigation across New Year.
  The existing bundle-size build warning remains.

### User walkthrough — task-specific movement controls and colour states

- The user reported oversized standalone movement controls and apparent movement
  of neighbouring tasks. Browser reproduction preserved the other task's data but
  exposed all movement selectors disappearing/reappearing during a save.
- Kept controls mounted while busy, reserved save-status space, and contained each
  compact Cambiar día disclosure inside its task card. All included unfinished
  tasks expose it, with existing editor access for unsupported direct moves.
- Named the affected task in confirmation feedback and restored focus to its card.
- Added labelled colour/symbol states and a legend: amber undated, blue scheduled,
  green completed, purple postponed, neutral notes/outside. Placement does not
  replace progress, and pending/all filters keep their meaning.
- Added regressions for busy DOM stability, individual movement/undo for same-day
  members of one focus, accessible labels, distinct colours and mobile overflow.
- Verification: 1,064 tests across 82 files, types, lint, formatting, dependency
  cycles, production build and browser checks in preview/development pass. The
  existing bundle-size warning remains. No schema or domain-operation changes.

### User walkthrough — later availability and active/future week overview

- Added visible availability editing after task capture, in both draft and active
  weeks. Reuses validated capacity math, preserves estimates/assignments and treats
  unknown hours separately from zero. Active updates use expected schedule versions.
- Added a responsive collapsible Mis semanas sidebar, projecting active work,
  saved drafts and explicit destinations from current/latest closed schedules.
  Pending destination work is labelled by inclusion state; it is not a fake draft.
- Sidebar navigation reuses protected exact-week switching after draft restoration.
  Reschedule warnings now inspect destination capacity, with a link to that week;
  the default destination is the following week.
- Exposed carryover controls in the primary planner. Retained source cards and
  accepted IDs on generation, restored valid selections and avoided copying a
  shared focus estimate into each recovered source.
- Added tests for later/zero/unknown capacity, preserved task data/completeness,
  destination projection/deduplication and browser coverage for rescheduling,
  separate active/future capacity, exact-week navigation, reload and mobile layout.
- Verification: 1,069 tests across 83 files; types, lint, formatting, dependency
  cycles, production build and complete browser checks in preview/development pass.
  Existing bundle-size warnings remain. No dependencies or storage schemas changed.

### User walkthrough — divide one task's hours across multiple days

- Added Repartir horas to draft and active task cards, with partial allocation,
  remaining effort and bounds for each task, shared focus and configured day.
- Each day displays its own hours; unique task counts and weekly estimates do not
  multiply. Dragging moves one portion and merges a same-task destination safely.
- Persistence design: optional draftContext.plannedAllocations uses existing daily
  allocation shapes and survives reload, draft switching and old/new backup import.
  Activation validates and creates the actual schedule rows, preserving old single
  day behavior. Actual active assignments take precedence over draft metadata.
- Active distribution uses version-checked saving without modifying proposal/task
  choices. Legacy total edits preserve existing portions and guard against reducing
  effort below allocated hours. Fixed clock blocks keep their explicit controls.
- Integrated every assigned date in month/sidebar projections, calendar export,
  individual event links and email. Exported all-day portions include their hours
  without fabricating clock times.
- Added behavior and browser checks for a five-hour 2/2/1 task, partial distribution,
  invalid/excess hours, shared/unknown effort, capacity, other-task preservation,
  reload, activation, per-portion dragging, total edits, exports and mobile layout.
- Validation: 1,075 tests across 84 files passed; typecheck, lint, formatting,
  dependency-cycle check and production build passed. Full browser smoke passed
  in preview and development, including split allocation and prior workflows.

### User walkthrough — bring deferred work straight into the active calendar

- A visible tray above the days offers drag/drop and an equivalent day action.
  Dropping opens a focused day/hour editor; cancellation writes nothing, and saving
  atomically includes only the chosen task with a version check.
- Single-day cards offer direct hour editing. Unknown estimates stay unknown,
  fixed blocks stay explicit, and shared estimates remain protected.
- An audited resume command recovers postponed work independently of intervening
  unrelated actions, retaining the original postponement history and other outcomes.
- Unit and browser checks cover inclusion, cancellation, postponed recovery, capacity,
  unknown hours, independent-task preservation, reload and mobile editor fit.
- Validation: 1,081 tests across 85 files, typecheck, lint, formatting, cycle check
  and production build passed. Full browser smoke passed in preview and development.

### Voice dictation verification — 12 November 2026

- 1,081 tests across 85 files passed; types, lint, format, cycles and production
  build passed. Full browser smoke passed in preview and development, including
  simulated Chrome-style provisional/final results and microphone-service failures.
- Real microphone/audio recognition on the user's Mac remains to be confirmed.

### Voice task separation — 12 November 2026

The user confirms repetition is fixed but unpunctuated speech becomes one item.
Task dictation now converts the explicit “siguiente tarea” / “next task” command
into a line break, including revised interim results. Capture and additional-task
review enable this mode and show an example; the voice options allow opting out.
Radar retains free text. Only new dictated text is transformed, not existing notes.
Pauses and numbers remain content, protecting durations and quantities.

Unit checks verify three extracted tasks with their separate effort estimates;
browser service simulations verify live replacement, opt-out and both languages.
Real recognition of the new command remains for the user to confirm on the Mac.

- Verification: 1,083 tests across 86 files, types, lint, format, cycle checks and
  production build passed. Updated voice-service browser simulation passed in
  development and preview, including explicit separators, language and opt-out.

### Short voice commands and accessible correction — 12 November 2026

The user reports the long voice command still appears as one task, and the footer's
edit action appears ineffective. Accept “siguiente”/“next” as the short command,
keep the long form, and normalize at both extraction entry points, not just live
speech. The shared mode switch applies to initial and additional notes and protects
free-text opt-out; common next-week/day/month references remain intact.

Draft cards now expose Editar tarea. The footer opens a native dialog with editable
intent and task names, explicit save/cancel, and no hidden advanced-section dependency.
Renaming preserves IDs, original raw evidence, estimates, days, allocations and
choices; source/proposal titles are updated together and survive reload.

Añadir más ideas opens and focuses the additional-notes field. Appending remaps
colliding provider IDs without overwriting prior corrections. Browser coverage now
includes actual capture → extraction → calendar, modal cancel/save, reload, footer
navigation and appending, beyond simulated speech events alone.

Verification of this step: 1,085 tests across 87 files, typecheck, lint, formatting,
cycle check and production build passed. Full browser smoke passed in preview and
development, including the capture/extraction/edit/reload/append regression.

### Included undated tasks — 12 November 2026

- Show included undated work above the days, with drag/drop and an accessible
  Elegir día alternative. Reuse the native day/hour editor and version-checked save.
- Preserve inclusion, counts, source effort and capacity when only choosing a day.
  Group allocations use each member's known effort and retain the original shared
  estimate. Choosing no hours saves a day without inventing an allocation.
- Unit and browser checks cover cancellation, keyboard placement, shared budgets,
  unchanged totals, unknown hours, reload, other tasks and mobile editor fit.

Validation: 1,087 tests across 87 files, typecheck, lint, formatting, cycle check and
production build passed. Full browser smoke passed in preview and development,
including included-undated placement with shared/unknown hours and mobile controls.

### Visible completion and local task inspection — 12 November 2026

User reports completed work disappears and card clicks scroll to controls that are
hard to find. The default is now Todas, retaining completed cards in their original
days with green, a check and struck-through names; Pendientes remains an explicit
filter. Completing directly from the calendar switches back to the all-task view.

Cards offer compact completion and, when allowed, undo of the latest completion.
Clicking the title opens a native local inspector with the selected task's name,
state, visible assigned days and completion actions. Additional controls require
an explicit action and centre/focus the correct underlying card.

No new completion domain or storage protocol: reuse audited activity commands,
version checking, locking and existing undo rules. Completing a split task marks
all its parts while retaining allocations, estimates and neighbours. Browser
checks cover direct/panel completion, double click, green/strike state, reload,
undo, optional filtering, split tasks, keyboard inspection and mobile fit.

Validation: 1,088 tests across 87 files passed. Types, lint, formatting, cycles and
production build passed. Full preview/development browser smoke covers local
inspection, visible completion, reload, latest-action undo, split-task completion,
explicit pending filtering and mobile layout.

### Persistence review and full closed-week history — 12 November 2026

- Existing IndexedDB recovery retains the active plan, schedule, outcomes and drafts
  across browser sessions; dates expiring do not delete or automatically close a week.
- All closed plans, schedules and reports were retained, but the UI mainly exposed
  the latest. Mis semanas now opens Semanas anteriores: all valid closed weeks,
  detailed source plan and final outcomes, without reactivation or active-week changes.
- Validate stored links and report incomplete history separately without mutating it.
  Reuse ClosedWeekReviewCard with archive reopening disabled. Queries run on demand.
- Settings show the notebook origin and explain browser/profile/port isolation.
  Restore remains replace and requires confirmation; cancellation preserves data.
- Browser coverage uses a real persistent profile, closes/relaunches the browser,
  recovers a past-dated active week, reads two closed weeks, checks unchanged records,
  exported backup contents, cancelled restore, a second port and mobile history fit.

Validation: 1,092 tests across 88 files passed, with types, lint, formatting, cycles
and production build. Full browser smoke passed in preview and development. The
new persistence check actually closes/relaunches Chromium with the same profile,
verifies two closed weeks plus the active past-dated week, and confirms read-only
history, complete backup export, cancelled restore, port isolation and mobile fit.
