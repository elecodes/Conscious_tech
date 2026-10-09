# ADR 0005: Functional Contract for Skill 05 (`evaluate_context`)

- **Status:** Accepted
- **Date:** 2026-10-09
- **Context:** Functional contract, architectural boundaries, and deterministic invariant engine for Skill 05 (`evaluate_context`).

---

## 1. Context and Problem Statement

Following the incremental pipeline of **Conscious Tech**:
1. **Skill 01 (`extract_items`)**: Extracts structured items (`task`, `project`, `idea`, `commitment`, `concern`) from natural language brain dumps.
2. **Skill 02 (`detect_relationships`)**: Identifies pairwise semantic links (`same_project`, `same_objective`, `part_of`, `depends_on`, `related_to`, `duplicate`).
3. **Skill 03 (`group_work`)**: Synthesizes items into coherent lines of attention (`WorkGroup[]` and `ungroupedItemIds`).
4. **Skill 04 (`detect_deadlines`)**: Extracts and normalizes temporal constraints (`DetectedDeadlines`) anchored to an explicit base date.

Before constructing a realistic week (Skill 06 `build_week`), the system needs to assess the **situational context** of each task and each line of work:
- What obligations or external promises exist?
- What temporal pressure or upcoming horizons are present?
- What work has already started?
- What blocking dependencies exist?
- Does this work relate to explicitly stated user goals (if any were declared)?
- Where is critical information missing?
- What lines of attention represent high relevance or require clarification?

### The Core Risk: Premature Planning & AI Overreach

Without strict functional boundaries, an evaluation skill tends to overreach by:
- Deciding what the user "should" do first.
- Arbitrarily picking the 2–3 weekly focus areas.
- Scoring items into a single mechanical priority ranking.
- Hallucinating unstated goals, commitments, or deadlines.
- Demanding answers to trivial questions, creating cognitive noise.
- Mandating sacrifices ("drop task X to do task Y").

In accordance with our core principle:
> **AI proposes. The person decides.**

Skill 05 must **illuminate context and explain the situation**, leaving scheduling, trade-off decisions, and capacity planning strictly to downstream stages and the person.

---

## 2. Functional Responsibilities & Boundaries

### 2.1 What Skill 05 DOES

1. **Contextual Item Assessment (`ItemContextAssessment`)**:
   - Assesses situational attention level (`high`, `medium`, `low`, `unclear`) for each input item.
   - Attaches factual, evidence-backed signals (`ContextSignal[]`).
   - Provides a concise, human-readable rationale grounded strictly in input data.
2. **Contextual Group Assessment (`GroupContextAssessment`)**:
   - Assesses situational relevance (`high`, `medium`, `low`, `unclear`) for each work group identified by Skill 03.
   - Explains why the line of attention is significant, neutral, or needs clarification.
3. **High-Signal Open Questions (`OpenQuestion`)**:
   - Formulates targeted clarification questions **only** when missing information genuinely blocks situational understanding (e.g. unknown external deadline on a blocking prerequisite, ambiguous external commitment).
4. **Strict Evidence Grounding**:
   - Every signal and assessment must cite concrete input evidence (from items, relationships, deadlines, groups, or declared goals).

### 2.2 What Skill 05 DOES NOT DO (Negative Constraints)

1. **Does NOT choose weekly focuses**: It does not select the 2–3 focus areas of the week.
2. **Does NOT build or distribute the schedule**: It does not allocate tasks to days, calculate available capacity, or sum hours.
3. **Does NOT mutate or delete items**: It never adds, edits, archives, or deletes items or groups.
4. **Does NOT invent unstated context**: If deadlines, importance, or goals were not provided, it never infers them.
5. **Does NOT equate approaching deadline with high priority**: A deadline is a calendar fact, not an automatic judgment that the item is most important.
6. **Does NOT treat missing data as low importance**: Lack of detail indicates `unclear` or `insufficient_information`, never insignificance.
7. **Does NOT decide trade-offs**: It never decides what must be postponed or sacrificed.
8. **Does NOT issue commands**: It explains context ("This is an external commitment due tomorrow"), never dictates ("You must do this first").

---

## 3. Input Contract Specification

Skill 05 consumes the exact, unmutated outputs from Skills 01–04, plus optional user goals.

```ts
import { ExtractedItem } from "./items";
import { Relationship } from "./relationships";
import { GroupedWork } from "./work-groups";
import { DetectedDeadlines } from "./deadlines";

export type DeclaredGoal = {
  id: string;
  text: string;
};

export type EvaluateContextInput = {
  currentDate: string; // ISO YYYY-MM-DD
  locale?: string;
  items: ExtractedItem[];
  relationships: Relationship[];
  groupedWork: GroupedWork;
  deadlines: DetectedDeadlines;
  declaredGoals?: DeclaredGoal[];
};
```

### Architectural Decision on `DeclaredGoal`:
- `DeclaredGoal` represents long-term or explicit objectives directly formulated by the user (e.g. "Lanzar MVP en octubre", "Aprobar certificación AWS").
- **Optional nature**: `declaredGoals` is strictly optional (`declaredGoals?: DeclaredGoal[]`).
- **Zero-inference rule**: If omitted or empty, Skill 05 **must never infer or extract goals from brain dump items**. Goals are first-class user statements, not AI deductions.

---

## 4. Output Contract Specification

```ts
export type ContextAttentionLevel = "high" | "medium" | "low" | "unclear";
export type ContextRelevanceLevel = "high" | "medium" | "low" | "unclear";

export type ContextSignal =
  | "external_commitment"
  | "approaching_deadline"
  | "overdue_deadline"
  | "explicit_importance"
  | "already_started"
  | "dependency"
  | "supports_declared_goal"
  | "waiting"
  | "insufficient_information";

export type ItemContextAssessment = {
  itemId: string;
  attention: ContextAttentionLevel;
  signals: ContextSignal[];
  rationale: string;
};

export type GroupContextAssessment = {
  groupId: string;
  relevance: ContextRelevanceLevel;
  rationale: string;
};

export type OpenQuestion = {
  topic: string;
  question: string;
  relatedItemIds: string[];
  reason: string;
};

export type EvaluateContextOutput = {
  itemAssessments: ItemContextAssessment[];
  groupAssessments: GroupContextAssessment[];
  openQuestions: OpenQuestion[];
};
```

---

## 5. Semantic Definitions & Signal Taxonomy

### 5.1 Item Attention Levels (`ContextAttentionLevel`)

- **`high`**: The item has strong situational urgency or gravity (e.g. active external commitment, deadline approaching in $\le 7$ days, explicit high importance, or blocks an urgent line of work).
- **`medium`**: The item represents relevant ongoing work or normal active initiatives without immediate impending friction (e.g. already started, medium importance, deadline beyond current week, or connected to declared goals).
- **`low`**: The item is exploratory, non-urgent, flexible, or personal wish-list work with no external pressure, no near deadlines, and no blocking dependencies (e.g. ideas, archived items, "algún día").
- **`unclear`**: There is insufficient context to gauge its situational gravity without making unjustified assumptions.

### 5.2 Group Relevance Levels (`ContextRelevanceLevel`)

- **`high`**: The group encompasses items with active external commitments, near deadlines, or aligns directly with an active declared goal.
- **`medium`**: The group represents a steady, cohesive project or maintenance line with clear continuity but no immediate crisis or tight deadline.
- **`low`**: The group is purely exploratory, backlogged, or secondary.
- **`unclear`**: The line of attention contains fragmented or contradictory signals that require clarification.

### 5.3 Evidence Criteria for Context Signals

| Signal | Required Factual Evidence in Inputs |
| :--- | :--- |
| `external_commitment` | `item.commitment === "external"` |
| `approaching_deadline` | `deadlines` contains entry for `itemId` with `resolvedStart` or `resolvedEnd` within current weekly planning window ($\le 7$ days from `currentDate`). |
| `overdue_deadline` | `deadlines` contains entry for `itemId` with terminal date `< currentDate`. |
| `explicit_importance` | `item.importance === "high"` (or explicitly stated in raw text). |
| `already_started` | `item.status === "started"`. |
| `dependency` | Item appears as `sourceItemId` or `targetItemId` in a `depends_on` relationship, or is a prerequisite `part_of`. |
| `supports_declared_goal` | Explicit semantic relationship between the item and one of the `declaredGoals`. |
| `waiting` | Item is blocked by an uncompleted dependency or waiting on a third-party response. |
| `insufficient_information` | Item has missing deadline, ambiguous commitment, or unclear scope when assessing situational gravity. |

### 5.4 Asymmetric Dependency Propagation Rule

- If Task A depends on Task B (`Task A -> depends_on -> Task B`), Task B is a **prerequisite**.
- If Task A has an approaching deadline or is an external commitment, Task B gains situational attention because it **unblocks** Task A.
- However, Task B **does NOT inherit** Task A's deadline date or commitment type. Each item retains its own authentic attributes. The rationale must explicitly explain: *"Task B requires attention because it unblocks Task A which is due on [Date]"*.
- Similarly, if Task B is delayed, Task A cannot proceed (`waiting` signal on Task A).

### 5.5 Threshold for `openQuestions`

To avoid cognitive noise and respect the user's peace of mind:
- **Only ask when ambiguity actively blocks situational clarity**:
  - Example: A blocking task has an external commitment, but its date or scope is completely unknown.
  - Example: A critical conflict exists between two mutually exclusive dependencies.
- **Do NOT ask trivial or optional questions**:
  - Do NOT ask for deadlines on ideas or exploratory thoughts.
  - Do NOT ask for hour estimates if the user didn't mention time.
  - Do NOT ask "when do you plan to do this?" if it is not an obligation.

---

## 6. Structural & Invariant Integrity Rules

Consistent with our deterministic engine patterns in Skills 01–04, the following invariants are enforced deterministically by code (not trusted solely to LLM generation):

1. **Exact 1:1 Item Coverage**:
   - `itemAssessments.length === input.items.length`.
   - Every input `item.id` must appear **exactly once** in `itemAssessments`.
   - No phantom `itemId` values are permitted.
2. **Exact 1:1 Group Coverage**:
   - `groupAssessments.length === input.groupedWork.groups.length`.
   - Every group `group.id` must appear **exactly once** in `groupAssessments`.
   - No phantom `groupId` values are permitted.
3. **Open Question Integrity**:
   - All IDs in `openQuestion.relatedItemIds` must exist in `input.items`.
   - Empty or phantom IDs are stripped.
4. **Signal Whitelist Validation**:
   - All signals must belong strictly to `ContextSignalSchema`.
5. **Data Immutability Guarantee**:
   - `input.items`, `input.relationships`, `input.groupedWork`, and `input.deadlines` are immutable and returned unaltered.
6. **Zero-Token Short-Circuits**:
   - If `input.items.length === 0`: Returns `{ itemAssessments: [], groupAssessments: [], openQuestions: [] }` in 0ms without invoking AI.

---

## 7. Deferred Decisions & Questions for Discussion

1. **Representation of Ungrouped Items in Group Assessments**:
   - Skill 03 outputs `groups: WorkGroup[]` and `ungroupedItemIds: string[]`.
   - *Adopted contract:* `groupAssessments` evaluates existing `groups` (lines of attention). Ungrouped items are individually evaluated in `itemAssessments`. Downstream planning (Skill 06) consumes both seamlessly.
2. **Calibration of Approaching Horizon Window**:
   - The operational threshold for `approaching_deadline` is set to $\le 7$ days from `currentDate` (matching the weekly planning scope).
3. **Integration with Golden Cases Dataset**:
   - Skill 05 is validated across all 25 calibration brain dumps in `cases/eval-context-results.json` using Mock and Groq (`qwen/qwen3.8-27b`).

---

## 8. Implementation & Semantic Microcalibration Decisions

1. **Strict "Code before AI" for `dependency` Signal**:
   - Semantic evaluation via LLM tended to assign `dependency` to composition relations (`part_of`) or thematic links (`related_to`, `same_project`).
   - *Resolution:* Strictly enforced in `prompt.ts` and guaranteed deterministically in `cleanAndValidateContextOutput`: the `dependency` signal is only valid if backed by an explicit, valid `depends_on` relationship between input items. Spurious signals are purged by code.
2. **Objective `waiting` Signal**:
   - Being blocked by a third party describes situational friction, not an automatic devaluation of user attention.
   - *Resolution:* Items in `waiting` preserve `high` or `medium` attention when upcoming deadlines, gravity, or follow-up actions demand it (e.g. Case 06 Stripe integration).
3. **Exploratory & Optional Items**:
   - Items explicitly qualified as optional ("si me da tiempo", "si tengo un rato") or exploratory preserve `low` attention even if calendar deadlines or proximity are present (e.g. Case 03, Case 22).
4. **Verification & Invariant Health**:
   - Tested with 39 unit/behavioral tests (169 total in the suite) passing in < 700ms.
   - Evaluated across 25 real dumps with 100% item coverage (63/63), 100% group coverage (7/7), 0 phantom IDs, and 0 duplicate entries.
