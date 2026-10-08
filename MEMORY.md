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

Next implementation focus:
- **Skill 03: `group_work`**: Group items into coherent areas of attention without deciding weekly priority or capacity.

Detailed specifications for individual skills live separately from this file.

---

## North Star

The product succeeds when the person can say:

> **“Ahora veo con claridad qué quiero cuidar.”**
