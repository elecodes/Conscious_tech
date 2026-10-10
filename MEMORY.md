# MEMORY.md

This file contains important project context and decisions that should survive across development sessions.

It is not a full specification.

---

## Project identity

**Conscious Tech**

The project explores a more conscious, human-centered way of using technology and AI.

The goal is not to help people simply do more.

The goal is to help people create **clarity, intention, and better decisions** when using technology.

---

## Current product direction

The first product is a weekly clarity/focus system.

A person can express everything they currently have in their head — by writing or speaking — and the system helps them understand it, identify relationships, decide what deserves attention, and create a realistic week.

The system should help the person reach:

> **“Ahora veo con claridad qué quiero cuidar.”**

Not:

> “La IA me ha dicho qué tengo que hacer.”

---

## Core principles

### AI proposes. The person decides.

The AI can:

* understand
* organize
* detect relationships
* explain
* propose

The person decides:

* what matters
* what to prioritize
* what to postpone
* what to remove
* what changes when something new appears

### Space is part of the plan

The system must never assume that 100% of available time should be planned.

Uncommitted space is intentional.

It allows for:

* unexpected events
* tasks taking longer
* thinking
* rest
* flexibility
* doing nothing

### Concentration over fragmentation

Many individual tasks may belong to the same larger line of attention.

The system should be able to transform:

> many disconnected items

into:

> a smaller number of meaningful areas of attention.

The unit received by the AI does not have to be the unit returned to the user.

### Not doing something can be a decision

Postponing something consciously is different from forgetting it.

The product should make this distinction visible.

### The tool accompanies; it does not chase

The product should reduce cognitive noise, not create more of it.

---

## Weekly model

The central object is the **week**, not the task.

Conceptually:

```text
WEEK
├── intention
├── capacity
├── space
├── focuses
├── options
├── obligations
├── novelties
└── decisions
```

The week can change when reality changes.

The system should adapt without silently destroying previous decisions.

---

## Radar

The product includes a concept called **Radar**.

Its purpose is to answer:

> “Ha aparecido algo nuevo. ¿Esto necesita entrar en mi semana o puede esperar?”

A new item may:

1. require no action
2. become a flexible option
3. fit into existing space
4. create a conflict requiring a decision

The AI may detect a conflict, but it must not silently decide what the person should sacrifice.

Important principle:

> **If I choose this, something else may change.**

The person decides.

---

## Memory philosophy

Memory should:

1. remember what is useful
2. preserve meaningful context
3. allow forgetting

Memory belongs to the person.

The system should remember decisions and context, not every piece of conversation.

Users must be able to delete stored information.

---

## AI vs code

The project deliberately separates semantic reasoning from deterministic logic.

AI is useful for:

* natural-language understanding
* semantic grouping
* relationships
* interpretation
* explanations
* proposals

Code should handle:

* business rules
* capacity
* conflicts
* calculations
* state
* persistence
* validation
* memory lifecycle

This principle should guide architectural decisions throughout the project.

---

## Product direction

The project should remain:

* human-centered
* calm
* privacy-conscious
* low-cost
* simple
* AI-assisted rather than AI-controlled

The technical architecture should support experimentation without locking the project to one AI provider.

---

## Development philosophy

Build → test → use with real examples → learn → adjust.

Real user behavior and real brain dumps can change the design.

The conceptual model is a starting point, not a reason to over-engineer.

---

## Current state

The repository is being built incrementally.

Implemented and calibrated skills:
1. **Skill 01: `extract_items`**: Convert free-form user input into structured items (`task`, `idea`, `concern`, `commitment`, `project`) without prioritizing or planning.
2. **Skill 02: `detect_relationships`**: Detect semantic links (`same_project`, `same_objective`, `related_to`, `part_of`, `depends_on`, `duplicate`) with strict boundaries (concerns isolated, preconditions as `depends_on`, workarounds not linked, zero grouping).
3. **Skill 03: `group_work`**: Synthesize items into coherent lines of attention (`WorkGroup` and `ungroupedItemIds`) without deciding weekly priorities or capacities, backed by a deterministic invariant engine.
4. **Skill 04: `detect_deadlines`**: Detect and normalize temporal references and deadlines anchored to an explicit `currentDate`, without inventing dates, inferring priority/urgency, or estimating effort. Vague expressions discarded deterministically.
5. **Skill 05: `evaluate_context`**: Evaluate situational context, gravity, dependencies, and open questions without building weekly plans or making choices for the user (`ItemContextAssessment`, `GroupContextAssessment`, `OpenQuestion`).
6. **Skill 06: `build_week`**: Synthesize evaluated context into a realistic, human-centered weekly focus proposal (`ProposedWeek`) respecting capacity, protected space, and user sovereignty ("AI proposes. The person decides.").

### Key Decisions & Conventions (Skill 05)
- **Strict "Code before AI" for `dependency`**: The `dependency` signal requires an explicit, valid `depends_on` relationship between input items. Spurious signals derived from `part_of`, `related_to`, or `same_project` are strictly filtered out by the deterministic invariant engine.
- **`waiting` does not penalize attention**: Being blocked by an external party describes objective context, not lower user attention. Items in `waiting` preserve `high` or `medium` attention when deadlines or gravity dictate it.
- **Exploratory / Optional items**: Items conditioned by "si tengo tiempo" or "si me da tiempo" preserve `low` attention even when nearing calendar horizons.
- **Calibration validated with Groq & Mock**: 25/25 cases verified with 100% item (63/63) and group (7/7) coverage, 0 phantom IDs, and 0 duplicate entries.

### Key Decisions & Conventions (Skill 06)
- **Contractual obligations require explicit backing**: High importance and urgent wording ("urgente", "crítico", "prioritario") do NOT invent contractual obligations. Only explicit dates in `strictDeadlinesInWeek` or verified `externalCommitments` qualify as `obligations`.
- **Honesty over mathematical pretense**: When users provide no hour estimates, capacity status remains `unknown` rather than fabricating hours to simulate a tight calendar plan.
- **Protected space is mandatory**: At least 25–30% of plannable capacity is protected for margin and rest.
- **Consolidation engine protection**: Evaluator runs safely merge records without letting offline mock runs destroy live Groq evaluations, maintaining active records and execution history.
- **Calibration with real Groq (`qwen/qwen3.8-27b`)**:
  - 25/25 fixtures evaluated with real Groq.
  - 25 clean passes, 0 repairs, 0 failures, 100% 1:1 item conservation.
  - Semantic audit approved with product observations registered:
    - *Prior dates*: External commitments with dates prior to target week are kept visible for explicit human reconciliation (`case-08`).
    - *Product backlog items*: Handling sub-hour quick tasks prior to the week (`case-22`), delegation trigger vs focus tracking (`case-24`), and UI distinction between weekly due dates and future milestone commitments (`case-13`).
  - *Note*: Evaluation calibration is an empirical benchmark and does not guarantee absolute absence of errors in production.

Next implementation focus:
- **Skill 07: `analyze_change`**: Analyze mid-week changes, incoming urgent inputs, and trade-offs against the established weekly plan.

Detailed specifications for individual skills live separately from this file.

---

## North Star

The product succeeds when the person can say:

> **“Ahora veo con claridad qué quiero cuidar.”**
