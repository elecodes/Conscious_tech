# UX improvement plan

Status: steps 0–6 complete; daily-action design is next.

Base: `main` at `11e2f95`. Working branch: `codex/ux-step-by-step`.

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
