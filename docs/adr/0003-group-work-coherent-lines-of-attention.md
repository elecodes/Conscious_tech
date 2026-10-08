# ADR 0003: Group Work — Coherent Lines of Attention and Deterministic Invariants

## Status

Accepted

## Context

Following Skill 01 (`extract_items`) and Skill 02 (`detect_relationships`), the system possesses structured items and their pairwise semantic relationships.

Before planning a week (Skill 06 `build_week`) or evaluating deadlines (Skill 04 `detect_deadlines`), individual items must be synthesized into coherent lines of attention to prevent mental fragmentation:
- **Concentration over fragmentation**: The system must transform many disconnected items into a smaller set of meaningful focus areas without turning each item into an isolated pressure point.
- **A relationship does not imply a group**: Groups must represent genuine lines of work, not arbitrary network clusters. Few coherent groups are strictly preferred over many artificially connected ones.
- **Code over AI for structural integrity**: Conservation of items, prevention of item duplication across groups, phantom ID rejection, and dissolution of degenerate 1-item groups must be guaranteed deterministically by code.
- **No planning or prioritization in Skill 03**: Skill 03 must exclusively answer *"What elements belong to the same coherent line of work?"* without answering what is urgent, what has a deadline, or what fits into the week.

## Decisions

### 1. Domain Modeling (`src/domain/work-groups.ts`)

Defined explicit Zod schemas and TypeScript types:
- `WorkGroup`: `id`, `title` (non-empty), `itemIds` (non-empty array), `rationale` (non-empty description of the binding link).
- `GroupedWork`: `groups: WorkGroup[]`, `ungroupedItemIds: string[]`.
- `GroupWorkInput`: `items: ExtractedItem[]`, `relationships: Relationship[]`.

### 2. Deterministic Invariant Engine (`src/skills/group-work/deterministic.ts`)

Implemented `cleanAndValidateGroupedWork` and `validateGroupWorkInvariants`:
- **Conservation Guarantee**: Every single input item is accounted for. If an LLM response omits an item, deterministic post-processing automatically preserves it in `ungroupedItemIds`.
- **Disjoint Partition**: An item cannot appear in more than one group, nor can it simultaneously exist in a group and `ungroupedItemIds`. The first group claims the item; subsequent overlapping references are cleanly stripped.
- **Group Threshold ($\ge 2$ items)**: A work group represents a synthesis of multiple items. Any group left with fewer than 2 items is disbanded and its items fall back to `ungroupedItemIds`.
- **Phantom Rejection**: IDs not present in the input items are discarded.
- **Deterministic Short-Circuits**:
  - Empty items $\rightarrow$ `{ groups: [], ungroupedItemIds: [] }` in 0ms.
  - 1 item $\rightarrow$ `{ groups: [], ungroupedItemIds: [id] }` in 0ms.
  - 0 relationships $\rightarrow$ all items to `ungroupedItemIds` in 0ms, avoiding unnecessary LLM calls when items are already known to be independent.

### 3. Semantic Prompting & Relationship Semantics (`src/skills/group-work/prompt.ts`)

Configured semantic guidelines for relationship signals:
- `same_project` & `same_objective`: Strong signals to group into a shared line of work.
- `part_of`: Very strong signal uniting constituent and preparatory subtasks with their primary deliverable.
- `depends_on`: Does not automatically force grouping; causal dependencies between different operational areas stay separate.
- `related_to`: Weak/medium signal; only groups when an intrinsic technical or conceptual thread connects them (e.g., local AI research). Generic shared context does not justify grouping.
- `duplicate`: Treated as the same line of work (grouped together); items are never silently deleted.
- `concern`: Emotional concerns and doubts are strictly isolated in `ungroupedItemIds`.
- **Titles & Rationale**: Titles must be concise, specific, and natural (e.g. "Lanzamiento beta cerrada"). Rationales describe the factual link and never justify priority or weekly allocation.

### 4. Zero-Token Deterministic Testing & Provider Support

- Extended `AIProvider` interface with `groupWork(input)`.
- Added mock fixture dataset in `cases/mock-groupings.json` and implemented `MockProvider.groupWork`.
- Implemented structured JSON calls in `GroqProvider` and `GeminiProvider`.
- Added 24 unit and behavioral tests covering the 15 specific edge cases. Total test suite expanded to 87 passing tests in < 400ms.
- Integrated pipeline evaluation into `scripts/eval-cases.ts` supporting `--skill=group_work` and comma-separated case filtering (`--case=case-23,case-24,case-25`).

## Consequences

- **Positive**: Clean pipeline abstraction where grouping produces lines of work without leaking into deadline detection or weekly planning.
- **Positive**: Invariant guarantees make downstream skills immune to item loss, item duplication, or phantom hallucinations.
- **Positive**: Low-cost and free-tier friendly: independent items skip LLM calls entirely.
