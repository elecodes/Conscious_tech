# ADR 0002: Detect Relationships — Conservative Semantic Links and Deterministic Post-Processing

## Status

Accepted

## Context

Following the stabilization of Skill 01 (`extract_items`), the system produces structured `ExtractedItem[]` entities representing user intentions, commitments, ideas, and concerns.

Before work can be grouped or organized into a weekly focus (Skill 03 `group_work` and Skill 06 `build_week`), the system must determine how individual items relate to one another. 

In keeping with Conscious Tech principles:
- **Detect relationships, don't group**: Skill 02 must answer *"What relationship exists between the mentioned elements?"* without forming final project groups, prioritizing items, resolving transitive dependencies, or deciding what belongs in the week.
- **Code over AI when deterministic**: Structural validation (self-relations, dangling IDs, edge direction canonicalization, and metadata-based links like `same_project`) must be resolved deterministically in code.
- **Conservative semantic detection**: Only explicit or direct semantic ties should be recognized. Independent tasks must produce an empty relationship set.

## Decisions

### 1. Domain Modeling (`src/domain/relationships.ts`)

Defined clear, explicit relation types:
- `same_project`: Items sharing the same explicit project container.
- `same_objective`: Items contributing to the exact same concrete goal.
- `related_to`: Generic topical or conceptual connection.
- `part_of`: Constituent task belonging to a parent deliverable/project item.
- `depends_on`: Direct prerequisite relationship (`source` requires `target`).
- `blocks`: Inverse causal edge (`source` blocks `target`), canonicalized in code to `depends_on`.
- `duplicate`: Near-identical repetition of the same intention.

Relationships include `confidence` (`high | medium | low`) and an explicit `reason` string explaining why the link exists.

### 2. Deterministic Cleaning & Guardrails (`deterministic.ts`)

All candidate relationships pass through deterministic cleanup before reaching the consumer:
- **Short-circuiting**: Inputs with fewer than 2 items immediately return `{ relationships: [] }` in 0ms without invoking the AI provider.
- **Validation**: Relationships referencing unknown IDs or linking an item to itself are stripped.
- **Canonicalization**:
  - `blocks` relationships are flipped to `depends_on` (`A blocks B` becomes `B depends_on A`) to preserve a unified direction for dependency graphs.
  - Symmetric relations (`same_project`, `same_objective`, `related_to`, `duplicate`) are canonicalized by sorting item IDs to prevent duplicate bidirectional edges (`A <-> B` and `B <-> A`).
- **Deterministic `same_project` Inference**: When two items share an identical non-empty `project` field, `same_project` is automatically generated with high confidence if not already covered.

### 3. AI Prompting & Architecture (`src/skills/detect-relationships/`)

- Implemented `DetectRelationshipsService` adhering to the same structured retry pattern used in Skill 01.
- Provided system prompt enforcing conservative boundaries:
  - No synthetic dependencies (e.g. chronological preferences are not blockers unless explicitly stated).
  - No speculative grouping.
  - Independent items must return an empty `relationships` list.

### 4. Zero-Token Deterministic Testing & Evaluation

- Implemented `MockProvider.detectRelationships` leveraging `cases/mock-relationships.json`.
- Added 18 discrete tests in `tests/relationships-domain.test.ts` and `tests/detect-relationships.test.ts`.
- Created `scripts/eval-relationships.ts` supporting `--provider=mock|groq|gemini` and `--case=case-XX`.

## Consequences

- **Positive**: Clean separation of concerns between extraction (01), relationship detection (02), and future grouping (03).
- **Positive**: Deterministic test suite executes in < 350ms with 0 token spend.
- **Positive**: Resilient against LLM hallucinations (phantom IDs, loops, redundant opposite edges).
