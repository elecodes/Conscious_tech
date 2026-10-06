# AGENTS.md

## Project

**Conscious Tech** is a human-centered AI product focused on helping people use technology and AI with more clarity, intention, and less cognitive noise.

The first product direction is a weekly focus and planning experience that helps people turn a brain dump into a realistic week without letting AI take control of their decisions.

The core principle is:

> **AI proposes. The person decides.**

---

## How to work on this project

### 1. Build incrementally

Implement only what is needed for the current step.

Do not build future features, abstractions, agents, infrastructure, or integrations before they are justified by the product.

Prefer:

* simple architecture
* small functions
* explicit types
* clear boundaries
* incremental changes
* real tests and real user feedback

Avoid:

* premature abstractions
* unnecessary dependencies
* over-engineering
* microservices
* complex agent frameworks
* infrastructure that is not needed yet

### 2. Code before AI

Use deterministic code whenever possible.

* If a problem can be solved reliably with code → use code.
* If semantic understanding is required → use an LLM.
* If a small/cheap model is enough → do not use a larger model.
* Do not call an LLM just because it is available.

AI should mainly handle things such as:

* understanding natural language
* extracting meaning
* detecting semantic relationships
* interpreting context
* generating explanations
* proposing options

Code should handle things such as:

* business rules
* calculations
* capacity
* conflicts
* dates when deterministic
* state transitions
* persistence
* validation
* IDs
* memory lifecycle
* deletion

### 3. Keep AI replaceable

LLM providers must not leak into the domain.

Use a provider abstraction so the application can work with different providers without changing the core logic.

The project should remain able to change:

* model
* provider
* prompt
* AI implementation

without rewriting the domain.

### 4. Structured AI

Never trust raw LLM output.

Use:

* structured outputs
* schemas
* validation
* clear prompts
* retries when appropriate
* provider-independent domain types

Prefer Zod for runtime validation where appropriate.

### 5. Cost matters

This project should be developed with a **free-tier-first / low-cost mindset**.

Avoid:

* unnecessary LLM calls
* large models when smaller ones work
* repeated calls for deterministic work
* unnecessary context
* expensive infrastructure

The goal is to learn what actually requires AI before spending money on infrastructure or models.

### 6. Privacy matters

The product deals with personal thoughts, plans, priorities, and potentially sensitive information.

Therefore:

* minimize data sent to external AI providers
* do not store information unnecessarily
* do not log full personal brain dumps by default
* make deletion possible
* avoid secrets in code or logs
* treat user memory as belonging to the user

### 7. Product principles

The product should feel like:

> **A personal notebook + a thoughtful assistant + calm AI.**

It should not feel like:

* a productivity game
* a task-management system that constantly pushes the user
* an AI that tells the user what they must do
* a dashboard full of metrics
* a source of additional cognitive noise

Important principles:

* concentration over fragmentation
* space is part of the plan
* not doing something can be a conscious decision
* the person remains in control
* the system should explain important decisions
* no silent changes
* users can correct, undo, postpone, or delete

### 8. Architecture

Prefer a clear separation between:

```text
UI
 ↓
Application / Skills
 ↓
Domain / Core Engines
 ↓
Infrastructure
```

AI providers and persistence belong to infrastructure.

Business rules should remain independent from specific AI providers.

### 9. Testing

Tests should focus on behavior and business rules.

Prefer:

* deterministic unit tests
* fixtures
* mocked AI providers
* integration tests for provider connections
* real LLM testing only where it provides value

Do not make the entire test suite depend on external LLM APIs.

### 10. Before changing code

Before implementing something:

1. Inspect the existing project structure.
2. Understand the current architecture.
3. Check existing dependencies and conventions.
4. Reuse existing patterns where appropriate.
5. Make the smallest change that solves the problem.

Do not assume the repository is empty or matches an imagined architecture.

### 11. After changing code

Always verify:

* types
* tests
* validation
* error handling
* provider independence
* cost implications
* consistency with the product principles

Explain important architectural decisions briefly.

### 12. Decision rule

When unsure, ask:

> **Can this be simpler?**

Then:

> **Does this really need AI?**

Then:

> **Does this really need another abstraction, agent, dependency, or service?**

Choose the simplest solution that preserves the product's principles.

---

## Current project documentation

Use `PROJECT_CONTEXT.md` for the complete product vision, architecture, roadmap, and conceptual model.

Use `MEMORY.md` for important project decisions and context that should persist across development sessions.

Detailed implementation documentation should live close to the feature or skill it describes.

## Project documentation

Before making significant architectural or product decisions, consult:

* `PROJECT_CONTEXT.md` — product vision, conceptual model, architecture direction, and roadmap.
* `MEMORY.md` — important project decisions and context accumulated during development.
* `README.md` — repository setup, current implementation status, and developer commands.

Keep these documents consistent when a significant decision changes the project.

Do not duplicate large sections of these documents inside `AGENTS.md`.
